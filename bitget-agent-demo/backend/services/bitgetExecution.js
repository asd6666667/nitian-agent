/**
 * 统一下单执行 — 全部走 Bitget 模拟盘 API（bitget-core 优先，bitget-v3 兜底）
 */
import { isSimApiConfigured } from "./simCredentials.js";
import { resolveSpotOrderQty } from "./strategyExecution.js";
import { ensureSpotSymbolPrecision, formatSpotPrice } from "./spotSymbolPrecision.js";
import { validateLimitPrice } from "./limitPriceGuard.js";
import { fetchBitgetSpotPrice } from "./bitgetLivePrice.js";
import {
  executeDecisionViaHub,
  executeChatOrderViaHub,
  getAgentHubRuntime,
  syncHubCredentials,
} from "./agentHubBridge.js";
import { executeAgentTrade } from "./agentTradeExecution.js";

function extractOrderId(data) {
  if (!data) return null;
  if (typeof data === "string") return data;
  const row = Array.isArray(data) ? data[0] : data;
  return (
    row?.orderId ||
    row?.clientOid ||
    row?.data?.orderId ||
    data?.orderId ||
    data?.clientOid ||
    null
  );
}

export function ensureBitgetExecutionReady() {
  syncHubCredentials();
  if (!isSimApiConfigured()) {
    throw new Error("Bitget API 未配置，请先在上方连接模拟盘 Key");
  }
  return true;
}

function normalizeHubExecution(hub, decision, strategy) {
  const useFut =
    strategy?.category === "futures" ||
    /FUTURES|futures|永续/i.test(String(strategy?.category || "")) ||
    /futures/i.test(String(hub.venue || ""));
  const orderId = hub.orderId || extractOrderId(hub.order);
  return {
    orderId,
    ...hub.order,
    venue: hub.venue || "bitget-core",
    source: "bitget-api",
    apiPath: hub.venue || "bitget-core",
    tradeType:
      decision.action === "buy"
        ? useFut
          ? "futures_open_long"
          : "spot_buy"
        : useFut
          ? "futures_close_long"
          : "spot_sell",
    category: useFut ? "USDT-FUTURES" : "SPOT",
    qty: decision.qty,
    posSide: hub.posSide || decision.posSide || null,
    executed: !!orderId,
  };
}

/** Agent 决策 → Bitget API 下单 */
export async function executeBitgetDecision(decision, strategy, options = {}) {
  if (!decision || decision.action === "hold") return null;
  ensureBitgetExecutionReady();

  const sym = String(options.symbol || strategy?.symbol || "BTCUSDT").toUpperCase();
  const strict = options.strict !== false;

  if (decision.action === "buy" || decision.action === "sell") {
    const rt = getAgentHubRuntime(true);
    if (rt.ready) {
      try {
        const live = await fetchBitgetSpotPrice(sym);
        const hub = await executeDecisionViaHub(decision, strategy || { symbol: sym }, {
          lastPrice: live.lastPrice,
        });
        const orderId = hub.orderId || extractOrderId(hub.order);
        if (orderId) {
          return normalizeHubExecution({ ...hub, orderId }, decision, strategy);
        }
        if (hub.executed === false && strict) {
          console.warn("[bitgetExecution] bitget-core 未返回 orderId，回退 v3 API");
        }
      } catch (e) {
        console.warn("[bitgetExecution] bitget-core 失败，回退 v3:", e.message);
        if (strict && !options.allowFallback) throw e;
      }
    }
  }

  const v3 = await executeAgentTrade(decision, strategy, { symbol: sym, strict });
  if (!v3?.orderId) throw new Error("Bitget API 未返回 orderId");
  return {
    ...v3,
    source: "bitget-api",
    apiPath: v3.venue || "bitget-v3",
    executed: true,
  };
}

/** 聊天/手动现货下单 → Bitget API */
export async function executeBitgetSpotOrder({
  symbol,
  side,
  qty,
  orderType = "market",
  price,
  qtyUnit = "base",
  lastPrice,
}) {
  ensureBitgetExecutionReady();
  const sym = String(symbol || "BTCUSDT").toUpperCase();
  await ensureSpotSymbolPrecision(sym);

  const live = await fetchBitgetSpotPrice(sym);
  const marketPrice = live.lastPrice;

  const resolved = resolveSpotOrderQty({
    symbol: sym,
    side,
    orderType,
    qty,
    qtyUnit,
    lastPrice: marketPrice,
  });
  if (!resolved?.qty) {
    throw new Error("下单数量无效（低于最小金额或精度不符）");
  }

  if (orderType === "limit" && price != null) {
    const check = validateLimitPrice(price, marketPrice);
    if (!check.ok) {
      const { formatLimitPriceError } = await import("./bitgetLivePrice.js");
      throw new Error(formatLimitPriceError(check, sym, marketPrice));
    }
  }

  const formattedPrice =
    orderType === "limit" && price != null ? formatSpotPrice(price, sym) : undefined;
  if (orderType === "limit" && price != null && !formattedPrice) {
    throw new Error("限价精度无效");
  }

  const rt = getAgentHubRuntime(true);
  if (rt.ready) {
    try {
      const hubResult = await executeChatOrderViaHub({
        symbol: sym,
        side,
        qty: resolved.qty,
        orderType,
        price: formattedPrice ?? price,
        qtyUnit: resolved.qtyUnit,
        lastPrice: marketPrice,
      });
      const orderId = hubResult.orderId || extractOrderId(hubResult.order);
      if (orderId) {
        return {
          orderId,
          ...hubResult.order,
          source: "bitget-api",
          apiPath: "bitget-core/spot_place_order",
          venue: "bitget-core/spot_place_order",
        };
      }
    } catch (e) {
      console.warn("[bitgetExecution] chat hub 失败，回退 v3:", e.message);
    }
  }

  const { placeSpotOrder } = await import("../../../demo-bot/bitget-v3.js");
  const order = await placeSpotOrder({
    symbol: sym,
    side,
    orderType,
    qty: resolved.qty,
    price: formattedPrice,
    timeInForce: orderType === "market" ? "ioc" : "gtc",
  });

  if (!order?.orderId) throw new Error("Bitget API 未返回 orderId");
  return {
    ...order,
    source: "bitget-api",
    apiPath: "bitget-v3/spot_place_order",
    venue: "bitget-v3/spot_place_order",
  };
}

export function getBitgetExecutionStatus() {
  syncHubCredentials();
  const rt = getAgentHubRuntime();
  return {
    configured: isSimApiConfigured(),
    hubReady: rt.ready,
    hubError: rt.ready ? null : rt.reason,
    primary: rt.ready ? "bitget-core" : "bitget-v3",
    apiBase: "https://api.bitget.com",
    paperTrading: true,
  };
}
