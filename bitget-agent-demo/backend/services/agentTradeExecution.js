/**
 * Agent 统一下单 — 现货/合约真实执行 + 可审计记录
 */
import {
  getAssets,
  placeSpotOrder,
  placeFuturesOrder,
  getCurrentPositions,
  findAsset,
  setFuturesLeverage,
} from "../../../demo-bot/bitget-v3.js";
import { normalizeFuturesPositions } from "./futuresUtils.js";
import {
  calcStrategyBuyQty,
  calcStrategyBuySpend,
  resolveSellQty,
  normalizeSellQty,
  resolveSpotOrderQty,
  formatSpotBaseQty,
} from "./strategyExecution.js";

export function isFuturesStrategy(strategy) {
  const c = String(strategy?.category || "").toLowerCase();
  return c === "futures" || c === "usdt-futures" || c.includes("futures") || c.includes("永续");
}

export function tradeTypeLabel(tradeType) {
  const map = {
    spot_buy: "现货买入",
    spot_sell: "现货卖出",
    futures_open_long: "合约开多",
    futures_open_short: "合约开空",
    futures_close_long: "合约平多",
    futures_close_short: "合约平空",
  };
  return map[tradeType] || tradeType || "交易";
}

export function buildTradeRecord({
  ts,
  source = "trading-agent",
  strategyRunId,
  strategyType,
  tradeType,
  category,
  symbol,
  side,
  posSide,
  qty,
  price,
  orderType = "market",
  order,
  executed,
  orderError,
  decision,
  agent,
  strategyName,
}) {
  const label = tradeTypeLabel(tradeType);
  return {
    ts: ts || new Date().toISOString(),
    source,
    strategyRunId: strategyRunId || null,
    strategyType: strategyType || null,
    strategyName: strategyName || null,
    tradeType,
    tradeLabel: label,
    category: category || (tradeType?.startsWith("futures") ? "USDT-FUTURES" : "SPOT"),
    symbol,
    side,
    posSide: posSide || null,
    qty: qty != null ? String(qty) : null,
    price: price != null ? Number(price) : null,
    orderType,
    order: order?.orderId
      ? { orderId: order.orderId, clientOid: order.clientOid || order.clientOrderId }
      : order || null,
    executed: !!executed,
    orderError: orderError || null,
    decision: decision
      ? { action: decision.action, reason: decision.reason, blockedAction: decision.blockedAction }
      : null,
    agent: agent || null,
  };
}

export async function fetchPositionContext(symbol, strategy = null) {
  const sym = String(symbol || "BTCUSDT").toUpperCase();
  const baseCoin = sym.replace(/USDT$/i, "");
  const assets = await getAssets();
  const usdtAvailable = findAsset(assets, "USDT")?.available ?? "0";
  const spotAvail = Number(findAsset(assets, baseCoin)?.available ?? 0);

  let futures = [];
  try {
    futures = normalizeFuturesPositions(await getCurrentPositions("USDT-FUTURES"));
  } catch {
    futures = [];
  }

  const longPos = futures.find((p) => p.symbol === sym && p.holdSide === "long");
  const shortPos = futures.find((p) => p.symbol === sym && p.holdSide === "short");
  const longSize = Number(longPos?.total || 0);
  const shortSize = Number(shortPos?.total || 0);

  const preferFutures = isFuturesStrategy(strategy);
  const venue =
    preferFutures || longSize > 0 || shortSize > 0
      ? longSize > 0 || shortSize > 0 || preferFutures
        ? "futures"
        : "spot"
      : "spot";

  return {
    symbol: sym,
    baseCoin,
    venue: preferFutures ? "futures" : venue,
    usdtAvailable,
    spotAvailable: spotAvail,
    longSize,
    shortSize,
    longPos,
    shortPos,
    hasSpot: spotAvail * 1 > 0.00001,
    hasLong: longSize > 0,
    hasShort: shortSize > 0,
    hasPosition: longSize > 0 || shortSize > 0 || spotAvail > 0.00001,
  };
}

function formatQty(qty, symbol) {
  const q = Number(qty);
  if (!q || q <= 0) return null;
  if (q >= 1) return q.toFixed(4);
  return q.toFixed(6);
}

function resolveFuturesCloseQty(decision, positionSize, symbol, lastPrice) {
  const avail = Number(positionSize || 0);
  if (avail <= 0) return 0;
  let raw;
  if (decision.qty) raw = Math.min(Number(decision.qty), avail);
  else if (decision.sellPct) raw = avail * Number(decision.sellPct);
  else raw = avail;
  const qty = normalizeSellQty(raw, symbol, lastPrice) || normalizeSellQty(avail, symbol, lastPrice);
  return Math.min(qty || 0, avail);
}

async function executeFuturesTrade(decision, strategy, sym, ctx) {
  const { fetchBitgetFuturesPrice } = await import("./bitgetLivePrice.js");
  const live = await fetchBitgetFuturesPrice(sym);
  const lastPrice = live.lastPrice;
  if (!lastPrice) throw new Error("无法获取合约现价");

  const lev = Number(strategy?.leverage) || 5;
  try {
    await setFuturesLeverage(sym, lev);
  } catch (e) {
    console.warn("[executeFuturesTrade] set leverage failed:", e.message);
  }

  if (decision.action === "buy" && decision.posSide === "short") {
    let qty = decision.qty || calcStrategyBuyQty(strategy, ctx.usdtAvailable, lastPrice);
    if (!qty || Number(qty) <= 0) throw new Error("合约开空数量无效");
    qty = formatQty(qty, sym);
    const order = await placeFuturesOrder({
      symbol: sym,
      side: "sell",
      posSide: "short",
      orderType: "market",
      qty,
      reduceOnly: "NO",
    });
    return {
      order,
      tradeType: "futures_open_short",
      qty,
      price: lastPrice,
      posSide: "short",
      side: "sell",
    };
  }

  if (decision.action === "buy") {
    let qty = decision.qty;
    if (!qty) qty = calcStrategyBuyQty(strategy, ctx.usdtAvailable, lastPrice);
    if (!qty || Number(qty) <= 0) throw new Error("合约开多数量无效");
    qty = formatQty(qty, sym);
    const order = await placeFuturesOrder({
      symbol: sym,
      side: "buy",
      posSide: "long",
      orderType: "market",
      qty,
      reduceOnly: "NO",
    });
    return {
      order,
      tradeType: "futures_open_long",
      qty,
      price: lastPrice,
      posSide: "long",
      side: "buy",
    };
  }

  if (decision.action === "sell") {
    if (ctx.hasLong) {
      const qty = formatQty(
        resolveFuturesCloseQty(decision, ctx.longSize, sym, lastPrice),
        sym
      );
      if (!qty || Number(qty) <= 0) throw new Error(`合约平多数量无效（持仓 ${ctx.longSize}）`);
      const order = await placeFuturesOrder({
        symbol: sym,
        side: "sell",
        posSide: "long",
        orderType: "market",
        qty,
        reduceOnly: "YES",
      });
      return {
        order,
        tradeType: "futures_close_long",
        qty,
        price: lastPrice,
        posSide: "long",
        side: "close",
      };
    }
    if (ctx.hasShort) {
      const qty = formatQty(
        resolveFuturesCloseQty(decision, ctx.shortSize, sym, lastPrice),
        sym
      );
      if (!qty || Number(qty) <= 0) throw new Error(`合约平空数量无效（持仓 ${ctx.shortSize}）`);
      const order = await placeFuturesOrder({
        symbol: sym,
        side: "buy",
        posSide: "short",
        orderType: "market",
        qty,
        reduceOnly: "YES",
      });
      return {
        order,
        tradeType: "futures_close_short",
        qty,
        price: lastPrice,
        posSide: "short",
        side: "close",
      };
    }
    if (isFuturesStrategy(strategy) && strategy?.conditions?.bidirectional) {
      let qty = decision.qty || calcStrategyBuyQty(strategy, ctx.usdtAvailable, lastPrice);
      qty = formatQty(qty, sym);
      if (!qty) throw new Error("合约开空数量无效");
      const order = await placeFuturesOrder({
        symbol: sym,
        side: "sell",
        posSide: "short",
        orderType: "market",
        qty,
        reduceOnly: "NO",
      });
      return {
        order,
        tradeType: "futures_open_short",
        qty,
        price: lastPrice,
        posSide: "short",
        side: "sell",
      };
    }
    throw new Error("无可平合约仓位");
  }

  throw new Error(`不支持的合约决策: ${decision.action}`);
}

async function executeSpotTrade(decision, strategy, sym, ctx, { strict }) {
  const { fetchBitgetSpotPrice } = await import("./bitgetLivePrice.js");
  const live = await fetchBitgetSpotPrice(sym);
  const lastPrice = live.lastPrice;
  const buffer = 1.002;
  let qty = decision.qty;

  if (decision.action === "buy") {
    let rawQty = decision.qty;
    let rawUnit = "base";
    if (strict) {
      if (!rawQty) {
        rawQty = calcStrategyBuySpend(strategy, ctx.usdtAvailable);
        rawUnit = "quote";
      } else if (lastPrice > 0) {
        rawQty = Number(rawQty) * lastPrice;
        rawUnit = "quote";
      }
    } else {
      rawQty = rawQty || calcStrategyBuyQty(strategy, ctx.usdtAvailable, lastPrice);
      rawUnit = "base";
    }
    const resolved = resolveSpotOrderQty({
      symbol: sym,
      side: "buy",
      orderType: strict ? "market" : "limit",
      qty: rawQty,
      qtyUnit: rawUnit,
      lastPrice,
    });
    if (!resolved?.qty) throw new Error("买入数量无效");
    qty = resolved.qty;
    const order = strict
      ? await placeSpotOrder({ symbol: sym, side: "buy", orderType: "market", qty, timeInForce: "ioc" })
      : await placeSpotOrder({
          symbol: sym,
          side: "buy",
          orderType: "limit",
          qty,
          price: String(Math.ceil(lastPrice * buffer)),
        });
    return { order, tradeType: "spot_buy", qty, price: lastPrice, side: "buy", posSide: null };
  }

  if (decision.action === "sell") {
    const sellQty = resolveSellQty(decision, ctx.spotAvailable, sym, lastPrice);
    if (sellQty <= 0) throw new Error(`现货可卖不足（可用 ${ctx.spotAvailable}）`);
    qty = formatSpotBaseQty(sellQty, sym);
    if (!qty) throw new Error("卖出数量无效");
    const order = strict
      ? await placeSpotOrder({ symbol: sym, side: "sell", orderType: "market", qty, timeInForce: "ioc" })
      : await placeSpotOrder({
          symbol: sym,
          side: "sell",
          orderType: "limit",
          qty,
          price: String(Math.floor(lastPrice * (2 - buffer))),
        });
    return { order, tradeType: "spot_sell", qty, price: lastPrice, side: "sell", posSide: null };
  }

  return null;
}

/**
 * 真实执行 Agent 决策（现货优先；现货无可卖时自动走合约平仓）
 */
export async function executeAgentTrade(decision, strategy, options = {}) {
  const sym = String(options.symbol || strategy?.symbol || "BTCUSDT").toUpperCase();
  const strict = options.strict !== false;
  if (!decision || decision.action === "hold") return null;

  const ctx = await fetchPositionContext(sym, strategy);
  let venue = isFuturesStrategy(strategy) ? "futures" : "spot";

  if (venue === "spot" && decision.action === "sell" && ctx.spotAvailable <= 0.00001) {
    if (ctx.hasLong || ctx.hasShort) venue = "futures";
  }
  if (venue === "spot" && decision.action === "buy" && isFuturesStrategy(strategy)) {
    venue = "futures";
  }

  let result;
  if (venue === "futures") {
    try {
      result = await executeFuturesTrade(decision, strategy, sym, ctx);
    } catch (e) {
      if (decision.action === "sell" && ctx.spotAvailable > 0.00001) {
        result = await executeSpotTrade(decision, strategy, sym, ctx, { strict });
      } else {
        throw e;
      }
    }
  } else {
    try {
      result = await executeSpotTrade(decision, strategy, sym, ctx, { strict });
    } catch (e) {
      if (decision.action === "sell" && (ctx.hasLong || ctx.hasShort)) {
        result = await executeFuturesTrade(decision, strategy, sym, ctx);
      } else {
        throw e;
      }
    }
  }

  if (!result?.order?.orderId) {
    throw new Error("交易所未返回 orderId");
  }

  return {
    orderId: result.order.orderId,
    ...result.order,
    tradeType: result.tradeType,
    tradeLabel: tradeTypeLabel(result.tradeType),
    category: result.tradeType.startsWith("futures") ? "USDT-FUTURES" : "SPOT",
    qty: result.qty,
    price: result.price,
    posSide: result.posSide,
    side: result.side,
    venue,
    source: "bitget-api",
    apiPath: venue === "futures" ? "bitget-v3/futures" : "bitget-v3/spot",
  };
}
