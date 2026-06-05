/** 策略执行层 — 仓位计算与下单数量 */

import { getSpotBaseQtyDecimals } from "./spotSymbolPrecision.js";

const SPOT_MIN_QTY = {
  BTCUSDT: 0.0001,
  ETHUSDT: 0.001,
  SOLUSDT: 0.01,
};
const MIN_NOTIONAL_USD = 5;

export function getMinSellQty(symbol) {
  return SPOT_MIN_QTY[String(symbol || "").toUpperCase()] || 0.0001;
}

function baseQtyDecimals(symbol) {
  return getSpotBaseQtyDecimals(symbol);
}

/** 现货 base 数量 — 向下取整，满足 Bitget delegateAmount 精度 */
export function formatSpotBaseQty(qty, symbol) {
  const q = Number(qty);
  if (!q || q <= 0) return null;
  const decimals = baseQtyDecimals(symbol);
  const factor = 10 ** decimals;
  const rounded = Math.floor(q * factor) / factor;
  if (rounded <= 0) return null;
  return rounded.toFixed(decimals);
}

/** 现货市价买入 USDT 金额 — quote 精度 */
export function formatSpotQuoteQty(qty) {
  const q = Number(qty);
  if (!q || q < 1) return null;
  return (Math.floor(q * 100) / 100).toFixed(2);
}

/**
 * 统一下单数量 — Bitget 现货规则：
 * - 市价买入：qty 为 quote（USDT）
 * - 限价买入 / 市价卖出：qty 为 base
 */
export function resolveSpotOrderQty({
  symbol,
  side,
  orderType = "market",
  qty,
  qtyUnit = "base",
  lastPrice,
}) {
  const sym = String(symbol || "BTCUSDT").toUpperCase();
  const sideL = String(side || "").toLowerCase();
  const typeL = String(orderType || "market").toLowerCase();
  const q = Number(qty);
  if (!q || q <= 0) return null;

  if (typeL === "market" && sideL === "buy") {
    const quote = qtyUnit === "quote" ? q : lastPrice > 0 ? q * lastPrice : null;
    if (!quote) return null;
    const formatted = formatSpotQuoteQty(quote);
    return formatted ? { qty: formatted, qtyUnit: "quote" } : null;
  }

  if (sideL === "buy" && qtyUnit === "quote" && lastPrice > 0) {
    const base = formatSpotBaseQty(q / lastPrice, sym);
    return base ? { qty: base, qtyUnit: "base" } : null;
  }

  const rawBase = qtyUnit === "quote" && lastPrice > 0 ? q / lastPrice : q;
  const base = formatSpotBaseQty(rawBase, sym);
  return base ? { qty: base, qtyUnit: "base" } : null;
}

/** 向下取整并校验最小下单量 / 名义价值 */
export function normalizeSellQty(qty, symbol, lastPrice) {
  const q = Number(qty);
  if (!q || q <= 0) return 0;
  const decimals = baseQtyDecimals(symbol);
  const factor = 10 ** decimals;
  let rounded = Math.floor(q * factor) / factor;
  const minQty = getMinSellQty(symbol);
  const price = Number(lastPrice || 0);
  if (rounded < minQty) return 0;
  if (price > 0 && rounded * price < MIN_NOTIONAL_USD) return 0;
  return rounded;
}

export function hasStrategyPosition({ baseAvailable, lastPrice, sessionEntryPrice, minUsd = MIN_NOTIONAL_USD }) {
  if (!isStrategySessionPosition(sessionEntryPrice)) return false;
  const avail = Number(baseAvailable || 0);
  const price = Number(lastPrice || 0);
  const notional = avail * price;
  return notional >= minUsd;
}

/** 本策略会话是否已记录入场（不含启动前已有现货/合约） */
export function isStrategySessionPosition(sessionEntryPrice) {
  return Number(sessionEntryPrice || 0) > 0;
}

/** 按交易所实时持仓解析：钱包持仓 vs 本策略会话持仓 */
export function resolveLivePositionState({
  symbol,
  strategy,
  posCtx,
  baseAvailable,
  lastPrice,
  sessionEntryPrice = 0,
}) {
  const sessionEntry = Number(sessionEntryPrice || 0);
  const useFutures =
    String(strategy?.category || "").toLowerCase().includes("futures") ||
    posCtx?.hasLong ||
    posCtx?.hasShort;

  if (useFutures) {
    const hasWalletFutures = !!(posCtx?.hasLong || posCtx?.hasShort);
    const pos = posCtx?.hasLong ? posCtx.longPos : posCtx?.shortPos;
    const hasStrategyPosition = isStrategySessionPosition(sessionEntry) && hasWalletFutures;
    let entryPrice = sessionEntry;
    if (hasStrategyPosition && entryPrice <= 0) {
      entryPrice = Number(pos?.avgPrice || pos?.openPrice || lastPrice || 0);
    }
    return {
      hasWalletAsset: hasWalletFutures,
      hasStrategyPosition,
      hasPosition: hasStrategyPosition,
      hasBase: hasWalletFutures,
      entryPrice,
      venue: "futures",
    };
  }

  const avail = Number(baseAvailable || 0);
  const price = Number(lastPrice || 0);
  const notional = avail * price;
  const hasWalletAsset = avail > 0.00001 && notional >= MIN_NOTIONAL_USD;
  const hasStrategyPosition =
    isStrategySessionPosition(sessionEntry) && hasWalletAsset;
  return {
    hasWalletAsset,
    hasStrategyPosition,
    hasPosition: hasStrategyPosition,
    hasBase: hasWalletAsset,
    entryPrice: sessionEntry,
    venue: "spot",
  };
}

export function calcStrategyBuyQty(strategy, usdtAvailable, price) {
  const posPct = (strategy?.positionPct || 10) / 100;
  const spend = Number(usdtAvailable || 0) * posPct;
  if (spend < 1 || !price || price <= 0) return null;
  const qty = spend / price;
  if (qty >= 1) return qty.toFixed(4);
  if (qty >= 0.0001) return qty.toFixed(6);
  return null;
}

export function calcStrategyBuySpend(strategy, usdtAvailable) {
  const posPct = (strategy?.positionPct || 10) / 100;
  const spend = Number(usdtAvailable || 0) * posPct;
  if (spend < 1) return null;
  return formatSpotQuoteQty(spend);
}

export function resolveSellQty(decision, baseAvailable, symbol, lastPrice) {
  const avail = Number(baseAvailable || 0);
  if (avail <= 0) return 0;
  let raw;
  if (decision.qty) raw = Math.min(Number(decision.qty), avail);
  else if (decision.sellPct) raw = avail * Number(decision.sellPct);
  else raw = avail;

  let qty = normalizeSellQty(raw, symbol, lastPrice);
  if (qty <= 0 && raw > 0 && decision.sellPct && decision.sellPct < 1) {
    qty = normalizeSellQty(avail, symbol, lastPrice);
  }
  return Math.min(qty, avail);
}

export function enrichDecisionQty(decision, strategy, { usdtAvailable, baseAvailable, lastPrice, posCtx }) {
  const next = { ...decision };
  const sym = strategy?.symbol || "BTCUSDT";
  const avail =
    posCtx?.hasLong && decision.action === "sell"
      ? posCtx.longSize
      : posCtx?.hasShort && decision.action === "sell"
        ? posCtx.shortSize
        : baseAvailable;

  if (next.action === "buy" && !next.qty) {
    next.qty = calcStrategyBuyQty(strategy, usdtAvailable, lastPrice);
  }
  if (next.action === "sell" && !next.qty) {
    const sellQty = resolveSellQty(next, avail, sym, lastPrice);
    if (sellQty > 0) next.qty = sellQty.toFixed(6);
  }
  return next;
}

export function checkStrategyRisk({
  decision,
  config,
  usdtAvailable,
  baseAvailable,
  lastPrice,
}) {
  if (decision.action === "hold") return { ok: true };

  if (decision.action === "buy") {
    const usdt = Number(usdtAvailable);
    const reserve = Number(config.minUsdtReserve || 0);
    if (usdt <= reserve) {
      return { ok: false, reason: `USDT 可用不足 (可用 ${usdt}, 需保留 ${reserve})` };
    }
    const qty = Number(decision.qty || 0);
    const need = qty * Number(lastPrice || 0);
    if (qty <= 0) return { ok: false, reason: "买入数量为 0" };
    if (need > usdt - reserve) {
      return { ok: false, reason: `USDT 不足以买入 ${qty} (约 ${need.toFixed(2)} USDT)` };
    }
    return { ok: true };
  }

  if (decision.action === "sell") {
    const avail = Number(baseAvailable);
    const sym = strategy?.symbol || "BTCUSDT";
    const sellQty = Number(
      decision.qty || resolveSellQty(decision, avail, sym, lastPrice)
    );
    if (sellQty <= 0) {
      return {
        ok: false,
        reason: `可卖数量不足（可用 ${avail}，低于最小下单量或名义 $${MIN_NOTIONAL_USD}）`,
      };
    }
    if (avail < sellQty * 0.999) {
      return { ok: false, reason: `现货可用不足 (可用 ${avail}, 需卖 ${sellQty})` };
    }
    return { ok: true };
  }

  return { ok: false, reason: "未知 action" };
}
