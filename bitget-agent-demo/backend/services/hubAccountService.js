/**
 * 账户 / 订单 / 持仓 — 经官方 bitget-core（同 MCP / bgc）
 * @see https://github.com/Bitget-AI/agent_hub
 */
import {
  callAgentHubTool,
  getAgentHubRuntime,
  isAgentHubReady,
} from "./agentHubBridge.js";
import { hubToolData } from "./hubMarketAdapter.js";
import { normalizeFuturesPositions } from "./futuresUtils.js";

export { isAgentHubReady };

export async function hubGetAccountAssets(accountType = "all") {
  const res = await callAgentHubTool("get_account_assets", {
    accountType,
    productType: accountType === "futures" ? "USDT-FUTURES" : undefined,
  });
  return hubToolData(res);
}

export async function hubGetFuturesPositions(symbol) {
  const res = await callAgentHubTool("futures_get_positions", {
    productType: "USDT-FUTURES",
    marginCoin: "USDT",
    ...(symbol ? { symbol } : {}),
  });
  const raw = hubToolData(res);
  return normalizeFuturesPositions(Array.isArray(raw) ? raw : raw?.list || raw?.holding || []);
}

export async function hubGetSpotOpenOrders(symbol) {
  const res = await callAgentHubTool("spot_get_orders", {
    symbol,
    status: "live",
  });
  const raw = hubToolData(res);
  return Array.isArray(raw) ? raw : raw?.list || raw?.orderList || [];
}

export async function hubGetFuturesOpenOrders(symbol) {
  const res = await callAgentHubTool("futures_get_orders", {
    productType: "USDT-FUTURES",
    symbol,
    status: "live",
  });
  const raw = hubToolData(res);
  return Array.isArray(raw) ? raw : raw?.entrustedList || raw?.list || [];
}

export async function hubCancelSpotOrders(symbol) {
  const orders = await hubGetSpotOpenOrders(symbol);
  if (!orders.length) return { cancelled: 0, symbol };
  const res = await callAgentHubTool("spot_cancel_orders", {
    symbol,
    orders: orders.map((o) => ({ orderId: o.orderId || o.order_id })),
  });
  return { cancelled: orders.length, symbol, result: hubToolData(res) };
}

export async function hubCancelFuturesOrders(symbol) {
  const orders = await hubGetFuturesOpenOrders(symbol);
  if (!orders.length) return { cancelled: 0, symbol };
  const res = await callAgentHubTool("futures_cancel_orders", {
    productType: "USDT-FUTURES",
    symbol,
    orders: orders.map((o) => ({ orderId: o.orderId || o.order_id })),
  });
  return { cancelled: orders.length, symbol, result: hubToolData(res) };
}

export async function hubCancelAllOrders(symbols = []) {
  const syms = symbols.length ? symbols : ["BTCUSDT"];
  const results = [];
  for (const sym of syms) {
    try {
      results.push(await hubCancelSpotOrders(sym));
    } catch { /* ignore */ }
    try {
      results.push(await hubCancelFuturesOrders(sym));
    } catch { /* ignore */ }
  }
  return results;
}

/** 映射为前端 simAccount 结构 */
export async function hubGetSimAccountView() {
  const assets = await hubGetAccountAssets("all");
  let futuresPositions = [];
  try {
    futuresPositions = await hubGetFuturesPositions();
  } catch { /* ignore */ }

  const spotAssets = [];
  let usdt = { available: 0, frozen: 0 };
  let accountEquity = 0;

  const list = Array.isArray(assets) ? assets : assets?.assets || assets?.balances || [];
  for (const a of list) {
    const coin = a.coin || a.currency || a.asset;
    const available = Number(a.available ?? a.free ?? 0);
    const frozen = Number(a.frozen ?? a.locked ?? 0);
    if (!coin) continue;
    if (coin === "USDT") {
      usdt = { available, frozen };
      accountEquity += available + frozen;
    }
    spotAssets.push({ coin, available, frozen });
    accountEquity += available + frozen;
  }

  if (!spotAssets.some((a) => a.coin === "USDT")) {
    spotAssets.unshift({ coin: "USDT", available: usdt.available, frozen: usdt.frozen });
  }

  return {
    configured: true,
    source: "bitget-core/get_account_assets",
    usdt,
    spotAssets,
    futuresPositions,
    accountEquity: accountEquity || usdt.available,
    unrealisedPnl: futuresPositions.reduce((s, p) => s + Number(p.unrealisedPnl || p.unrealizedPL || 0), 0),
  };
}

export function getHubRuntimeStatus() {
  const rt = getAgentHubRuntime();
  return {
    ready: rt.ready === true,
    reason: rt.reason || null,
    toolCount: rt.ready ? rt.tools.length : 0,
    modules: rt.ready ? rt.config.modules : [],
  };
}
