/**
 * 下单 / 限价校验前 — 强制从 Bitget 公开 API 拉最新价（不用缓存、不用感知层估价）
 */
import { getTicker, getFuturesTicker } from "../../../demo-bot/bitget-v3.js";
import { formatSpotPrice } from "./spotSymbolPrecision.js";

function pickLastPrice(ticker) {
  return Number(ticker?.lastPr ?? ticker?.last ?? ticker?.close ?? 0);
}

/** 现货最新价 — GET /api/v2/spot/market/tickers */
export async function fetchBitgetSpotPrice(symbol) {
  const sym = String(symbol || "BTCUSDT").toUpperCase();
  const ticker = await getTicker(sym);
  const lastPrice = pickLastPrice(ticker);
  if (!lastPrice || !Number.isFinite(lastPrice)) {
    throw new Error(`Bitget API 未返回 ${sym} 现货现价，请稍后重试`);
  }
  return {
    symbol: sym,
    lastPrice,
    bid: Number(ticker?.bidPr || 0) || null,
    ask: Number(ticker?.askPr || 0) || null,
    ticker,
    venue: "bitget-api/spot/tickers",
    source: "bitget-api",
    fetchedAt: Date.now(),
  };
}

/** 合约最新价 — GET /api/v2/mix/market/ticker */
export async function fetchBitgetFuturesPrice(symbol) {
  const sym = String(symbol || "BTCUSDT").toUpperCase();
  const ticker = await getFuturesTicker(sym);
  const lastPrice = pickLastPrice(ticker);
  if (!lastPrice || !Number.isFinite(lastPrice)) {
    throw new Error(`Bitget API 未返回 ${sym} 合约现价，请稍后重试`);
  }
  return {
    symbol: sym,
    lastPrice,
    bid: Number(ticker?.bidPr || 0) || null,
    ask: Number(ticker?.askPr || 0) || null,
    ticker,
    venue: "bitget-api/mix/ticker",
    source: "bitget-api",
    fetchedAt: Date.now(),
  };
}

/** 限价偏离提示 — 附带 Bitget 实时价与允许区间 */
export function formatLimitPriceError(check, symbol, livePrice) {
  if (!check?.error) return check?.error || "限价无效";
  const px = formatSpotPrice(livePrice, symbol) || Number(livePrice).toFixed(2);
  const band = check.band;
  if (!band) return `${check.error}（Bitget ${symbol} 现价 $${px}）`;
  const min = formatSpotPrice(band.min, symbol) || band.min.toFixed(2);
  const max = formatSpotPrice(band.max, symbol) || band.max.toFixed(2);
  return `${check.error} · Bitget ${symbol} 现价 $${px} · 允许 ${min} ~ ${max}`;
}
