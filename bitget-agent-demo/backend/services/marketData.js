/**
 * 市场数据 — 严格 Bitget K 线 + 24h Ticker
 */
import {
  fetchBitgetKlines,
  fetchBitgetTicker24h,
  normalizeGranularity,
} from "./bitgetCandles.js";
import { getTicker, isBitgetConfigured } from "./bitgetClient.js";
import { gatherPerception, SKILL_REGISTRY } from "./perceptionSkills.js";

export { gatherPerception, SKILL_REGISTRY };
export { getSpotSymbols } from "./bitgetClient.js";

export async function getMarketSnapshot(symbol = "BTCUSDT", options = {}) {
  const granularity = options.granularity || "1H";
  const limit = Number(options.limit) || 200;
  const category = options.category || "USDT-FUTURES";

  const kline = await fetchBitgetKlines({ symbol, granularity, limit, category });
  let ticker24h = null;
  try {
    ticker24h = await fetchBitgetTicker24h(symbol, category);
  } catch {
    /* optional */
  }

  let ticker = null;
  try {
    ticker = await getTicker(symbol);
  } catch {
    /* optional */
  }

  const latest = kline.candles.at(-1);
  const price = ticker24h?.last ?? (ticker ? Number(ticker.lastPr || ticker.close) : latest?.close);

  const closes = kline.candles.map((c) => c.close);
  const ma20 =
    closes.length >= 20
      ? +(closes.slice(-20).reduce((a, b) => a + b, 0) / 20).toFixed(8)
      : null;

  return {
    symbol: kline.symbol,
    granularity: normalizeGranularity(granularity).v3,
    category: kline.category,
    source: kline.source,
    bitgetPaper: isBitgetConfigured(),
    timestamp: new Date().toISOString(),
    price,
    ticker24h,
    ma20,
    ma: ma20,
    volume: latest?.volume,
    volumeRatio: null,
    volatility: null,
    candles: kline.candles,
  };
}

export async function getSentimentSnapshot() {
  try {
    const perception = await gatherPerception("BTCUSDT");
    const s = perception.skills.sentimentAnalyst;
    return {
      fearGreed: s.fearGreed,
      label: s.fearGreedLabel,
      fundingRate: s.fundingRate,
      openInterest: s.openInterest,
      longShortRatio: s.longShortRatio,
      source: "perception_skills",
    };
  } catch {
    return { fearGreed: 50, label: "Neutral", source: "local_fallback" };
  }
}
