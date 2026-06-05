/**
 * Bitget 官方 Agent Hub 桥接层 — bitget-core (同 MCP / bgc 同源)
 * @see https://github.com/Bitget-AI/agent_hub
 */
import {
  BitgetRestClient,
  buildTools,
  loadConfig,
  SERVER_NAME,
  SERVER_VERSION,
  MODULES,
  DEFAULT_MODULES,
} from "bitget-core";
import { getBitgetCredentials } from "../../../demo-bot/bitget-v3.js";
import { isSimApiConfigured } from "./simulationApi.js";
import { normalizeHubCandles, hubToolData } from "./hubMarketAdapter.js";

export const HUB_REPO = "https://github.com/Bitget-AI/agent_hub";
export const ALL_HUB_MODULES = [...MODULES];

/** 同步 demo-bot 内存凭证 → process.env（bitget-core 读取环境变量） */
export function syncHubCredentials() {
  const c = getBitgetCredentials();
  if (!c?.apiKey) return false;
  process.env.BITGET_API_KEY = c.apiKey;
  process.env.BITGET_SECRET_KEY = c.secretKey;
  process.env.BITGET_PASSPHRASE = c.passphrase;
  return true;
}

let cached = null;

export function getAgentHubRuntime(force = false) {
  if (!force && cached?.ready) return cached;
  if (!syncHubCredentials()) {
    return { ready: false, reason: "未配置 Bitget API Key", tools: [] };
  }
  try {
    const config = loadConfig({
      modules: ALL_HUB_MODULES.join(","),
      paperTrading: true,
      readOnly: false,
    });
    const client = new BitgetRestClient(config);
    const tools = buildTools(config);
    cached = { ready: true, config, client, tools };
    return cached;
  } catch (e) {
    cached = { ready: false, reason: e.message, tools: [] };
    return cached;
  }
}

export function resetAgentHubCache() {
  cached = null;
}

export function isAgentHubReady() {
  return getAgentHubRuntime().ready === true;
}

export function listAgentHubTools({ module, readOnly } = {}) {
  const rt = getAgentHubRuntime();
  if (!rt.ready) return [];
  let tools = rt.tools;
  if (module) tools = tools.filter((t) => t.module === module);
  if (readOnly === true) tools = tools.filter((t) => !t.isWrite);
  if (readOnly === false) tools = tools.filter((t) => t.isWrite);
  return tools.map((t) => ({
    name: t.name,
    module: t.module,
    description: t.description,
    isWrite: t.isWrite,
    inputSchema: t.inputSchema,
  }));
}

export function getAgentHubCapabilities() {
  const rt = getAgentHubRuntime();
  const writeTools = rt.ready ? rt.tools.filter((t) => t.isWrite).map((t) => t.name) : [];
  const readTools = rt.ready ? rt.tools.filter((t) => !t.isWrite).map((t) => t.name) : [];
  const byModule = {};
  if (rt.ready) {
    for (const m of ALL_HUB_MODULES) {
      byModule[m] = rt.tools.filter((t) => t.module === m).length;
    }
  }
  return {
    hub: SERVER_NAME,
    version: SERVER_VERSION,
    repo: HUB_REPO,
    packages: [
      "bitget-core",
      "bitget-mcp-server",
      "bitget-client (bgc)",
      "bitget-skill",
      "bitget-skill-hub",
    ],
    modules: rt.ready ? [...rt.config.modules] : [...DEFAULT_MODULES],
    moduleToolCounts: byModule,
    totalTools: rt.ready ? rt.tools.length : 0,
    configured: isSimApiConfigured(),
    coreReady: rt.ready,
    coreError: rt.ready ? null : rt.reason,
    integration: {
      mcp: "bitget-core 同源工具面（36+ 工具，全模块）",
      bgc: "callAgentHubTool ≡ bgc <module> <tool>",
      skillHub: ["macro-analyst", "market-intel", "news-briefing", "sentiment-analyst", "technical-analysis"],
      agentLoop: "tradingAgent 感知→决策→执行→风控→退出",
    },
    writeTools,
    readTools: readTools.slice(0, 30),
    readToolCount: readTools.length,
  };
}

export async function callAgentHubTool(toolName, args = {}) {
  const rt = getAgentHubRuntime(true);
  if (!rt.ready) throw new Error(rt.reason || "Agent Hub 未就绪");
  const tool = rt.tools.find((t) => t.name === toolName);
  if (!tool) throw new Error(`官方工具不存在: ${toolName}`);
  if (rt.config.readOnly && tool.isWrite) {
    throw new Error(`只读模式禁止写入: ${toolName}`);
  }
  const data = await tool.handler(args, { config: rt.config, client: rt.client });
  return {
    ok: true,
    tool: toolName,
    module: tool.module,
    data,
    timestamp: new Date().toISOString(),
    source: "bitget-core",
  };
}

// ── 市场数据（Skill Hub / 策略 K 线） ──

export async function hubGetCandles(symbol, { granularity = "1H", limit = 120, category = "SPOT" } = {}) {
  const useFutures = /FUTURES|futures|永续/i.test(String(category));
  const gran = String(granularity).replace("1m", "1min").replace("5m", "5min").replace("1h", "1H").replace("4h", "4H").replace("1d", "1D");
  const tool = useFutures ? "futures_get_candles" : "spot_get_candles";
  const args = useFutures
    ? { symbol, productType: "USDT-FUTURES", granularity: gran, limit }
    : { symbol, granularity: gran, limit };
  const res = await callAgentHubTool(tool, args);
  return normalizeHubCandles(res.data);
}

export async function hubGetTicker(symbol, { category = "SPOT" } = {}) {
  const useFutures = /FUTURES|futures/i.test(String(category));
  const res = await callAgentHubTool(useFutures ? "futures_get_ticker" : "spot_get_ticker", {
    symbol,
    ...(useFutures ? { productType: "USDT-FUTURES" } : {}),
  });
  const data = hubToolData(res);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    lastPr: Number(row?.lastPr ?? row?.last ?? row?.close ?? 0),
    change24h: Number(row?.change24h ?? row?.changeUtc24h ?? 0),
    raw: row,
  };
}

export async function hubGetFundingRate(symbol) {
  const res = await callAgentHubTool("futures_get_funding_rate", {
    productType: "USDT-FUTURES",
    symbol,
  });
  return hubToolData(res);
}

export async function hubGetOpenInterest(symbol) {
  const res = await callAgentHubTool("futures_get_open_interest", {
    productType: "USDT-FUTURES",
    symbol,
  });
  return hubToolData(res);
}

// ── 下单（执行层） ──

function extractOrderId(data) {
  if (!data) return null;
  if (typeof data === "string") return data;
  const row = Array.isArray(data) ? data[0] : data;
  return row?.orderId || row?.clientOid || row?.data?.orderId || data?.orderId || data?.clientOid || null;
}

export async function hubPlaceSpotOrder({ symbol, side, qty, orderType = "market", price }) {
  const order = {
    symbol,
    side,
    orderType,
    size: String(qty),
    force: orderType === "market" ? "ioc" : "gtc",
    clientOid: `agent-${Date.now()}`,
    ...(price ? { price: String(price) } : {}),
  };
  const res = await callAgentHubTool("spot_place_order", { orders: [order] });
  const data = hubToolData(res);
  const orderId = extractOrderId(data);
  return { orderId, order: data, venue: "bitget-core/spot_place_order" };
}

export async function hubPlaceFuturesOrder({
  symbol,
  side,
  qty,
  posSide = "long",
  reduceOnly = false,
  orderType = "market",
  presetStopLossPrice,
  presetStopSurplusPrice,
  hedgeMode = null,
}) {
  const { getFuturesHedgeMode } = await import("../../../demo-bot/bitget-v3.js");
  let hm = hedgeMode;
  if (hm == null) hm = await getFuturesHedgeMode(symbol);
  if (hm == null) hm = true;

  const order = {
    symbol,
    productType: "USDT-FUTURES",
    marginCoin: "USDT",
    marginMode: "crossed",
    side,
    orderType,
    size: String(qty),
    force: orderType === "market" ? "ioc" : "gtc",
  };

  if (hm) {
    order.tradeSide = reduceOnly ? "close" : "open";
  } else if (reduceOnly) {
    order.reduceOnly = "YES";
  }

  if (presetStopLossPrice) order.presetStopLossPrice = String(presetStopLossPrice);
  if (presetStopSurplusPrice) order.presetStopSurplusPrice = String(presetStopSurplusPrice);

  const res = await callAgentHubTool("futures_place_order", { orders: [order] });
  const data = hubToolData(res);
  const orderId = extractOrderId(data);
  return { orderId, order: data, venue: "bitget-core/futures_place_order" };
}

/** 通过官方 bitget-core 执行策略决策 */
export async function executeDecisionViaHub(decision, strategy, { lastPrice } = {}) {
  const sym = strategy?.symbol || "BTCUSDT";
  const side = decision.action;
  if (side !== "buy" && side !== "sell") {
    return { executed: false, reason: decision.reason || "观望" };
  }

  const qty = String(decision.qty || "");
  if (!qty || Number(qty) <= 0) {
    throw new Error("下单数量无效");
  }

  const useFutures =
    strategy?.category === "futures" ||
    /FUTURES|futures|永续/i.test(String(strategy?.category || "")) ||
    decision.posSide === "short" ||
    (side === "sell" && decision.posSide === "short");

  if (useFutures) {
    const lev = Number(strategy?.leverage) || 5;
    try {
      await hubSetFuturesLeverage(sym, lev);
    } catch (e) {
      console.warn("[executeDecisionViaHub] set leverage failed:", e.message);
    }
    const posSide = decision.posSide || (side === "buy" ? "long" : "long");
    const isClose = side === "sell";
    const futuresSide = isClose
      ? posSide === "short"
        ? "buy"
        : "sell"
      : posSide === "short"
        ? "sell"
        : "buy";
    const hub = await hubPlaceFuturesOrder({
      symbol: sym,
      side: futuresSide,
      qty,
      ...(isClose ? { reduceOnly: true } : { posSide }),
      presetStopLossPrice: strategy?.conditions?.breakoutStop ?? strategy?.risk?.stopPrice,
      presetStopSurplusPrice: strategy?.risk?.takeProfitPrice,
    });
    return {
      executed: !!hub.orderId,
      orderId: hub.orderId,
      order: hub.order,
      venue: hub.venue,
      posSide,
    };
  }

  const hub = await hubPlaceSpotOrder({ symbol: sym, side, qty, orderType: "market" });
  return {
    executed: !!hub.orderId,
    orderId: hub.orderId,
    order: hub.order,
    venue: hub.venue,
  };
}

/** 聊天指令下单 — 现货市价/限价 */
export async function executeChatOrderViaHub({
  symbol,
  side,
  qty,
  orderType = "market",
  price,
  qtyUnit = "base",
  lastPrice,
}) {
  const sym = String(symbol || "BTCUSDT").toUpperCase();
  const size = String(qty);

  if (orderType === "limit" && price) {
    const hub = await hubPlaceSpotOrder({
      symbol: sym,
      side,
      qty: size,
      orderType: "limit",
      price,
    });
    return { ok: !!hub.orderId, orderId: hub.orderId, order: hub.order, price, qty: size, source: "bitget-core" };
  }
  const hub = await hubPlaceSpotOrder({ symbol: sym, side, qty: size, orderType: "market" });
  return {
    ok: !!hub.orderId,
    orderId: hub.orderId,
    order: hub.order,
    price: lastPrice,
    qty: size,
    qtyUnit,
    source: "bitget-core",
  };
}

export async function hubSetFuturesLeverage(symbol, leverage) {
  const res = await callAgentHubTool("futures_set_leverage", {
    productType: "USDT-FUTURES",
    symbol,
    marginCoin: "USDT",
    leverage: String(leverage),
  });
  return hubToolData(res);
}
