/**
 * 官方 Skill Hub 数据层 — 优先 bitget-core 市场工具，外部源作补充
 * @see https://github.com/Bitget-AI/agent_hub packages/bitget-skill-hub
 */
import {
  isAgentHubReady,
  hubGetCandles,
  hubGetFundingRate,
  hubGetOpenInterest,
  hubGetTicker,
} from "./agentHubBridge.js";

export async function fetchHubSkillCandles(symbol, granularity = "1H", limit = 120) {
  if (!isAgentHubReady()) return null;
  try {
    const spot = await hubGetCandles(symbol, { granularity, limit, category: "SPOT" });
    if (spot.length >= 35) return { candles: spot, source: "bitget-core/spot_get_candles" };
    const fut = await hubGetCandles(symbol, { granularity, limit, category: "USDT-FUTURES" });
    if (fut.length >= 35) return { candles: fut, source: "bitget-core/futures_get_candles" };
    return spot.length ? { candles: spot, source: "bitget-core/spot_get_candles" } : null;
  } catch {
    return null;
  }
}

export async function fetchHubSentimentExtras(symbol) {
  if (!isAgentHubReady()) return {};
  const out = {};
  try {
    const fr = await hubGetFundingRate(symbol);
    const rate = fr?.fundingRate ?? fr?.currentRate ?? fr?.[0]?.fundingRate;
    if (rate != null) out.fundingRate = +(Number(rate) * 100).toFixed(4);
  } catch { /* ignore */ }
  try {
    const oi = await hubGetOpenInterest(symbol);
    out.openInterest = oi?.openInterest ?? oi?.amount ?? oi?.[0]?.openInterest ?? null;
  } catch { /* ignore */ }
  try {
    const ticker = await hubGetTicker(symbol, { category: "USDT-FUTURES" });
    if (ticker?.lastPr) out.futuresPrice = ticker.lastPr;
  } catch { /* ignore */ }
  return out;
}

export function getOfficialSkillRegistry() {
  return [
    { id: "technical-analysis", label: "技术分析", package: "bitget-skill-hub", dataVia: "bitget-core spot/futures_get_candles" },
    { id: "sentiment-analyst", label: "情绪分析", package: "bitget-skill-hub", dataVia: "bitget-core futures_get_funding_rate + 公开 F&G" },
    { id: "market-intel", label: "市场情报", package: "bitget-skill-hub", dataVia: "Finnhub quote + Bitget ticker + CoinGecko" },
    { id: "news-briefing", label: "新闻简报", package: "bitget-skill-hub", dataVia: "Finnhub crypto news (+ RSS 兜底)" },
    { id: "macro-analyst", label: "宏观分析", package: "bitget-skill-hub", dataVia: "FRED DGS10/DTWEXBGS/FEDFUNDS" },
  ];
}
