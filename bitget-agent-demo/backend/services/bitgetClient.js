/**
 * Bitget 客户端 — 交易层复用 demo-bot V3 模拟 API，衍生品走公开接口
 */
import {
  getAssets,
  getTicker,
  placeSpotOrder,
  getUnfilledOrders,
  findAsset,
} from "../../../demo-bot/bitget-v3.js";
import { isSimApiConfigured } from "./simulationApi.js";
import {
  fetchBitgetKlines,
  fetchBitgetTicker24h,
  normalizeGranularity,
  GRANULARITY_MAP,
} from "./bitgetCandles.js";

export { getAssets, getTicker, placeSpotOrder, getUnfilledOrders, findAsset };
export { normalizeGranularity, GRANULARITY_MAP, fetchBitgetKlines, fetchBitgetTicker24h };
export {
  fetchBitgetSpotPrice,
  fetchBitgetFuturesPrice,
  formatLimitPriceError,
} from "./bitgetLivePrice.js";
export const isBitgetConfigured = isSimApiConfigured;

export async function getCandles(symbol, granularity = "1h", limit = 120, category = "USDT-FUTURES") {
  const { candles } = await fetchBitgetKlines({ symbol, granularity, limit, category });
  return sortCandlesAsc(candles);
}

function sortCandlesAsc(candles) {
  return [...candles].sort((a, b) => a.time - b.time);
}

const BASE = "https://api.bitget.com";

async function publicGet(path) {
  const res = await fetch(`${BASE}${path}`, {
    signal: AbortSignal.timeout(15000),
    headers: { Accept: "application/json" },
  });
  const data = await res.json();
  if (data.code !== "00000") throw new Error(`Bitget (${data.code}): ${data.msg}`);
  return data;
}

import { TRADABLE_SYMBOLS } from "./symbolUtils.js";

export async function getSpotSymbols() {
  try {
    const result = await publicGet("/api/v2/spot/public/symbols");
    const list = (result.data || [])
      .filter((s) => s.status === "online" && s.quoteCoin === "USDT")
      .map((s) => s.symbol)
      .sort();
    if (list.length) return list;
  } catch {
    /* fallback */
  }
  return TRADABLE_SYMBOLS;
}

export async function getFundingRate(symbol) {
  const result = await publicGet(
    `/api/v2/mix/market/current-fund-rate?symbol=${symbol}&productType=USDT-FUTURES`
  );
  return result.data?.[0];
}

export async function getOpenInterest(symbol) {
  const result = await publicGet(
    `/api/v2/mix/market/open-interest?symbol=${symbol}&productType=USDT-FUTURES`
  );
  return result.data;
}

export async function getLongShortRatio(symbol, period = "4h") {
  const result = await publicGet(
    `/api/v2/mix/market/account-long-short?symbol=${symbol}&productType=USDT-FUTURES&period=${period}`
  );
  return result.data;
}

export async function getTakerRatio(symbol, period = "4h") {
  const result = await publicGet(
    `/api/v2/mix/market/taker-buy-sell?symbol=${symbol}&productType=USDT-FUTURES&period=${period}`
  );
  return result.data;
}

export async function getConnectionStatus() {
  const status = {
    configured: isSimApiConfigured(),
    paperTrading: true,
    api: "demo-bot/bitget-v3",
    market: false,
    account: false,
    error: null,
  };
  try {
    await getTicker("BTCUSDT");
    status.market = true;
  } catch (e) {
    status.error = e.message;
  }
  if (status.configured) {
    try {
      await Promise.race([
        getAssets(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("account timeout")), 8000)),
      ]);
      status.account = true;
    } catch (e) {
      status.error = status.error || e.message;
    }
  }
  return status;
}
