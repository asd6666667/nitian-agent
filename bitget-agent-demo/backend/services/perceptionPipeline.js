/**
 * 感知层数据管道：拉取 → 清洗 → 五 Skill 融合 → decisionFeed
 */
import { runAllSkills } from "./skillHub.js";
import { fetchAllPerceptionRaw } from "./perceptionDataProviders.js";
import { isAgentHubReady } from "./agentHubBridge.js";
import { isBitgetConfigured } from "./bitgetClient.js";
import { invokeDeepseekPerception } from "./deepseekPerception.js";

export function buildSignals(skills, cleaned) {
  const t = skills.technicalAnalysis;
  const s = skills.sentimentAnalyst;
  const m = skills.macroAnalyst;
  const n = skills.newsBriefing;
  const signals = [];

  if (t?.breakoutAboveMa20) signals.push({ type: "technical", signal: "price_above_ma20", weight: 0.3 });
  if (t?.macd?.bullish) signals.push({ type: "technical", signal: "macd_bullish", weight: 0.25 });
  if (t?.macd?.bearish) signals.push({ type: "technical", signal: "macd_bearish", weight: -0.25 });
  if (t?.sar?.bullish) signals.push({ type: "technical", signal: "sar_bullish", weight: 0.25 });
  if (t?.volumeConfirmed) signals.push({ type: "technical", signal: "volume_ma5_above_ma10", weight: 0.15 });
  if (t?.rsiSignal === "oversold") signals.push({ type: "technical", signal: "rsi_oversold", weight: 0.2 });
  if (t?.rsiSignal === "overbought") signals.push({ type: "technical", signal: "rsi_overbought", weight: -0.2 });

  if (s?.fearGreed <= 25) signals.push({ type: "sentiment", signal: "extreme_fear", weight: 0.15 });
  if (s?.fearGreed >= 75) signals.push({ type: "sentiment", signal: "extreme_greed", weight: -0.15 });
  if (s?.fundingRate != null && s.fundingRate > 0.05) {
    signals.push({ type: "sentiment", signal: "high_funding", weight: -0.1 });
  }

  if (m?.us10yChange != null && m.us10yChange > 0.05) {
    signals.push({ type: "macro", signal: "yield_rising", weight: -0.12, source: "fred" });
  }
  if (m?.us10yChange != null && m.us10yChange < -0.05) {
    signals.push({ type: "macro", signal: "yield_falling", weight: 0.08, source: "fred" });
  }
  if (m?.dxyChange != null && m.dxyChange > 0.3) {
    signals.push({ type: "macro", signal: "dxy_strengthening", weight: -0.1, source: "fred" });
  }
  if (m?.dxyChange != null && m.dxyChange < -0.3) {
    signals.push({ type: "macro", signal: "dxy_weakening", weight: 0.08, source: "fred" });
  }

  const newsScore = n?.sentimentScore ?? cleaned?.finnhub?.news?.sentimentScore;
  if (newsScore != null && newsScore > 0.25) {
    signals.push({ type: "news", signal: "positive_headlines", weight: 0.1, source: "finnhub" });
  }
  if (newsScore != null && newsScore < -0.25) {
    signals.push({ type: "news", signal: "negative_headlines", weight: -0.1, source: "finnhub" });
  }

  const bitgetChg = cleaned?.bitget?.ticker?.change24h;
  if (bitgetChg != null && bitgetChg > 3) {
    signals.push({ type: "market", signal: "strong_24h_rally", weight: 0.08, source: "bitget" });
  }
  if (bitgetChg != null && bitgetChg < -3) {
    signals.push({ type: "market", signal: "strong_24h_selloff", weight: -0.08, source: "bitget" });
  }

  return signals;
}

/** 清洗后的统一上下文，供 Skill 与决策层消费 */
export function cleanPerceptionRaw(raw) {
  const price =
    raw.bitget?.price ??
    raw.finnhub?.quote?.price ??
    raw.bitget?.candles?.at(-1)?.close ??
    null;

  return {
    symbol: raw.symbol,
    fetchedAt: raw.fetchedAt,
    fred: raw.fred,
    finnhub: raw.finnhub,
    bitget: raw.bitget,
    price,
    sources: {
      fred: !!(raw.fred?.ok || raw.fred?.partial),
      finnhub: !!(raw.finnhub?.news?.ok || raw.finnhub?.quote?.ok),
      bitget: !!raw.bitget?.ok,
    },
  };
}

/** 决策层专用精简 feed */
export function buildDecisionFeed(cleaned, skills, composite, deepseekPerception = null) {
  const t = skills.technicalAnalysis;
  const s = skills.sentimentAnalyst;
  const mi = skills.marketIntel;
  const n = skills.newsBriefing;
  const m = skills.macroAnalyst;

  return {
    symbol: cleaned.symbol,
    timestamp: new Date().toISOString(),
    price: cleaned.price ?? t?.price ?? null,
    bias: composite.bias,
    score: composite.score,
    signals: composite.signals,
    macro: {
      us10y: m?.us10yYield ?? cleaned.fred?.us10yYield ?? null,
      us10yChange: m?.us10yChange ?? cleaned.fred?.us10yChange ?? null,
      dxy: m?.dxy ?? cleaned.fred?.dxy ?? null,
      dxyChange: m?.dxyChange ?? cleaned.fred?.dxyChange ?? null,
      fedFunds: m?.fedFunds ?? cleaned.fred?.fedFunds ?? null,
      source: "fred",
    },
    market: {
      price: cleaned.bitget?.price ?? cleaned.finnhub?.quote?.price ?? null,
      change24h: cleaned.bitget?.ticker?.change24h ?? mi?.coinPrice24hChange ?? cleaned.finnhub?.quote?.changePct ?? null,
      volume24h: cleaned.bitget?.ticker?.volume24h ?? null,
      fundingRate: s?.fundingRate ?? cleaned.bitget?.fundingRate ?? null,
      openInterest: s?.openInterest ?? cleaned.bitget?.openInterest ?? null,
      btcDominance: mi?.btcDominance ?? null,
      source: "bitget+finnhub",
    },
    sentiment: {
      fearGreed: s?.fearGreed ?? null,
      fearGreedLabel: s?.fearGreedLabel ?? null,
      longShortRatio: s?.longShortRatio ?? cleaned.bitget?.longShortRatio ?? null,
      takerBuyRatio: s?.takerBuyRatio ?? cleaned.bitget?.takerBuyRatio ?? null,
    },
    news: {
      topHeadlines: (n?.headlines || cleaned.finnhub?.news?.headlines || []).slice(0, 5),
      sentimentScore: n?.sentimentScore ?? cleaned.finnhub?.news?.sentimentScore ?? 0,
      source: n?.dataSource || "finnhub",
    },
    technical: {
      trend: t?.trend ?? "neutral",
      rsi: t?.rsi ?? null,
      ma20: t?.ma20 ?? null,
      volumeConfirmed: t?.volumeConfirmed ?? false,
      source: t?.hubSource || cleaned.bitget?.candleSource || "bitget",
    },
    skillsSummary: {
      technical: t?.summary,
      sentiment: s?.summary,
      marketIntel: mi?.summary,
      news: n?.summary,
      macro: m?.summary,
    },
    deepseek: deepseekPerception
      ? {
          model: deepseekPerception.model,
          summary: deepseekPerception.summary,
          riskNote: deepseekPerception.riskNote,
          keySignals: deepseekPerception.keySignals,
        }
      : null,
    sources: cleaned.sources,
    pipeline: "fetch→clean→skills→deepseek-lite→decisionFeed",
    ready: cleaned.sources.fred && cleaned.sources.finnhub && cleaned.sources.bitget,
  };
}

/** 完整感知管道 */
export async function runPerceptionPipeline(symbol) {
  const raw = await fetchAllPerceptionRaw(symbol);
  raw.symbol = symbol;
  const cleaned = cleanPerceptionRaw(raw);

  const skills = await runAllSkills(symbol, cleaned.bitget?.candles || [], cleaned);
  const signals = buildSignals(skills, cleaned);
  const ruleScore = Math.max(-1, Math.min(1, signals.reduce((s, x) => s + x.weight, 0)));
  const ruleComposite = {
    score: +ruleScore.toFixed(2),
    bias: ruleScore > 0.2 ? "bullish" : ruleScore < -0.2 ? "bearish" : "neutral",
    signals,
  };

  let deepseekPerception = null;
  let deepseekError = null;
  try {
    deepseekPerception = await invokeDeepseekPerception({
      symbol,
      cleaned,
      skills,
      ruleComposite,
      ruleSignals: signals,
    });
  } catch (e) {
    deepseekError = e.message;
    console.warn("[perception] DeepSeek Flash 不可用:", e.message);
  }

  const composite = deepseekPerception
    ? {
        score: deepseekPerception.score,
        bias: deepseekPerception.bias,
        signals: [
          ...signals,
          ...(deepseekPerception.llmSignals || []),
        ],
        ruleScore: ruleComposite.score,
        ruleBias: ruleComposite.bias,
      }
    : ruleComposite;

  const decisionFeed = buildDecisionFeed(cleaned, skills, composite, deepseekPerception);
  const candleSource = cleaned.bitget?.candleSource || "bitget";

  return {
    symbol,
    timestamp: new Date().toISOString(),
    source: candleSource,
    bitgetConnected: isBitgetConfigured(),
    agentHubCore: isAgentHubReady(),
    skillHub: "bitget-skill-hub",
    dataProviders: {
      fred: cleaned.sources.fred,
      finnhub: cleaned.sources.finnhub,
      bitget: cleaned.sources.bitget,
    },
    skills,
    composite,
    decisionFeed,
    deepseekPerception,
    deepseekUsed: !!deepseekPerception,
    deepseekError,
    candles: cleaned.bitget?.candles || [],
    cleaned,
  };
}
