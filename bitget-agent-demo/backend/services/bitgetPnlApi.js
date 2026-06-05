/**
 * Bitget UTA V3 盈亏分析
 * - 现货：权益快照差值（含浮动盈亏），财务流水仅计手续费/真实盈亏类型
 * - 合约：持仓 unrealised + realised，区间用快照 futuresPnl 差值
 */
import {
  getAssets,
  getTicker,
  fetchFinancialRecordsRange,
} from "../../../demo-bot/bitget-v3.js";
import {
  computeSpotEquity,
  computeFuturesEquity,
  computeFuturesPnL,
  computeFuturesMargin,
  hasFuturesActivity,
  readSnapshots,
  recordEquitySnapshot,
} from "./accountAnalysis.js";
import { normalizeFuturesPositions, enrichFuturesMarkPrices } from "./futuresUtils.js";

/** 本金流动 / 成交进出 — 不计入盈亏 */
const FLOW_TYPES =
  /^(TRANSFER|DEPOSIT|WITHDRAW|INTERNAL|REBATE|AIRDROP|STAKING|SUB_|CONVERT|BORROW|REPAY|EXCHANGE|ORDER_DEALT|ORDER_PLACE|ORDER_CANCEL|FROZEN|UNFREEZE|REPAY_SOURCE|REPAY_TARGET)/i;

/** 明确属于盈亏/费用的流水类型 */
const PNL_TYPES =
  /^(ORDER_PLF_FEE|FEE|FUNDING|SETTLE|REALIZED|PNL|PROFIT|LOSS|LIQUID|CONTRACT|INTEREST_EARN|TRADE_PNL|DELIVERY|ADL|BUST|COMPENSATE)/i;

function dayStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function spotEquityFromSnapshot(s) {
  const spot = Number(s?.spotEquity ?? 0);
  return spot > 0 ? spot : 0;
}

function futuresEquityFromSnapshot(s) {
  const direct = Number(s?.futuresEquity ?? 0);
  if (direct > 0) return direct;
  const margin = Number(s?.futuresMargin ?? 0);
  const unreal = Number(s?.futuresUnrealised ?? 0);
  return margin + unreal;
}

function futuresPnlFromSnapshot(s) {
  if (s?.futuresPnl != null) return Number(s.futuresPnl);
  return Number(s?.futuresUnrealised ?? 0) + Number(s?.futuresRealised ?? 0);
}

function bestSnapshotAtOrBefore(snapshots, ts) {
  let best = null;
  for (const s of snapshots) {
    if (s.time <= ts && (!best || s.time > best.time)) best = s;
  }
  return best;
}

function recordPnlDelta(r) {
  const type = String(r.type || "").toUpperCase();
  if (!type) return 0;
  if (FLOW_TYPES.test(type)) return 0;

  let delta = 0;
  if (PNL_TYPES.test(type)) {
    delta += Number(r.amount || 0);
  }
  const fee = Number(r.fee || 0);
  if (Number.isFinite(fee) && fee !== 0) delta += fee;
  return delta;
}

function aggregateDailyRealized(records = []) {
  const map = new Map();
  for (const r of records) {
    const delta = recordPnlDelta(r);
    if (!delta) continue;
    const ts = Number(r.ts || r.cTime || 0);
    if (!ts) continue;
    const k = dayStart(ts);
    map.set(k, (map.get(k) || 0) + delta);
  }
  return [...map.entries()]
    .map(([time, pnl]) => ({ time, pnl: +pnl.toFixed(6) }))
    .sort((a, b) => a.time - b.time);
}

function sumDailySince(dailyPnls, sinceMs) {
  return dailyPnls.filter((d) => d.time >= sinceMs).reduce((s, d) => s + d.pnl, 0);
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

function equityAtPeriodStart(snapshots, periodStartMs, currentEquity) {
  const atStart = bestSnapshotAtOrBefore(snapshots, periodStartMs - 1);
  if (atStart) return spotEquityFromSnapshot(atStart);

  const withEquity = snapshots
    .map((s) => ({ time: s.time, equity: spotEquityFromSnapshot(s) }))
    .filter((s) => s.equity > 0)
    .sort((a, b) => a.time - b.time);

  if (!withEquity.length) return currentEquity;

  const earliest = withEquity[0];
  if (earliest.time >= periodStartMs) return earliest.equity;

  return earliest.equity;
}

function futuresEquityAtPeriodStart(snapshots, periodStartMs, currentEquity) {
  const atStart = bestSnapshotAtOrBefore(snapshots, periodStartMs - 1);
  if (atStart) return futuresEquityFromSnapshot(atStart);

  const inRange = snapshots
    .filter((s) => s.time >= periodStartMs && futuresEquityFromSnapshot(s) > 0)
    .sort((a, b) => a.time - b.time);
  if (inRange.length) return futuresEquityFromSnapshot(inRange[0]);

  return currentEquity;
}

function futuresPnlAtPeriodStart(snapshots, periodStartMs) {
  const atStart = bestSnapshotAtOrBefore(snapshots, periodStartMs - 1);
  if (atStart) return futuresPnlFromSnapshot(atStart);

  const inRange = snapshots
    .filter((s) => s.time >= periodStartMs)
    .sort((a, b) => a.time - b.time);
  if (inRange.length) return futuresPnlFromSnapshot(inRange[0]);

  return 0;
}

function summarizeFromEquity({ snapshots, currentEquity }) {
  const now = Date.now();
  const todayStart = dayStart(now);
  const d7Start = dayStart(now - 6 * 86400000);
  const d30Start = dayStart(now - 29 * 86400000);

  const mk = (periodStartMs) => {
    const startEq = equityAtPeriodStart(snapshots, periodStartMs, currentEquity);
    const pnl = currentEquity - startEq;
    const base = Math.abs(startEq) > 0.01 ? Math.abs(startEq) : Math.abs(currentEquity) || 1;
    return {
      pnl: +pnl.toFixed(2),
      pnlPct: +((pnl / base) * 100).toFixed(2),
    };
  };

  return {
    today: mk(todayStart),
    d7: mk(d7Start),
    d30: mk(d30Start),
  };
}

function summarizeFuturesFromSnapshots(snapshots, futuresPositions) {
  const parts = computeFuturesPnL(futuresPositions);
  const currentTotal = parts.total;
  const now = Date.now();
  const todayStart = dayStart(now);
  const d7Start = dayStart(now - 6 * 86400000);
  const d30Start = dayStart(now - 29 * 86400000);

  const mk = (periodStartMs) => {
    const start = futuresPnlAtPeriodStart(snapshots, periodStartMs);
    const pnl = currentTotal - start;
    const base = Math.max(Math.abs(start), Math.abs(currentTotal), 1);
    return {
      pnl: +pnl.toFixed(2),
      pnlPct: +((pnl / base) * 100).toFixed(2),
    };
  };

  return {
    today: mk(todayStart),
    d7: mk(d7Start),
    d30: mk(d30Start),
  };
}

function buildDailyPnlsFromSnapshots(snapshots, currentEquity, days) {
  const now = Date.now();
  const startDay = dayStart(now - (Math.min(days, 90) - 1) * 86400000);
  const byDay = new Map();

  const sorted = [...snapshots]
    .filter((s) => s.time >= startDay - 86400000)
    .sort((a, b) => a.time - b.time);

  for (const s of sorted) {
    const k = dayStart(s.time);
    const eq = spotEquityFromSnapshot(s);
    if (eq > 0) byDay.set(k, eq);
  }
  byDay.set(dayStart(now), currentEquity);

  const daysArr = [...byDay.entries()].sort((a, b) => a[0] - b[0]);
  const dailyPnls = [];
  for (let i = 1; i < daysArr.length; i++) {
    if (daysArr[i][0] < startDay) continue;
    dailyPnls.push({
      time: daysArr[i][0],
      pnl: +(daysArr[i][1] - daysArr[i - 1][1]).toFixed(6),
    });
  }
  return dailyPnls;
}

function buildSpotCurveFromSnapshots({ snapshots, currentEquity, days, markPrice }) {
  const now = Date.now();
  const startTime = dayStart(now - (Math.min(days, 90) - 1) * 86400000);

  const points = snapshots
    .filter((s) => s.time >= startTime)
    .map((s) => ({
      time: s.time,
      equity: spotEquityFromSnapshot(s),
      price: null,
    }))
    .filter((p) => p.equity > 0);

  points.push({ time: now, equity: currentEquity, price: markPrice });

  const withPrice = points.map((p) => ({ ...p, price: p.price ?? markPrice ?? null }));
  const deduped = dedupePoints(withPrice.sort((a, b) => a.time - b.time));
  const initialCapital = equityAtPeriodStart(snapshots, startTime, currentEquity);
  const totalPnl = +(currentEquity - initialCapital).toFixed(2);

  return {
    equityCurve: deduped.length >= 2 ? deduped : [
      { time: startTime, equity: initialCapital, price: markPrice },
      { time: now, equity: currentEquity, price: markPrice },
    ],
    initialCapital: +initialCapital.toFixed(4),
    totalPnl,
  };
}

function buildFuturesPnlCurve({ snapshots, futuresPositions, days, futuresDaily }) {
  const parts = computeFuturesPnL(futuresPositions);
  const currentPnl = parts.total;
  const now = Date.now();
  const startTime = dayStart(now - (Math.min(days, 90) - 1) * 86400000);
  const initialPnl = futuresPnlAtPeriodStart(snapshots, startTime);

  const points = snapshots
    .filter((s) => s.time >= startTime)
    .map((s) => ({
      time: s.time,
      equity: futuresPnlFromSnapshot(s),
      price: null,
    }));

  points.push({ time: now, equity: currentPnl, price: null });
  let deduped = dedupePoints(points.sort((a, b) => a.time - b.time));

  if (deduped.length < 2 && futuresDaily.length) {
    let pnl = initialPnl;
    const fromDaily = [{ time: startTime, equity: initialPnl, price: null }];
    for (const d of futuresDaily.filter((x) => x.time >= startTime)) {
      pnl += d.pnl;
      fromDaily.push({
        time: Math.min(d.time + 12 * 3600000, now),
        equity: +pnl.toFixed(4),
        price: null,
      });
    }
    fromDaily.push({ time: now, equity: currentPnl, price: null });
    deduped = dedupePoints(fromDaily);
  }

  if (deduped.length < 2) {
    deduped = [
      { time: startTime, equity: initialPnl, price: null },
      { time: now, equity: currentPnl, price: null },
    ];
  }

  return {
    equityCurve: deduped,
    initialCapital: +initialPnl.toFixed(4),
    totalPnl: +currentPnl.toFixed(2),
  };
}

function buildFuturesAccountCurve({ snapshots, futuresPositions, days }) {
  const currentEquity = computeFuturesEquity(null, futuresPositions);
  const now = Date.now();
  const startTime = dayStart(now - (Math.min(days, 90) - 1) * 86400000);
  const initialCapital = futuresEquityAtPeriodStart(snapshots, startTime, currentEquity);

  const points = snapshots
    .filter((s) => s.time >= startTime && futuresEquityFromSnapshot(s) > 0)
    .map((s) => ({
      time: s.time,
      equity: futuresEquityFromSnapshot(s),
      price: null,
    }));

  points.push({ time: now, equity: currentEquity, price: null });
  const deduped = dedupePoints(points.sort((a, b) => a.time - b.time));

  return {
    equityCurve:
      deduped.length >= 2
        ? deduped
        : [
            { time: startTime, equity: initialCapital, price: null },
            { time: now, equity: currentEquity, price: null },
          ],
    initialCapital: +initialCapital.toFixed(4),
    totalEquity: +currentEquity.toFixed(2),
  };
}

async function fetchFuturesPositions() {
  try {
    const { getCurrentPositions } = await import("../../../demo-bot/bitget-v3.js");
    let positions = normalizeFuturesPositions(await getCurrentPositions("USDT-FUTURES"));
    return enrichFuturesMarkPrices(positions);
  } catch {
    return [];
  }
}

/** 拉取 Bitget 实时盈亏（权益快照 + 过滤后财务流水） */
export async function fetchBitgetLivePnL({ days = 30, symbol = "BTCUSDT" } = {}) {
  const spanDays = Math.min(Math.max(Number(days) || 30, 7), 90);
  const endTime = Date.now();
  const startTime = endTime - spanDays * 86400000;

  const [accountRaw, markTicker, spotRecords, futuresRecords, futuresPositions] =
    await Promise.all([
      getAssets(),
      getTicker(symbol).catch(() => null),
      fetchFinancialRecordsRange({ category: "SPOT", startTime, endTime }).catch(() => []),
      fetchFinancialRecordsRange({ category: "USDT-FUTURES", startTime, endTime }).catch(
        () => []
      ),
      fetchFuturesPositions(),
    ]);

  recordEquitySnapshot(accountRaw, "all", futuresPositions);
  const snapshots = readSnapshots(Math.max(spanDays, 90));

  const markPrice = Number(markTicker?.lastPr || 0);
  const spotEquity = computeSpotEquity(accountRaw, futuresPositions);
  const accountEquity = Number(accountRaw.accountEquity || 0);
  const unrealised = Number(accountRaw.unrealisedPnl || accountRaw.usdtUnrealisedPnl || 0);

  const spotRealizedDaily = aggregateDailyRealized(spotRecords);
  const futuresRealizedDaily = aggregateDailyRealized(futuresRecords);
  const spotDaily = buildDailyPnlsFromSnapshots(snapshots, spotEquity, spanDays);

  const spotSummary = summarizeFromEquity({
    snapshots,
    currentEquity: spotEquity,
  });
  const spotCurve = buildSpotCurveFromSnapshots({
    snapshots,
    currentEquity: spotEquity,
    days: spanDays,
    markPrice,
  });

  const spotRealizedTotal = sumDailySince(
    spotRealizedDaily,
    dayStart(endTime - (spanDays - 1) * 86400000)
  );
  const spotUnrealised = +(spotCurve.totalPnl - spotRealizedTotal).toFixed(2);

  const futuresPnlParts = computeFuturesPnL(futuresPositions);
  const futuresMargin = computeFuturesMargin(futuresPositions);
  const futuresEquity = computeFuturesEquity(null, futuresPositions);
  const futuresActive = hasFuturesActivity(futuresPositions);
  const futuresSummary = futuresActive
    ? summarizeFuturesFromSnapshots(snapshots, futuresPositions)
    : { today: { pnl: 0, pnlPct: 0 }, d7: { pnl: 0, pnlPct: 0 }, d30: { pnl: 0, pnlPct: 0 } };

  const futuresPnlCurve = futuresActive
    ? buildFuturesPnlCurve({
        snapshots,
        futuresPositions,
        days: spanDays,
        futuresDaily: futuresRealizedDaily,
      })
    : {
        equityCurve: [
          { time: startTime, equity: 0, price: null },
          { time: endTime, equity: 0, price: null },
        ],
        initialCapital: 0,
        totalPnl: 0,
      };

  const futuresAccountCurve = futuresActive
    ? buildFuturesAccountCurve({ snapshots, futuresPositions, days: spanDays })
    : {
        equityCurve: [
          { time: startTime, equity: 0, price: null },
          { time: endTime, equity: 0, price: null },
        ],
        initialCapital: 0,
        totalEquity: 0,
      };

  const pnlRecordCount = [...spotRecords, ...futuresRecords].filter((r) => recordPnlDelta(r) !== 0)
    .length;

  return {
    source: "bitget-api",
    pnlMethod: "equity-snapshot",
    days: spanDays,
    symbol,
    updatedAt: Date.now(),
    recordCounts: {
      spot: spotRecords.length,
      futures: futuresRecords.length,
      pnlRecords: pnlRecordCount,
      snapshots: snapshots.length,
    },
    summary: {
      spot: spotSummary,
      futures: futuresSummary,
      combined: {
        today: {
          pnl: +(spotSummary.today.pnl + futuresSummary.today.pnl).toFixed(2),
        },
        d7: { pnl: +(spotSummary.d7.pnl + futuresSummary.d7.pnl).toFixed(2) },
        d30: { pnl: +(spotSummary.d30.pnl + futuresSummary.d30.pnl).toFixed(2) },
      },
    },
    spot: {
      category: "spot",
      label: "现货盈亏分析",
      equity: spotEquity,
      unrealisedPnl: spotUnrealised,
      realizedPnl: +spotRealizedTotal.toFixed(2),
      initialCapital: spotCurve.initialCapital,
      equityCurve: spotCurve.equityCurve,
      totalPnl: spotCurve.totalPnl,
      dailyPnls: spotDaily,
      realizedDailyPnls: spotRealizedDaily,
      markPrice,
    },
    futures: {
      category: "futures",
      label: "合约盈亏分析",
      equity: futuresEquity,
      margin: futuresMargin,
      unrealisedPnl: futuresPnlParts.unrealised,
      realizedPnl: futuresPnlParts.realised,
      initialCapital: futuresPnlCurve.initialCapital,
      equityCurve: futuresPnlCurve.equityCurve,
      accountEquityCurve: futuresAccountCurve.equityCurve,
      accountInitialCapital: futuresAccountCurve.initialCapital,
      totalPnl: futuresPnlParts.total,
      dailyPnls: futuresRealizedDaily,
      positions: futuresPositions,
      positionCount: futuresPositions.length,
      hasActivity: futuresActive,
    },
    account: {
      accountEquity,
      spotEquity,
      unrealisedPnl: unrealised,
      usdtEquity: Number(accountRaw.usdtEquity || 0),
    },
  };
}
