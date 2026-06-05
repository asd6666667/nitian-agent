/**
 * 模拟交易 — 优先走昨日 demo-bot UTA V3 API
 */
import { randomUUID } from "crypto";
import { isSimApiConfigured, runSimTick, getSimAccount, getSimOpenOrders } from "./simulationApi.js";
import { formatPerceptionLog } from "./perceptionGate.js";

const sessions = new Map();

export function strategyRunId(strategy) {
  if (!strategy) return "";
  if (strategy.runId) return strategy.runId;
  const id = strategy.id || `${strategy.type || "custom"}_${strategy.symbol || "BTCUSDT"}`;
  return id;
}

function ensureMultiState(session) {
  if (!session.entryPrices) session.entryPrices = {};
  if (!session.runningStrategies) session.runningStrategies = {};
  if (!session.strategyPaused) session.strategyPaused = {};
  if (!session.strategyOpened) session.strategyOpened = {};
}

function getEntryPrice(session, symbol) {
  ensureMultiState(session);
  const sym = String(symbol || "").toUpperCase();
  return Number(session.entryPrices[sym] || session.entryPrice || 0);
}

function setEntryPrice(session, symbol, price) {
  ensureMultiState(session);
  const sym = String(symbol || "").toUpperCase();
  if (price > 0) session.entryPrices[sym] = price;
  else delete session.entryPrices[sym];
  if (sym === String(session.symbol || "").toUpperCase()) session.entryPrice = price || 0;
}

/** 平仓后清除 session 入场价，避免 Agent 仍显示持仓 */
export function clearSessionEntries(session, symbols = null) {
  ensureMultiState(session);
  if (!symbols || !symbols.length) {
    session.entryPrice = 0;
    session.entryPrices = {};
    session.strategyOpened = {};
    return;
  }
  for (const sym of symbols) {
    const s = String(sym || "").toUpperCase();
    delete session.entryPrices[s];
    delete session.strategyOpened[s];
    if (String(session.symbol || "").toUpperCase() === s) session.entryPrice = 0;
  }
}

export function registerRunningStrategy(session, strategy) {
  ensureMultiState(session);
  const runId = strategyRunId(strategy);
  const label = strategy.name || strategy.summary || runId;
  const isNew = !session.runningStrategies[runId];
  session.runningStrategies[runId] = {
    runId,
    strategy: { ...strategy, runId },
    label,
    symbol: strategy.symbol || "BTCUSDT",
    addedAt: session.runningStrategies[runId]?.addedAt || Date.now(),
    lastAgentTick: session.runningStrategies[runId]?.lastAgentTick || null,
  };
  return { runId, isNew, entry: session.runningStrategies[runId] };
}

export function unregisterRunningStrategy(session, runId) {
  ensureMultiState(session);
  const entry = session.runningStrategies[runId];
  delete session.runningStrategies[runId];
  delete session.strategyPaused[runId];
  return entry || null;
}

export function listRunningStrategies(session) {
  ensureMultiState(session);
  return Object.values(session.runningStrategies);
}

export function getOrCreateSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      id: sessionId,
      cash: 10000,
      position: 0,
      entryPrice: 0,
      entryPrices: {},
      symbol: "BTCUSDT",
      orders: [],
      logs: [],
      paused: false,
      peakEquity: 10000,
      strategy: null,
      runningStrategies: {},
      strategyPaused: {},
      bitgetPaper: isSimApiConfigured(),
      simApi: isSimApiConfigured(),
    });
  }
  return sessions.get(sessionId);
}

function syncEntryPriceWithAccount(session, symbol, marketPrice, strategy) {
  const sym = String(symbol || "BTCUSDT").toUpperCase();
  const base = sym.replace(/USDT$/i, "");
  const price = Number(marketPrice || 0);
  ensureMultiState(session);

  const fut = (session.holdings?.futures || []).find(
    (p) => String(p.symbol || "").toUpperCase() === sym
  );
  const futSize = Number(fut?.total ?? fut?.available ?? fut?.size ?? 0);

  const spot = (session.holdings?.spot || []).find((a) => a.coin === base);
  const spotAvail = Number(spot?.available || 0);
  const spotNotional = spotAvail * price;

  const useFutures =
    String(strategy?.category || "").toLowerCase().includes("futures") ||
    futSize > 0;
  const hasFut = futSize > 0.00001;
  const hasSpot = spotNotional >= 5;

  const hasLive = useFutures && hasFut ? true : !useFutures && hasSpot ? true : hasFut || hasSpot;
  const openedByStrategy = !!session.strategyOpened[sym];

  if (!hasLive || !openedByStrategy) {
    if (getEntryPrice(session, sym) > 0) setEntryPrice(session, sym, 0);
    if (!hasLive) delete session.strategyOpened[sym];
    return;
  }

  if (hasFut) {
    const ep = Number(
      fut?.avgPrice || fut?.openPriceAvg || fut?.averageOpenPrice || fut?.openPrice || 0
    );
    if (ep > 0) setEntryPrice(session, sym, ep);
  }
}

/** @deprecated use syncEntryPriceWithAccount */
function syncEntryPriceFromHoldings(session, symbol, marketPrice) {
  syncEntryPriceWithAccount(session, symbol, marketPrice, null);
}

async function syncFromSimApi(session, symbol) {
  const acct = await getSimAccount();
  session.cash = Number(acct.usdt?.available || 0);
  session.position = Number(acct.btc?.available || 0);
  session.holdings = {
    spot: acct.spotAssets || [],
    futures: acct.futuresPositions || [],
    accountEquity: acct.accountEquity,
    unrealisedPnl: acct.unrealisedPnl,
  };
  session.bitgetPaper = true;
  session.simApi = true;
  return acct;
}

export function evaluateRisk(session, price, strategy) {
  const equity = session.cash + session.position * price;
  session.peakEquity = Math.max(session.peakEquity, equity);
  const dd = session.peakEquity > 0 ? (session.peakEquity - equity) / session.peakEquity : 0;
  const maxDd = (strategy?.risk?.maxDrawdownPct || 5) / 100;
  const alerts = [];

  if (session.position > 0 && session.entryPrice > 0) {
    const pnlPct = (price - session.entryPrice) / session.entryPrice;
    const tp = (strategy?.risk?.takeProfitPct || 3) / 100;
    const sl = (strategy?.risk?.stopLossPct || 2) / 100;
    if (pnlPct >= tp) alerts.push({ level: "info", message: `触发止盈 +${(pnlPct * 100).toFixed(2)}%` });
    if (pnlPct <= -sl) alerts.push({ level: "warning", message: `触发止损 ${(pnlPct * 100).toFixed(2)}%` });
  }

  if (dd >= maxDd) {
    session.paused = true;
    alerts.push({
      level: "critical",
      message: `回撤 ${(dd * 100).toFixed(2)}% 超过限制 ${strategy?.risk?.maxDrawdownPct}% — 交易已暂停`,
    });
  }

  return { equity, drawdownPct: dd * 100, alerts, paused: session.paused };
}

export async function executePaperOrder(session, { side, price, strategy, symbol }) {
  if (session.paused) return { ok: false, error: "风控暂停中，无法下单" };
  const { placeSimOrder } = await import("./simulationApi.js");
  const sym = symbol || strategy?.symbol || session.symbol || "BTCUSDT";

  if (session.simApi && isSimApiConfigured()) {
    try {
      const posPct = (strategy?.positionPct || 50) / 100;
      let qty;
      if (side === "buy") {
        await syncFromSimApi(session, sym);
        qty = ((session.cash * posPct) / price).toFixed(6);
      } else {
        qty = session.position.toFixed(6);
      }
      const order = await placeSimOrder({ symbol: sym, side, orderType: "market", qty });
      await syncFromSimApi(session, sym);
      session.orders.unshift({
        id: order.orderId || randomUUID(),
        side,
        price,
        qty: Number(qty),
        time: Date.now(),
        venue: order.venue || order.apiPath || "bitget-api",
        bitgetOrderId: order.orderId,
      });
      session.logs.unshift({
        time: Date.now(),
        message: `[Bitget API] ${side.toUpperCase()} ${qty} · orderId ${order.orderId}`,
      });
      return { ok: true, order };
    } catch (e) {
      session.logs.unshift({ time: Date.now(), message: `[模拟API] ${e.message}`, level: "critical" });
      return { ok: false, error: e.message };
    }
  }

  const posPct = (strategy?.positionPct || 50) / 100;
  const order = { id: randomUUID(), side, price, time: Date.now(), status: "filled", venue: "local_sim" };
  if (side === "buy" && session.position === 0) {
    const spend = session.cash * posPct;
    if (spend < 10) return { ok: false, error: "可用资金不足" };
    order.qty = spend / price;
    session.cash -= spend;
    session.position = order.qty;
    session.entryPrice = price;
  } else if (side === "sell" && session.position > 0) {
    order.qty = session.position;
    order.pnl = (price - session.entryPrice) * session.position;
    session.cash += session.position * price;
    session.position = 0;
    session.entryPrice = 0;
  } else {
    return { ok: false, error: "无效订单方向或无可平仓位" };
  }
  session.orders.unshift(order);
  session.logs.unshift({ time: Date.now(), message: `${side.toUpperCase()} ${order.qty?.toFixed(6)} @ ${price}` });
  return { ok: true, order };
}

async function tickPaperSessionCore(session, market, strategy, runId) {
  const symbol = strategy?.symbol || session.symbol || "BTCUSDT";
  const price = market.price;
  const tag = strategy?.name || strategy?.symbol || runId || "策略";
  const paused = session.paused || (runId && session.strategyPaused?.[runId]);

  if (!session.simApi || !isSimApiConfigured()) {
    return { session, risk: evaluateRisk(session, price, strategy), action: null, simTick: null };
  }

  if (paused) {
    return { session, risk: evaluateRisk(session, price, strategy), action: null, simTick: null, skipped: true };
  }

  try {
    const equity =
      Number(session.holdings?.accountEquity) ||
      session.cash + session.position * price;
    session.peakEquity = Math.max(session.peakEquity || 0, equity);

    await syncFromSimApi(session, symbol);
    syncEntryPriceWithAccount(session, symbol, price, strategy);

    const entryPrice = getEntryPrice(session, symbol);
    const simResult = await runSimTick(strategy, {
      mode: "agent",
      session: {
        entryPrice,
        peakEquity: session.peakEquity,
        paused: !!paused,
        equity,
      },
    });

    if (simResult.riskPause) {
      if (runId) session.strategyPaused[runId] = true;
      else session.paused = true;
      session.logs.unshift({
        time: Date.now(),
        message: `[${tag}] [风控] ${simResult.risk?.reason || "触发暂停"}`,
        level: "critical",
      });
    }

    if (simResult.executed && simResult.decision?.action === "buy") {
      ensureMultiState(session);
      session.strategyOpened[String(symbol).toUpperCase()] = true;
      setEntryPrice(session, symbol, price);
    }
    if (simResult.executed && simResult.decision?.action === "sell") {
      await syncFromSimApi(session, symbol);
      syncEntryPriceWithAccount(session, symbol, price, strategy);
      const sym = String(symbol).toUpperCase();
      const base = sym.replace(/USDT$/i, "");
      const spot = (session.holdings?.spot || []).find((a) => a.coin === base);
      const fut = (session.holdings?.futures || []).find(
        (p) => String(p.symbol || "").toUpperCase() === sym
      );
      const stillHeld =
        Number(spot?.available || 0) * price >= 5 ||
        Number(fut?.total ?? fut?.available ?? fut?.size ?? 0) > 0.00001;
      if (!stillHeld) {
        delete session.strategyOpened[sym];
        setEntryPrice(session, sym, 0);
      }
    }

    if (simResult.decision) {
      const level = simResult.executed
        ? "info"
        : simResult.orderError
          ? "critical"
          : simResult.decision.action === "hold"
            ? undefined
            : "warning";
      const prefix = simResult.agent ? "🤖 智能体" : "严格执行";
      const action = simResult.decision.action;
      let message;
      if (simResult.executed) {
        const side = action === "sell" ? "✅ 已平仓" : action === "buy" ? "✅ 已买入" : "✅ 已执行";
        message = `[${tag}] [${prefix}] ${side} · ${simResult.decision.reason} · orderId ${simResult.order?.orderId || "—"}`;
      } else if (simResult.orderError) {
        message = `[${tag}] [${prefix}·未成交] ${simResult.orderError}`;
      } else if (action === "sell" || action === "buy") {
        message = `[${tag}] [${prefix}·拟${action === "sell" ? "卖" : "买"}] ${simResult.decision.reason}（未提交交易所）`;
      } else {
        message = `[${tag}] [${prefix}] ${simResult.decision.reason}`;
      }
      session.logs.unshift({
        time: Date.now(),
        message,
        level,
      });
      if (simResult.agent?.perceive?.summary) {
        session.logs.unshift({
          time: Date.now(),
          message: `[${tag}] [感知] ${simResult.agent.perceive.summary}`,
        });
      }
      if (simResult.agent?.risk?.reason && !simResult.risk?.ok) {
        session.logs.unshift({
          time: Date.now(),
          message: `[${tag}] [风控] ${simResult.agent.risk.reason}`,
          level: "warning",
        });
      }
      if (simResult.agent?.exit?.triggered && simResult.agent?.exit?.reason) {
        session.logs.unshift({
          time: Date.now(),
          message: `[${tag}] [退出] ${simResult.agent.exit.reason}`,
          level: simResult.executed ? "info" : "warning",
        });
      }
    }

    if (runId && session.runningStrategies[runId]) {
      session.runningStrategies[runId].lastAgentTick = simResult.agent || null;
    }
    session.lastAgentTick = simResult.agent || null;

    if (!simResult.agent && simResult.perception) {
      const pLog = formatPerceptionLog(simResult.perception);
      if (pLog) {
        session.logs.unshift({ time: Date.now(), message: `[${tag}] [感知 Skill] ${pLog}` });
      }
    }
    if (simResult.risk && !simResult.risk.ok) {
      session.logs.unshift({
        time: Date.now(),
        message: `[${tag}] [风控] ${simResult.risk.reason}`,
        level: "warning",
      });
    }
    if (simResult.order && simResult.executed) {
      const side =
        simResult.order.tradeType?.includes("open_long") || simResult.decision?.action === "buy"
          ? "buy"
          : "sell";
      session.orders.unshift({
        id: simResult.order.orderId || randomUUID(),
        orderId: simResult.order.orderId,
        side,
        price: simResult.order.price || price,
        qty: Number(simResult.order.qty || simResult.decision?.qty || 0),
        time: Date.now(),
        venue: simResult.order.venue || "agent-trade",
        executed: true,
        symbol,
        category: simResult.order.category || simResult.category,
        posSide: simResult.order.posSide || null,
        tradeType: simResult.order.tradeType,
        tradeLabel: simResult.order.tradeLabel,
        strategyRunId: runId || strategyRunId(strategy),
      });
    }

    const risk = evaluateRisk(session, price, strategy);
    return {
      session,
      risk,
      action: simResult.executed ? { ok: true, simResult } : null,
      simTick: simResult,
      runId: runId || strategyRunId(strategy),
    };
  } catch (e) {
    session.logs.unshift({
      time: Date.now(),
      message: `[${tag}] [模拟API] ${e.message}`,
      level: "critical",
    });
    return { session, risk: evaluateRisk(session, price, strategy), action: null, simTick: null, error: e.message };
  }
}

export async function tickPaperSession(sessionId, market, strategy) {
  const session = getOrCreateSession(sessionId);
  session.strategy = strategy;
  session.symbol = strategy?.symbol || session.symbol;
  const runId = strategyRunId(strategy);
  registerRunningStrategy(session, strategy);

  const result = await tickPaperSessionCore(session, market, strategy, runId);

  if (session.simApi && isSimApiConfigured()) {
    try {
      await syncFromSimApi(session, session.symbol);
      const openOrders = await getSimOpenOrders(session.symbol);
      return { ...result, session: { ...session, openOrders } };
    } catch { /* ignore */ }
  }

  return result;
}

export async function tickAllPaperStrategies(sessionId, marketBySymbol) {
  const session = getOrCreateSession(sessionId);
  ensureMultiState(session);
  const entries = Object.values(session.runningStrategies);
  if (!entries.length) {
    return { session, results: [] };
  }

  const results = [];
  for (const entry of entries) {
    const sym = entry.strategy?.symbol || entry.symbol;
    const market = marketBySymbol?.[sym];
    if (!market?.price) {
      results.push({ runId: entry.runId, error: `缺少 ${sym} 行情`, skipped: true });
      continue;
    }
    const one = await tickPaperSessionCore(session, market, entry.strategy, entry.runId);
    results.push({
      runId: entry.runId,
      strategy: entry.strategy,
      simTick: one.simTick,
      executed: one.simTick?.executed,
      agent: one.simTick?.agent,
      perception: one.simTick?.perceptionSnapshot || null,
      error: one.error,
      skipped: one.skipped,
    });
  }

  if (session.simApi && isSimApiConfigured()) {
    try {
      await syncFromSimApi(session, session.symbol);
    } catch { /* ignore */ }
  }

  const symbols = [...new Set(entries.map((e) => e.strategy?.symbol).filter(Boolean))];
  const openOrders = [];
  for (const sym of symbols) {
    try {
      openOrders.push(...(await getSimOpenOrders(sym)));
    } catch { /* ignore */ }
  }

  return {
    session: { ...session, openOrders, runningList: listRunningStrategies(session) },
    results,
  };
}

export async function initBitgetSession(sessionId, symbol = "BTCUSDT", strategy = null) {
  const session = getOrCreateSession(sessionId);
  session.symbol = symbol;
  if (strategy) {
    session.strategy = strategy;
    const { isNew } = registerRunningStrategy(session, strategy);
    if (isNew) {
      session.logs.unshift({
        time: Date.now(),
        message: `[策略池] 加入 ${strategy.name || "自定义"} · ${symbol}`,
      });
    }
  }
  session.bitgetPaper = isSimApiConfigured();
  session.simApi = isSimApiConfigured();

  if (session.simApi) {
    const acct = await syncFromSimApi(session, symbol);
    session.peakEquity = session.cash + session.position * 0;
    const spotSummary = (acct.spotAssets || [])
      .filter((a) => a.coin !== "USDT" && Number(a.available) > 0)
      .map((a) => `${a.coin} ${a.available}`)
      .join(" · ") || "无现货持仓";
    if (!strategy) {
      session.logs.unshift({
        time: Date.now(),
        message: `[模拟API] 已连接 demo-bot UTA V3 · USDT ${session.cash.toFixed(2)} · ${spotSummary}`,
      });
    }
  }
  session.runningList = listRunningStrategies(session);
  return session;
}

export function addPaperStrategy(sessionId, strategy) {
  const session = getOrCreateSession(sessionId);
  const { runId, isNew, entry } = registerRunningStrategy(session, strategy);
  if (isNew) {
    session.logs.unshift({
      time: Date.now(),
      message: `[策略池] 加入 ${entry.label} · ${entry.symbol}`,
    });
  }
  session.runningList = listRunningStrategies(session);
  return { session, runId, isNew };
}

export function removePaperStrategy(sessionId, runId) {
  const session = getOrCreateSession(sessionId);
  const removed = unregisterRunningStrategy(session, runId);
  if (removed) {
    session.logs.unshift({
      time: Date.now(),
      message: `[策略池] 移除 ${removed.label}`,
    });
  }
  session.runningList = listRunningStrategies(session);
  return { session, removed };
}
