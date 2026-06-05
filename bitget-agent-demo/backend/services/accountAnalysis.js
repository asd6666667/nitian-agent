/**
 * 从账户快照 + Bitget 成交历史构建现货/合约盈亏分析（与 simAccount 权益一致）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";
import { getAssets, getTicker } from "../../../demo-bot/bitget-v3.js";
import { isSimApiConfigured } from "./simCredentials.js";
import { normalizeFuturesPositions, enrichFuturesMarkPrices } from "./futuresUtils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(__dirname, "../../../demo-bot/logs/trades.jsonl");
const SNAPSHOT_FILE = path.join(__dirname, "../../../demo-bot/logs/equity-snapshots.jsonl");

function readLogs(limit = 500) {
  if (!fs.existsSync(LOG_FILE)) return [];
  return fs
    .readFileSync(LOG_FILE, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .slice(-limit)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function appendSnapshot(entry) {
  const dir = path.dirname(SNAPSHOT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(SNAPSHOT_FILE, JSON.stringify(entry) + "\n");
}

export function readSnapshots(days = 30) {
  if (!fs.existsSync(SNAPSHOT_FILE)) return [];
  const cutoff = Date.now() - days * 86400000;
  return fs
    .readFileSync(SNAPSHOT_FILE, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((s) => s && s.time >= cutoff);
}

/** 现货权益 = 各资产 usdValue 之和，与 getSimAccount 展示一致 */
export function computeSpotEquity(accountRaw, futuresPositions = []) {
  const assets = accountRaw?.assets || [];
  const sum = assets.reduce((s, a) => s + Number(a.usdValue ?? a.equity ?? 0), 0);
  if (sum > 0) return sum;
  const total = Number(accountRaw?.accountEquity || 0);
  const unrealised = Number(accountRaw?.unrealisedPnl || accountRaw?.usdtUnrealisedPnl || 0);
  const margin = computeFuturesMargin(futuresPositions);
  const futuresUnreal = computeFuturesPnL(futuresPositions).unrealised;
  const accountUnreal = unrealised > futuresUnreal ? unrealised : futuresUnreal;
  return Math.max(0, total - margin - accountUnreal);
}

/** 合约占用保证金（非盈亏） */
export function computeFuturesMargin(futuresPositions = []) {
  const positions = Array.isArray(futuresPositions) ? futuresPositions : [];
  return positions.reduce(
    (s, p) => s + Number(p.margin || p.marginSize || p.positionBalance || 0),
    0
  );
}

/** 合约盈亏 = 未实现 + 已实现（不含保证金本金） */
export function computeFuturesPnL(futuresPositions = []) {
  const positions = Array.isArray(futuresPositions) ? futuresPositions : [];
  const unrealised = positions.reduce(
    (s, p) => s + Number(p.unrealisedPnl || p.unrealizedPnl || 0),
    0
  );
  const realised = positions.reduce(
    (s, p) => s + Number(p.realisedPnl || p.curRealisedPnl || p.realizedPnl || 0),
    0
  );
  return { unrealised, realised, total: unrealised + realised };
}

/** 合约权益 = 持仓保证金 + 未实现盈亏；无持仓时为 0 */
export function computeFuturesEquity(accountRaw, futuresPositions = []) {
  const positions = Array.isArray(futuresPositions) ? futuresPositions : [];
  if (!positions.length) {
    return 0;
  }
  const margin = computeFuturesMargin(positions);
  const { unrealised } = computeFuturesPnL(positions);
  return margin + unrealised;
}

export function hasFuturesActivity(futuresPositions = []) {
  if (!Array.isArray(futuresPositions) || !futuresPositions.length) return false;
  const { total } = computeFuturesPnL(futuresPositions);
  return Math.abs(total) > 0.0001 || computeFuturesMargin(futuresPositions) > 0.01;
}

export function recordEquitySnapshot(accountRaw, category = "all", futuresPositions = []) {
  if (!accountRaw?.accountEquity) return;
  const positions = Array.isArray(futuresPositions) ? futuresPositions : [];
  const spotEquity = computeSpotEquity(accountRaw, positions);
  const futuresMargin = computeFuturesMargin(positions);
  const futuresPnlParts = computeFuturesPnL(positions);
  const futuresEquity = positions.length ? futuresMargin + futuresPnlParts.unrealised : 0;
  const entry = {
    time: Date.now(),
    category,
    equity: Number(accountRaw.accountEquity),
    spotEquity,
    futuresEquity,
    futuresMargin,
    futuresUnrealised: futuresPnlParts.unrealised,
    futuresRealised: futuresPnlParts.realised,
    futuresPnl: futuresPnlParts.total,
    unrealisedPnl: Number(accountRaw.unrealisedPnl || accountRaw.usdtUnrealisedPnl || 0),
  };
  const recent = readSnapshots(1);
  const last = recent.at(-1);
  if (
    last &&
    Math.abs((last.spotEquity ?? last.equity) - spotEquity) < 0.01 &&
    Math.abs((last.futuresPnl ?? last.futuresEquity ?? 0) - entry.futuresPnl) < 0.01 &&
    Math.abs((last.futuresMargin ?? 0) - futuresMargin) < 0.01 &&
    Date.now() - last.time < 8000
  ) {
    return;
  }
  appendSnapshot(entry);
}

function isSpotLog(log) {
  if (log.category === "USDT-FUTURES" || log.category === "FUTURES") return false;
  return true;
}

function dedupePoints(points) {
  const sorted = [...points].sort((a, b) => a.time - b.time);
  const out = [];
  for (const p of sorted) {
    if (out.length && Math.abs(out.at(-1).time - p.time) < 60000) {
      out[out.length - 1] = p;
    } else {
      out.push(p);
    }
  }
  return out;
}

/** 以权益快照为主轴，成交历史补充时间点 */
function buildSpotCurve({ snapshots, spotEquity, historyOrders, days, markPrice }) {
  const now = Date.now();
  const startTime = now - days * 86400000;

  const snapPoints = snapshots
    .filter((s) => s.time >= startTime)
    .map((s) => {
      const spot = Number(s.spotEquity ?? 0);
      const legacy = Number(s.unrealisedPnl || 0) === 0 ? Number(s.equity || 0) : 0;
      return {
        time: s.time,
        equity: spot > 0 ? spot : legacy,
        price: null,
      };
    })
    .filter((p) => p.equity > 0);

  const tradePoints = (historyOrders || [])
    .filter((o) => o.time >= startTime && String(o.status || "").toLowerCase() === "filled")
    .map((o) => ({
      time: o.time,
      equity: null,
      price: Number(o.price || 0) || null,
    }));

  let points = dedupePoints([...snapPoints, ...tradePoints]);

  if (!points.length) {
    points = [
      { time: startTime, equity: spotEquity, price: markPrice },
      { time: now, equity: spotEquity, price: markPrice },
    ];
  } else {
    const firstEquity = snapPoints[0]?.equity ?? spotEquity;
    if (points[0].time > startTime) {
      points.unshift({ time: startTime, equity: firstEquity, price: markPrice });
    }
    const last = points.at(-1);
    if (!last.equity || last.time < now - 30000) {
      points.push({ time: now, equity: spotEquity, price: markPrice });
    } else {
      points[points.length - 1] = { time: now, equity: spotEquity, price: last.price ?? markPrice };
    }
  }

  // 填充仅有时间戳的成交点：用最近已知权益
  let lastEquity = points.find((p) => p.equity > 0)?.equity ?? spotEquity;
  for (const p of points) {
    if (p.equity == null || p.equity <= 0) {
      p.equity = lastEquity;
    } else {
      lastEquity = p.equity;
    }
  }

  const initialCapital = snapPoints[0]?.equity ?? points[0]?.equity ?? spotEquity;

  return { equityCurve: points, initialCapital };
}

async function fetchFuturesPositions() {
  try {
    const { getCurrentPositions } = await import("../../../demo-bot/bitget-v3.js");
    return await getCurrentPositions("USDT-FUTURES");
  } catch {
    return [];
  }
}

function snapshotFuturesPnl(s) {
  if (Number.isFinite(Number(s.futuresPnl))) return Number(s.futuresPnl);
  const unrealised = Number(s.futuresUnrealised);
  const realised = Number(s.futuresRealised);
  if (Number.isFinite(unrealised) || Number.isFinite(realised)) {
    return (Number.isFinite(unrealised) ? unrealised : 0) + (Number.isFinite(realised) ? realised : 0);
  }
  /** 旧快照无 futuresPnl 时，用账户级未实现盈亏（合约为主时与持仓浮盈接近） */
  return Number(s.unrealisedPnl || 0);
}

function buildFuturesCurve({ futuresPositions, unrealised, snapshots, days }) {
  const active = hasFuturesActivity(futuresPositions);
  const futuresMargin = computeFuturesMargin(futuresPositions);
  const pnlParts = computeFuturesPnL(futuresPositions);
  const posUnrealised = pnlParts.unrealised;
  const posRealised = pnlParts.realised;
  const currentPnl = pnlParts.total;
  const futuresEquity = futuresMargin + posUnrealised;

  if (!active) {
    const now = Date.now();
    const startTime = now - days * 86400000;
    return {
      equityCurve: [
        { time: startTime, equity: 0, price: null },
        { time: now, equity: 0, price: null },
      ],
      initialCapital: 0,
      unrealisedPnl: 0,
      equity: 0,
      margin: 0,
      totalPnl: 0,
      realizedPnl: 0,
      hasActivity: false,
    };
  }

  const now = Date.now();
  const startTime = now - days * 86400000;

  const snapPoints = snapshots
    .filter((s) => {
      if (s.time < startTime) return false;
      return snapshotFuturesPnl(s) !== 0 || Number(s.futuresMargin) > 1 || Number(s.futuresEquity) > 1;
    })
    .map((s) => ({
      time: s.time,
      equity: +snapshotFuturesPnl(s).toFixed(4),
      price: null,
    }));

  let rawPoints =
    snapPoints.length > 0
      ? dedupePoints(snapPoints)
      : [
          { time: startTime, equity: currentPnl, price: null },
          { time: now, equity: currentPnl, price: null },
        ];

  if (rawPoints.at(-1)?.time !== now) {
    rawPoints.push({ time: now, equity: currentPnl, price: null });
  } else {
    rawPoints[rawPoints.length - 1] = { time: now, equity: currentPnl, price: null };
  }

  /** 开仓以来盈亏 = 当前持仓未实现 + 已实现（不含保证金） */
  const totalPnl = +currentPnl.toFixed(2);

  return {
    equityCurve: rawPoints,
    initialCapital: 0,
    unrealisedPnl: posUnrealised,
    realizedPnl: posRealised,
    equity: futuresEquity,
    margin: futuresMargin,
    totalPnl,
    hasActivity: true,
  };
}

export async function getAccountPnLAnalysis({ days = 30, symbol = "BTCUSDT" } = {}) {
  if (!isSimApiConfigured()) {
    return { configured: false, message: "模拟 API 未配置" };
  }

  let live = null;
  try {
    const { fetchBitgetLivePnL } = await import("./bitgetPnlApi.js");
    live = await fetchBitgetLivePnL({ days, symbol });
  } catch (e) {
    console.warn("[accountAnalysis] Bitget live PnL failed:", e.message);
  }

  const logs = readLogs();
  let historyOrders = [];
  try {
    const { getSimHistoryOrders } = await import("./simulationApi.js");
    historyOrders = await getSimHistoryOrders([], Math.max(50, days * 2));
  } catch {
    /* ignore */
  }

  if (live?.spot) {
    const spotExecuted = logs.filter((l) => l.executed && isSpotLog(l));
    const filledCount = historyOrders.filter(
      (o) => String(o.status || "").toLowerCase() === "filled"
    ).length;
    const spotAssets = (await getAssets().catch(() => ({ assets: [] }))).assets || [];

    try {
      const futuresPositions = normalizeFuturesPositions(await fetchFuturesPositions());
      recordEquitySnapshot(await getAssets(), "all", futuresPositions);
    } catch {
      /* ignore snapshot */
    }

    return {
      configured: true,
      days: live.days,
      symbol,
      updatedAt: live.updatedAt,
      source: live.source,
      summary: live.summary,
      recordCounts: live.recordCounts,
      spot: {
        ...live.spot,
        tradeCount: Math.max(spotExecuted.length, filledCount),
        assets: spotAssets.filter(
          (a) => a.coin !== "USDT" || Number(a.available) > 0
        ),
      },
      futures: live.futures,
      account: live.account,
    };
  }

  // 回退：本地快照 + 成交历史
  let accountRaw = null;
  let futuresPositions = [];
  try {
    accountRaw = await getAssets();
    futuresPositions = normalizeFuturesPositions(await fetchFuturesPositions());
    futuresPositions = await enrichFuturesMarkPrices(futuresPositions);
    recordEquitySnapshot(accountRaw, "all", futuresPositions);
  } catch (e) {
    return { configured: false, message: e.message };
  }

  const equity = Number(accountRaw.accountEquity || 0);
  const unrealised = Number(accountRaw.unrealisedPnl || accountRaw.usdtUnrealisedPnl || 0);
  const spotEquity = computeSpotEquity(accountRaw, futuresPositions);

  let markPrice = null;
  try {
    const ticker = await getTicker(symbol);
    markPrice = Number(ticker?.lastPr || 0);
  } catch {
    /* ignore */
  }

  const snapshots = readSnapshots(Math.max(days, 180));
  const spotAssets = (accountRaw.assets || []).filter(
    (a) => a.coin !== "USDT" || Number(a.available) > 0
  );
  const spot = buildSpotCurve({
    snapshots,
    spotEquity,
    historyOrders,
    days,
    markPrice,
  });
  const futures = buildFuturesCurve({
    futuresPositions,
    unrealised,
    snapshots,
    days,
  });

  const spotExecuted = logs.filter((l) => l.executed && isSpotLog(l));
  const filledCount = historyOrders.filter((o) => String(o.status || "").toLowerCase() === "filled").length;

  return {
    configured: true,
    days,
    symbol,
    updatedAt: Date.now(),
    spot: {
      category: "spot",
      label: "现货盈亏分析",
      equity: spotEquity,
      unrealisedPnl: 0,
      initialCapital: spot.initialCapital,
      equityCurve: spot.equityCurve,
      tradeCount: Math.max(spotExecuted.length, filledCount),
      assets: spotAssets,
      markPrice,
      totalPnl: +(spotEquity - spot.initialCapital).toFixed(2),
    },
    futures: {
      category: "futures",
      label: "合约盈亏分析",
      equity: futures.equity,
      unrealisedPnl: futures.unrealisedPnl,
      initialCapital: futures.initialCapital,
      equityCurve: futures.equityCurve,
      positions: futuresPositions,
      positionCount: futuresPositions.length,
      totalPnl: futures.totalPnl ?? 0,
      realizedPnl: futures.realizedPnl ?? 0,
      margin: futures.margin ?? 0,
      hasActivity: futures.hasActivity,
    },
    account: {
      accountEquity: equity,
      spotEquity,
      unrealisedPnl: unrealised,
      usdtEquity: Number(accountRaw.usdtEquity || 0),
    },
  };
}
