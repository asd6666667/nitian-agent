/**
 * 严格调用 Bitget 官方 K 线 API（永续优先 → 现货 v2 → v3）
 * 文档:
 * - /api/v2/mix/market/candles
 * - /api/v2/spot/market/candles
 * - /api/v3/market/candles
 */
const BASE = "https://api.bitget.com";

export const GRANULARITY_MAP = {
  "1m": { v2Spot: "1min", v2Mix: "1m", v3: "1m", label: "1分" },
  "1M": { v2Spot: "1min", v2Mix: "1m", v3: "1m", label: "1分" },
  "3m": { v2Spot: "3min", v2Mix: "3m", v3: "3m", label: "3分" },
  "5m": { v2Spot: "5min", v2Mix: "5m", v3: "5m", label: "5分" },
  "5min": { v2Spot: "5min", v2Mix: "5m", v3: "5m", label: "5分" },
  "15m": { v2Spot: "15min", v2Mix: "15m", v3: "15m", label: "15分" },
  "30m": { v2Spot: "30min", v2Mix: "30m", v3: "30m", label: "30分" },
  "1h": { v2Spot: "1h", v2Mix: "1H", v3: "1H", label: "1小时" },
  "1H": { v2Spot: "1h", v2Mix: "1H", v3: "1H", label: "1小时" },
  "4h": { v2Spot: "4h", v2Mix: "4H", v3: "4H", label: "4小时" },
  "4H": { v2Spot: "4h", v2Mix: "4H", v3: "4H", label: "4小时" },
  "1d": { v2Spot: "1day", v2Mix: "1D", v3: "1D", label: "日线" },
  "1D": { v2Spot: "1day", v2Mix: "1D", v3: "1D", label: "日线" },
};

const GRANULARITY_ALIASES = {
  "1min": "1m",
  "3min": "3m",
  "5min": "5m",
  "15min": "15m",
  "30min": "30m",
  "1hour": "1h",
  "1day": "1d",
};

export function normalizeGranularity(granularity) {
  const key = GRANULARITY_ALIASES[granularity] || granularity;
  return GRANULARITY_MAP[key] || GRANULARITY_MAP["1H"];
}

export function parseCandleRow(row) {
  if (Array.isArray(row)) {
    return {
      time: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5] ?? row[6] ?? 0),
      quoteVolume: Number(row[6] ?? 0),
    };
  }
  return {
    time: Number(row.time ?? row.ts),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume ?? row.baseVolume ?? 0),
    quoteVolume: Number(row.quoteVolume ?? 0),
  };
}

async function publicGet(path) {
  const res = await fetch(`${BASE}${path}`, {
    signal: AbortSignal.timeout(15000),
    headers: { Accept: "application/json" },
  });
  const data = await res.json();
  if (data.code !== "00000") throw new Error(`Bitget (${data.code}): ${data.msg}`);
  return data;
}

function sortAsc(candles) {
  return [...candles].sort((a, b) => a.time - b.time);
}

async function fetchMixFuturesCandles(symbol, gran, limit) {
  const batchSize = Math.min(limit, 200);
  let endTime;
  const all = [];
  let remaining = limit;

  while (remaining > 0) {
    const take = Math.min(remaining, batchSize);
    const params = new URLSearchParams({
      symbol,
      productType: "USDT-FUTURES",
      granularity: gran.v2Mix,
      limit: String(take),
    });
    if (endTime) params.set("endTime", String(endTime));
    const result = await publicGet(`/api/v2/mix/market/candles?${params}`);
    const rows = result.data || [];
    if (!rows.length) break;
    const parsed = rows.map(parseCandleRow);
    parsed.sort((a, b) => a.time - b.time);
    all.unshift(...parsed);
    endTime = parsed[0].time - 1;
    remaining -= rows.length;
    if (rows.length < take) break;
  }

  return sortAsc(all).slice(-limit);
}

async function fetchSpotV2Candles(symbol, gran, limit) {
  const params = new URLSearchParams({
    symbol,
    granularity: gran.v2Spot,
    limit: String(Math.min(limit, 1000)),
  });
  const result = await publicGet(`/api/v2/spot/market/candles?${params}`);
  const rows = (result.data || []).map(parseCandleRow);
  return sortAsc(rows).slice(-limit);
}

async function fetchV3Candles(symbol, gran, limit, category) {
  const params = new URLSearchParams({
    category,
    symbol,
    interval: gran.v3,
    limit: String(Math.min(limit, 100)),
  });
  const result = await publicGet(`/api/v3/market/candles?${params}`);
  const rows = (result.data || []).map(parseCandleRow);
  return sortAsc(rows).slice(-limit);
}

/**
 * @param {object} opts
 * @param {string} opts.symbol
 * @param {string} opts.granularity - 1m|15m|1H|4H|1D
 * @param {number} opts.limit
 * @param {'USDT-FUTURES'|'SPOT'} opts.category
 */
export async function fetchBitgetKlines({ symbol, granularity = "1H", limit = 200, category = "USDT-FUTURES" }) {
  const sym = String(symbol || "BTCUSDT").toUpperCase();
  const gran = normalizeGranularity(granularity);
  const capped = Math.min(Math.max(Number(limit) || 200, 30), 500);
  const errors = [];

  if (category === "USDT-FUTURES") {
    try {
      const rows = await fetchMixFuturesCandles(sym, gran, capped);
      if (rows.length) {
        return { candles: rows, source: "bitget_v2_mix_futures", category, granularity: gran.v3, symbol: sym };
      }
    } catch (e) {
      errors.push(`mix: ${e.message}`);
    }
    try {
      const rows = await fetchV3Candles(sym, gran, capped, "USDT-FUTURES");
      if (rows.length) {
        return { candles: rows, source: "bitget_v3_futures", category, granularity: gran.v3, symbol: sym };
      }
    } catch (e) {
      errors.push(`v3-futures: ${e.message}`);
    }
  }

  try {
    const rows = await fetchSpotV2Candles(sym, gran, capped);
    if (rows.length) {
      return { candles: rows, source: "bitget_v2_spot", category: "SPOT", granularity: gran.v3, symbol: sym };
    }
  } catch (e) {
    errors.push(`spot: ${e.message}`);
  }

  try {
    const rows = await fetchV3Candles(sym, gran, capped, "SPOT");
    if (rows.length) {
      return { candles: rows, source: "bitget_v3_spot", category: "SPOT", granularity: gran.v3, symbol: sym };
    }
  } catch (e) {
    errors.push(`v3-spot: ${e.message}`);
  }

  throw new Error(`Bitget K线获取失败 (${sym}): ${errors.join(" | ") || "无数据"}`);
}

export async function fetchBitgetTicker24h(symbol, category = "USDT-FUTURES") {
  const sym = String(symbol || "BTCUSDT").toUpperCase();
  try {
    if (category === "USDT-FUTURES") {
      const result = await publicGet(
        `/api/v2/mix/market/ticker?productType=USDT-FUTURES&symbol=${sym}`
      );
      const t = result.data?.[0] || result.data;
      if (t) {
        return {
          last: Number(t.lastPr ?? t.last),
          high24h: Number(t.high24h),
          low24h: Number(t.low24h),
          change24h: Number(t.change24h ?? t.changeUtc24h ?? 0),
          baseVolume24h: Number(t.baseVolume ?? t.usdtVolume ?? 0),
          quoteVolume24h: Number(t.quoteVolume ?? t.usdtVolume ?? 0),
          source: "bitget_v2_mix_ticker",
        };
      }
    }
  } catch {
    /* spot fallback */
  }

  const result = await publicGet(`/api/v2/spot/market/tickers?symbol=${sym}`);
  const t = result.data?.[0];
  if (!t) throw new Error("Bitget ticker 无数据");
  return {
    last: Number(t.lastPr ?? t.close),
    high24h: Number(t.high24h),
    low24h: Number(t.low24h),
    change24h: Number(t.changeUtc24h ?? t.change24h ?? 0),
    baseVolume24h: Number(t.baseVolume ?? 0),
    quoteVolume24h: Number(t.quoteVolume ?? 0),
    source: "bitget_v2_spot_ticker",
  };
}
