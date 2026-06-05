/**
 * 感知层外部数据源 — FRED / Finnhub / Bitget
 * API Key 从环境变量读取，勿硬编码
 */
import {
  getCandles,
  getFundingRate,
  getOpenInterest,
  getLongShortRatio,
  getTakerRatio,
  getTicker,
  isBitgetConfigured,
} from "./bitgetClient.js";
import { fetchHubSkillCandles, fetchHubSentimentExtras } from "./hubSkillProvider.js";

const FRED_BASE = "https://api.stlouisfed.org/fred";
const FINNHUB_BASE = "https://finnhub.io/api/v1";
const BITGET_PUBLIC = "https://api.bitget.com";
const FRED_SERIES_GAP_MS = 400;
const FRED_429_RETRY_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envKey(name) {
  return (process.env[name] || "").trim();
}

export function getFredApiKey() {
  return envKey("FRED_API_KEY");
}

export function getFinnhubApiKey() {
  return envKey("FINNHUB_API_KEY");
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(opts.timeout || 15000),
    headers: { Accept: "application/json", ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** 解析 FRED observation，跳过 "." 缺失值 */
export function cleanFredObservations(observations = []) {
  const valid = observations
    .map((o) => ({
      date: o.date,
      value: o.value === "." ? null : Number(o.value),
    }))
    .filter((o) => o.value != null && !Number.isNaN(o.value));
  const latest = valid.at(-1)?.value ?? null;
  const prev = valid.at(-2)?.value ?? null;
  const change = latest != null && prev != null ? +(latest - prev).toFixed(4) : null;
  return { latest, prev, change, count: valid.length, series: valid.slice(-5) };
}

export async function fetchFredSeries(seriesId, limit = 10, { retries = 2 } = {}) {
  const key = getFredApiKey();
  if (!key) return { ok: false, seriesId, error: "FRED_API_KEY 未配置" };

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(FRED_429_RETRY_MS * attempt);
    try {
      const url =
        `${FRED_BASE}/series/observations?series_id=${seriesId}` +
        `&api_key=${key}&file_type=json&sort_order=desc&limit=${limit}`;
      const data = await fetchJson(url);
      const observations = [...(data?.observations || [])].reverse();
      const cleaned = cleanFredObservations(observations);
      return { ok: cleaned.count > 0, seriesId, ...cleaned, source: "fred" };
    } catch (e) {
      lastError = e.message;
      const is429 = String(e.message).includes("429");
      if (!is429 || attempt >= retries) break;
    }
  }
  return { ok: false, seriesId, error: lastError, source: "fred" };
}

/** FRED 宏观 bundle：串行拉取 + 间隔，避免 429 */
export async function fetchFredMacroBundle() {
  const ids = ["DGS10", "DTWEXBGS", "FEDFUNDS"];
  const results = {};
  for (let i = 0; i < ids.length; i++) {
    if (i > 0) await sleep(FRED_SERIES_GAP_MS);
    results[ids[i]] = await fetchFredSeries(ids[i], 12);
  }

  const us10y = results.DGS10;
  const dxy = results.DTWEXBGS;
  const fedFunds = results.FEDFUNDS;
  const ok = us10y.ok && dxy.ok && fedFunds.ok;
  return {
    ok,
    partial: !ok && (us10y.ok || dxy.ok || fedFunds.ok),
    source: "fred",
    us10yYield: us10y.latest,
    us10yChange: us10y.change,
    dxy: dxy.latest,
    dxyChange: dxy.change,
    fedFunds: fedFunds.latest,
    fedFundsChange: fedFunds.change,
    series: { DGS10: us10y, DTWEXBGS: dxy, FEDFUNDS: fedFunds },
  };
}

export function finnhubCryptoSymbol(symbol) {
  const base = String(symbol || "BTCUSDT").replace(/USDT$/i, "");
  return `BINANCE:${base}USDT`;
}

/** 清洗 Finnhub 新闻 */
export function cleanFinnhubNews(items = []) {
  const seen = new Set();
  const headlines = [];
  for (const item of items) {
    const title = String(item.headline || item.title || "").trim();
    if (!title || title.length < 8 || seen.has(title)) continue;
    seen.add(title);
    headlines.push({
      source: item.source || "finnhub",
      title,
      url: item.url || null,
      time: item.datetime ? item.datetime * 1000 : Date.now(),
      category: item.category || "crypto",
    });
  }
  return headlines.slice(0, 12);
}

const POS_WORDS = /\b(surge|rally|bull|gain|record|approval|etf|adopt|breakout|upgrade)\b/i;
const NEG_WORDS = /\b(crash|drop|bear|hack|ban|sec|lawsuit|fraud|collapse|liquidat)\b/i;

export function scoreNewsSentiment(headlines = []) {
  if (!headlines.length) return 0;
  let score = 0;
  for (const h of headlines) {
    const t = h.title || "";
    if (POS_WORDS.test(t)) score += 1;
    if (NEG_WORDS.test(t)) score -= 1;
  }
  return +Math.max(-1, Math.min(1, score / headlines.length)).toFixed(2);
}

export async function fetchFinnhubCryptoNews() {
  const token = getFinnhubApiKey();
  if (!token) return { ok: false, error: "FINNHUB_API_KEY 未配置", headlines: [], source: "finnhub" };
  try {
    const data = await fetchJson(`${FINNHUB_BASE}/news?category=crypto&token=${token}`);
    const headlines = cleanFinnhubNews(Array.isArray(data) ? data : []);
    return {
      ok: headlines.length > 0,
      headlines,
      sentimentScore: scoreNewsSentiment(headlines),
      source: "finnhub",
    };
  } catch (e) {
    return { ok: false, error: e.message, headlines: [], source: "finnhub" };
  }
}

export async function fetchFinnhubQuote(symbol) {
  const token = getFinnhubApiKey();
  if (!token) return { ok: false, error: "FINNHUB_API_KEY 未配置", source: "finnhub" };
  const fhSymbol = finnhubCryptoSymbol(symbol);
  try {
    const q = await fetchJson(`${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(fhSymbol)}&token=${token}`);
    const price = q.c > 0 ? q.c : q.pc > 0 ? q.pc : null;
    return {
      ok: price != null,
      symbol: fhSymbol,
      price,
      change: q.d,
      changePct: q.dp,
      high: q.h,
      low: q.l,
      prevClose: q.pc,
      source: "finnhub",
    };
  } catch (e) {
    return { ok: false, error: e.message, symbol: fhSymbol, source: "finnhub" };
  }
}

export function cleanBitgetCandles(raw = []) {
  return raw
    .map((row) => {
      if (Array.isArray(row)) {
        return {
          time: Number(row[0]),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5]),
        };
      }
      return {
        time: Number(row.time),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume ?? 0),
      };
    })
    .filter((c) => c.time && c.close > 0)
    .sort((a, b) => a.time - b.time);
}

/** Bitget 感知 bundle：K线 + 行情 + 衍生品 */
export async function fetchBitgetPerceptionBundle(symbol) {
  let candles = [];
  let candleSource = "bitget_api";
  const hubPack = await fetchHubSkillCandles(symbol, "1H", 120);
  if (hubPack?.candles?.length) {
    candles = cleanBitgetCandles(hubPack.candles);
    candleSource = hubPack.source;
  } else {
    try {
      candles = cleanBitgetCandles(await getCandles(symbol, "1h", 120));
    } catch {
      candles = [];
    }
  }

  if (!candles.length) {
    try {
      const res = await fetch(
        `${BITGET_PUBLIC}/api/v2/spot/market/candles?symbol=${symbol}&granularity=1h&limit=120`,
        { signal: AbortSignal.timeout(12000) }
      );
      const data = await res.json();
      if (data?.data?.length) {
        candles = cleanBitgetCandles(data.data);
        candleSource = "bitget_public";
      }
    } catch {
      /* empty */
    }
  }

  const hubExtras = await fetchHubSentimentExtras(symbol);
  const [ticker, funding, oi, lsRatio, taker] = await Promise.all([
    getTicker(symbol).catch(() => null),
    hubExtras.fundingRate != null
      ? Promise.resolve({ fundingRate: hubExtras.fundingRate / 100 })
      : getFundingRate(symbol).catch(() => null),
    hubExtras.openInterest != null
      ? Promise.resolve({ openInterest: hubExtras.openInterest })
      : getOpenInterest(symbol).catch(() => null),
    getLongShortRatio(symbol, "4h").catch(() => null),
    getTakerRatio(symbol, "4h").catch(() => null),
  ]);

  const latest = candles.at(-1);
  const lsLatest = Array.isArray(lsRatio) ? lsRatio.at(-1) : lsRatio;
  const takerLatest = Array.isArray(taker) ? taker.at(-1) : taker;
  const fundingPct =
    funding?.fundingRate != null ? +(Number(funding.fundingRate) * 100).toFixed(4) : hubExtras.fundingRate ?? null;

  return {
    ok: candles.length > 0 || !!ticker,
    source: "bitget",
    candleSource,
    configured: isBitgetConfigured(),
    candles,
    price: latest?.close ?? (ticker ? Number(ticker.lastPr) : null),
    ticker: ticker
      ? {
          last: Number(ticker.lastPr),
          change24h: Number(ticker.changeUtc24h || ticker.change24h || 0),
          volume24h: Number(ticker.baseVolume || ticker.quoteVolume || 0),
        }
      : null,
    fundingRate: fundingPct,
    openInterest: oi?.openInterest ?? oi?.amount ?? hubExtras.openInterest ?? null,
    longShortRatio: lsLatest?.longShortRatio ?? lsLatest?.longRate ?? null,
    takerBuyRatio: takerLatest?.buyRatio ?? null,
    futuresPrice: hubExtras.futuresPrice ?? null,
  };
}

/** 并行拉取三源原始数据 */
export async function fetchAllPerceptionRaw(symbol) {
  const [fred, finnhubNews, finnhubQuote, bitget] = await Promise.all([
    fetchFredMacroBundle(),
    fetchFinnhubCryptoNews(),
    fetchFinnhubQuote(symbol),
    fetchBitgetPerceptionBundle(symbol),
  ]);
  return {
    fred,
    finnhub: { news: finnhubNews, quote: finnhubQuote },
    bitget,
    fetchedAt: new Date().toISOString(),
  };
}
