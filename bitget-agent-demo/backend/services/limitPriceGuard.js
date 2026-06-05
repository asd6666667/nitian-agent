/** Bitget 限价偏离现价不得超过约 2%（错误码 25206） */
import { formatSpotPrice } from "./spotSymbolPrecision.js";

export const LIMIT_PRICE_BAND = 0.02;

export function getLimitPriceBand(lastPrice) {
  const market = Number(lastPrice);
  if (!market || market <= 0) return null;
  return {
    market,
    min: market * (1 - LIMIT_PRICE_BAND),
    max: market * (1 + LIMIT_PRICE_BAND),
  };
}

export function validateLimitPrice(price, lastPrice) {
  const band = getLimitPriceBand(lastPrice);
  if (!band) return { ok: true };
  const px = Number(price);
  if (!px || px <= 0) return { ok: false, error: "限价无效", band };
  const deviation = Math.abs(px - band.market) / band.market;
  if (deviation > LIMIT_PRICE_BAND + 1e-9) {
    return {
      ok: false,
      error: `限价 ${px} 偏离现价 ${band.market.toFixed(2)} 超过 2%（允许 ${band.min.toFixed(2)} ~ ${band.max.toFixed(2)}）`,
      band,
    };
  }
  return { ok: true, band };
}

/** 限价未指定时：买单略低于现价，卖单略高于现价（仍在 ±2% 内） */
export function defaultLimitPrice(lastPrice, side, symbol = null) {
  const band = getLimitPriceBand(lastPrice);
  if (!band) return null;
  const bias = side === "sell" ? 1.001 : 0.999;
  let px = band.market * bias;
  px = Math.min(band.max, Math.max(band.min, px));
  if (symbol) {
    const formatted = formatSpotPrice(px, symbol);
    return formatted ? Number(formatted) : Number(px.toFixed(2));
  }
  const decimals = band.market >= 1000 ? 2 : 2;
  return Number(px.toFixed(decimals));
}
