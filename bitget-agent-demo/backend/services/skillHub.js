/**
 * Bitget Skill Hub — 五类感知 Skill 数据提供者
 * 对齐 .cursor/skills/* 与 local market-data-mcp 工具规范
 */
import { getCandles, getFundingRate, getOpenInterest, getLongShortRatio, getTakerRatio, getTicker } from "./bitgetClient.js";
import { computeMa, computeMacd, computeSar, computeVolumeMaConfirm } from "./indicators.js";
import { fetchHubSkillCandles, fetchHubSentimentExtras } from "./hubSkillProvider.js";

export const SKILL_REGISTRY = [
  { id: "technical-analysis", label: "技术分析", intervalSec: 60, hub: "bitget-skill-hub", dataVia: "Bitget K线 + 指标" },
  { id: "sentiment-analyst", label: "情绪分析", intervalSec: 30, hub: "bitget-skill-hub", dataVia: "Bitget 衍生品 + F&G" },
  { id: "market-intel", label: "市场情报", intervalSec: 45, hub: "bitget-skill-hub", dataVia: "Finnhub + Bitget + CoinGecko" },
  { id: "news-briefing", label: "新闻简报", intervalSec: 120, hub: "bitget-skill-hub", dataVia: "Finnhub crypto news" },
  { id: "macro-analyst", label: "宏观分析", intervalSec: 300, hub: "bitget-skill-hub", dataVia: "FRED 利率/DXY/联邦基金" },
];

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(opts.timeout || 12000),
    headers: { Accept: "application/json", ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function stamp(data) {
  return { ...data, updatedAt: new Date().toISOString() };
}

function computeRsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return +((100 - 100 / (1 + gains / period / avgLoss)).toFixed(2));
}

function computeMaLegacy(values, period) {
  if (values.length < period) return null;
  return +(values.slice(-period).reduce((a, b) => a + b, 0) / period).toFixed(2);
}

/** technical-analysis Skill — Bitget K线 + RSI/MA/MACD/SAR */
export async function runTechnicalAnalysis(symbol, candles) {
  let c = candles;
  let hubSource = null;
  if (!c?.length) {
    const hub = await fetchHubSkillCandles(symbol, "1H", 120);
    if (hub?.candles?.length) {
      c = hub.candles;
      hubSource = hub.source;
    } else {
      c = await getCandles(symbol, "1h", 120).catch(() => []);
    }
  }
  if (!c?.length) return stamp({ skill: "technical-analysis", ok: false, summary: "K线数据暂不可用" });

  const closes = c.map((x) => x.close);
  const latest = c.at(-1);
  const ma5 = computeMaLegacy(closes, 5);
  const ma10 = computeMaLegacy(closes, 10);
  const ma20 = computeMaLegacy(closes, 20);
  const rsi = computeRsi(closes, 14);
  const macd = computeMacd(closes);
  const sar = computeSar(c);
  const volume = computeVolumeMaConfirm(c);
  const volumeConfirmed = volume.ok;
  let trend = "neutral";
  if (ma5 && ma20) {
    if (latest.close > ma20 && ma5 > ma20) trend = "bullish";
    else if (latest.close < ma20 && ma5 < ma20) trend = "bearish";
  }
  const trendZh = trend === "bullish" ? "偏多" : trend === "bearish" ? "偏空" : "震荡";
  const macdPart = macd
    ? ` · MACD DIF ${macd.dif}/${macd.dea}`
    : "";
  const sarPart = sar ? ` · SAR ${sar.value} (${sar.priceAboveSar ? "价上" : "价下"})` : "";
  return stamp({
    skill: "technical-analysis",
    ok: true,
    hubSource,
    price: latest.close,
    ma5,
    ma10,
    ma20,
    rsi,
    macd,
    sar,
    volumeConfirmed,
    trend,
    rsiSignal: rsi >= 70 ? "overbought" : rsi <= 30 ? "oversold" : "neutral",
    breakoutAboveMa20: ma20 ? latest.close > ma20 : null,
    summary: `${trendZh} · RSI ${rsi ?? "—"} · MA20 $${ma20?.toLocaleString() ?? "—"}${macdPart}${sarPart}`,
  });
}

/** sentiment-analyst Skill — Bitget 衍生品 + F&G（ctx 来自 perceptionPipeline） */
export async function runSentimentAnalysis(symbol, ctx = null) {
  const bitgetCtx = ctx?.bitget;
  const hubExtras = bitgetCtx
    ? {
        fundingRate: bitgetCtx.fundingRate,
        openInterest: bitgetCtx.openInterest,
        futuresPrice: bitgetCtx.futuresPrice,
      }
    : await fetchHubSentimentExtras(symbol);

  const [fng, funding, oi, lsRatio, taker] = await Promise.all([
    fetchJson("https://api.alternative.me/fng/?limit=1").catch(() => null),
    hubExtras.fundingRate != null
      ? Promise.resolve({ fundingRate: hubExtras.fundingRate / 100 })
      : getFundingRate(symbol).catch(() => null),
    hubExtras.openInterest != null
      ? Promise.resolve({ openInterest: hubExtras.openInterest })
      : getOpenInterest(symbol).catch(() => null),
    bitgetCtx?.longShortRatio != null
      ? Promise.resolve({ longShortRatio: bitgetCtx.longShortRatio })
      : getLongShortRatio(symbol, "4h").catch(() => null),
    bitgetCtx?.takerBuyRatio != null
      ? Promise.resolve({ buyRatio: bitgetCtx.takerBuyRatio })
      : getTakerRatio(symbol, "4h").catch(() => null),
  ]);

  const fg = fng?.data?.[0];
  const lsLatest = Array.isArray(lsRatio) ? lsRatio.at(-1) : lsRatio;
  const takerLatest = Array.isArray(taker) ? taker.at(-1) : taker;
  const fundingPct = funding?.fundingRate != null ? +(Number(funding.fundingRate) * 100).toFixed(4) : null;

  const parts = [];
  if (fg) parts.push(`F&G ${fg.value} (${fg.value_classification})`);
  if (fundingPct != null) parts.push(`资金费率 ${fundingPct}%`);
  if (lsLatest?.longShortRatio) parts.push(`L/S ${lsLatest.longShortRatio}`);

  return stamp({
    skill: "sentiment-analyst",
    ok: !!fg || !!funding || !!bitgetCtx?.fundingRate,
    dataSource: "bitget+fng",
    hubSource: hubExtras.fundingRate != null ? "bitget-core/futures_get_funding_rate" : "bitget_api",
    fearGreed: fg ? Number(fg.value) : 50,
    fearGreedLabel: fg?.value_classification || "Neutral",
    fundingRate: fundingPct,
    openInterest: oi?.openInterest ?? oi?.amount ?? null,
    longShortRatio: lsLatest?.longShortRatio ?? lsLatest?.longRate ?? null,
    takerBuyRatio: takerLatest?.buyRatio ?? null,
    summary: parts.join(" · ") || "情绪数据暂不可用",
  });
}

/** market-intel Skill — Finnhub 报价 + Bitget 行情 + 全球结构 */
export async function runMarketIntel(symbol, ctx = null) {
  const fhQuote = ctx?.finnhub?.quote;
  const bitgetTicker = ctx?.bitget?.ticker;
  const coinId = symbol.includes("ETH") ? "ethereum" : "bitcoin";
  const [global, coinPrice, defiChains, btcFees, ticker] = await Promise.all([
    fetchJson("https://api.coingecko.com/api/v3/global").catch(() => null),
    fetchJson(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`
    ).catch(() => null),
    fetchJson("https://api.llama.fi/v2/chains").catch(() => null),
    fetchJson("https://mempool.space/api/v1/fees/recommended").catch(() => null),
    bitgetTicker ? Promise.resolve(null) : getTicker(symbol).catch(() => null),
  ]);

  const g = global?.data;
  const fhPrice = fhQuote?.ok ? fhQuote.price : null;
  const fhChg = fhQuote?.changePct ?? null;
  let totalMarketCapUsd = g?.total_market_cap?.usd;
  let btcDominance = g?.market_cap_percentage?.btc;
  let marketCapChange24h = g?.market_cap_change_percentage_24h_usd;

  const coin = coinPrice?.[coinId];
  if (!totalMarketCapUsd && coin?.usd_market_cap) {
    totalMarketCapUsd = coin.usd_market_cap;
  }
  if (marketCapChange24h == null && coin?.usd_24h_change != null) {
    marketCapChange24h = coin.usd_24h_change;
  }
  if (!totalMarketCapUsd && (ticker || bitgetTicker || fhPrice)) {
    const px = fhPrice ?? bitgetTicker?.last ?? Number(ticker?.lastPr);
    totalMarketCapUsd = px * 19_000_000;
    marketCapChange24h =
      bitgetTicker?.change24h ?? fhChg ?? Number(ticker?.changeUtc24h || ticker?.change24h || 0);
  }

  const totalTvl = Array.isArray(defiChains)
    ? defiChains.reduce((s, c) => s + (c.tvl || 0), 0)
    : null;

  const parts = [];
  if (totalMarketCapUsd) parts.push(`总市值 $${(totalMarketCapUsd / 1e12).toFixed(2)}T`);
  if (btcDominance) parts.push(`BTC 占比 ${btcDominance.toFixed(1)}%`);
  if (marketCapChange24h != null) parts.push(`24h ${marketCapChange24h >= 0 ? "+" : ""}${marketCapChange24h.toFixed(2)}%`);
  if (totalTvl) parts.push(`DeFi TVL $${(totalTvl / 1e9).toFixed(0)}B`);
  if (btcFees?.fastestFee) parts.push(`BTC 手续费 ${btcFees.fastestFee} sat/vB`);

  if (fhPrice) parts.unshift(`Finnhub $${fhPrice.toLocaleString()}`);
  if (bitgetTicker?.last) parts.unshift(`Bitget $${bitgetTicker.last.toLocaleString()}`);

  return stamp({
    skill: "market-intel",
    ok: parts.length > 0,
    dataSource: "finnhub+bitget+coingecko",
    finnhubPrice: fhPrice,
    bitgetPrice: bitgetTicker?.last ?? (ticker ? Number(ticker.lastPr) : null),
    totalMarketCapUsd,
    btcDominance: btcDominance ? +btcDominance.toFixed(2) : null,
    marketCapChange24h: marketCapChange24h != null ? +marketCapChange24h.toFixed(2) : null,
    defiTvlUsd: totalTvl,
    btcFeeSatVb: btcFees?.fastestFee ?? null,
    coinPrice24hChange: coin?.usd_24h_change ?? null,
    summary: parts.join(" · ") || "市场结构数据暂不可用",
  });
}

/** news-briefing Skill — Finnhub 加密新闻（RSS 兜底） */
export async function runNewsBriefing(ctx = null) {
  const finnhubNews = ctx?.finnhub?.news;
  if (finnhubNews?.ok && finnhubNews.headlines?.length) {
    return stamp({
      skill: "news-briefing",
      ok: true,
      dataSource: "finnhub",
      headlines: finnhubNews.headlines.slice(0, 8),
      sentimentScore: finnhubNews.sentimentScore,
      summary: finnhubNews.headlines[0]?.title || "Finnhub 加密新闻",
    });
  }

  const feeds = {
    cointelegraph: "https://cointelegraph.com/rss",
    coindesk: "https://www.coindesk.com/arc/outboundfeeds/rss/",
    decrypt: "https://decrypt.co/feed",
  };
  const headlines = [];
  for (const [source, url] of Object.entries(feeds)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const text = await res.text();
      const titles = [...text.matchAll(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/g)]
        .map((m) => m[1])
        .filter((t) => t.length > 15 && !/rss|cointelegraph|coindesk|decrypt/i.test(t))
        .slice(0, 2);
      titles.forEach((title) => headlines.push({ source, title, time: Date.now() }));
    } catch {
      /* skip */
    }
  }
  return stamp({
    skill: "news-briefing",
    ok: headlines.length > 0,
    dataSource: "rss_fallback",
    headlines: headlines.slice(0, 8),
    sentimentScore: 0,
    summary: headlines[0]?.title || "暂无新闻（RSS 更新间隔 15–60 分钟）",
  });
}

/** macro-analyst Skill — FRED 官方宏观序列（Yahoo 兜底） */
export async function runMacroAnalysis(ctx = null) {
  const fred = ctx?.fred;
  if (fred?.ok) {
    const parts = [];
    if (fred.us10yYield != null) {
      const chg = fred.us10yChange != null ? ` (${fred.us10yChange >= 0 ? "+" : ""}${fred.us10yChange})` : "";
      parts.push(`美10债 ${fred.us10yYield}%${chg}`);
    }
    if (fred.dxy != null) {
      const chg = fred.dxyChange != null ? ` (${fred.dxyChange >= 0 ? "+" : ""}${fred.dxyChange})` : "";
      parts.push(`DXY ${fred.dxy}${chg}`);
    }
    if (fred.fedFunds != null) parts.push(`联邦基金 ${fred.fedFunds}%`);

    return stamp({
      skill: "macro-analyst",
      ok: true,
      dataSource: "fred",
      us10yYield: fred.us10yYield,
      us10yChange: fred.us10yChange,
      yieldChangePct: fred.us10yChange,
      dxy: fred.dxy,
      dxyChange: fred.dxyChange,
      fedFunds: fred.fedFunds,
      summary: parts.join(" · ") || "FRED 宏观数据",
    });
  }

  const { fetchFredMacroBundle } = await import("./perceptionDataProviders.js");
  const liveFred = await fetchFredMacroBundle();
  if (liveFred.ok) {
    return runMacroAnalysis({ fred: liveFred });
  }

  const [tnx, dxy] = await Promise.all([
    fetchJson("https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?interval=1d&range=5d").catch(() => null),
    fetchJson("https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=1d&range=5d").catch(() => null),
  ]);
  const tnxMeta = tnx?.chart?.result?.[0]?.meta;
  const dxyMeta = dxy?.chart?.result?.[0]?.meta;

  const parts = [];
  if (tnxMeta?.regularMarketPrice) parts.push(`美10债 ${tnxMeta.regularMarketPrice.toFixed(2)}%`);
  if (dxyMeta?.regularMarketPrice) parts.push(`DXY ${dxyMeta.regularMarketPrice.toFixed(2)}`);

  return stamp({
    skill: "macro-analyst",
    ok: !!tnxMeta,
    dataSource: "yahoo_fallback",
    us10yYield: tnxMeta?.regularMarketPrice,
    yieldChangePct: tnxMeta?.regularMarketChangePercent,
    dxy: dxyMeta?.regularMarketPrice,
    summary: parts.join(" · ") || "宏观数据暂不可用",
  });
}

export async function runAllSkills(symbol, candles = null, ctx = null) {
  const [technical, sentiment, marketIntel, news, macro] = await Promise.all([
    runTechnicalAnalysis(symbol, candles),
    runSentimentAnalysis(symbol, ctx),
    runMarketIntel(symbol, ctx),
    runNewsBriefing(ctx),
    runMacroAnalysis(ctx),
  ]);
  return { technicalAnalysis: technical, sentimentAnalyst: sentiment, marketIntel, newsBriefing: news, macroAnalyst: macro };
}
