const FRED_KEY = process.env.FRED_API_KEY || "";

export async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(15000),
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

export async function yahooPrice(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const data = await fetchJson(url);
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error(`No Yahoo data for ${symbol}`);
  return {
    symbol,
    price: meta.regularMarketPrice,
    currency: meta.currency,
    change_pct: meta.regularMarketChangePercent,
    previous_close: meta.chartPreviousClose,
    market_time: meta.regularMarketTime,
  };
}

export async function yahooOhlcv(symbol, range = "1y", interval = "1d") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const data = await fetchJson(url);
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No Yahoo OHLCV for ${symbol}`);
  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const rows = ts.map((t, i) => ({
    time: t,
    open: q.open?.[i],
    high: q.high?.[i],
    low: q.low?.[i],
    close: q.close?.[i],
    volume: q.volume?.[i],
  })).filter((r) => r.close != null);
  return { symbol, range, interval, rows };
}

export async function fredLatest(seriesId) {
  if (!FRED_KEY) throw new Error("FRED_API_KEY not set");
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=1`;
  const data = await fetchJson(url);
  const obs = data?.observations?.[0];
  if (!obs) throw new Error(`No FRED data for ${seriesId}`);
  return { series_id: seriesId, date: obs.date, value: Number(obs.value) };
}

const RATE_SERIES = {
  fed_funds: "DFF",
  fed_funds_target_upper: "DFEDTARU",
  fed_funds_target_lower: "DFEDTARL",
  t2y: "DGS2",
  t5y: "DGS5",
  t10y: "DGS10",
  t30y: "DGS30",
  t3m: "DGS3MO",
  t1y: "DGS1",
  breakeven_10y: "T10YIE",
  spread_10y2y: "T10Y2Y",
};

const YAHOO_RATE_PROXY = {
  t2y: "^FVX",
  t5y: "^FVX",
  t10y: "^TNX",
  t30y: "^TYX",
  t3m: "^IRX",
};

export async function getRate(key) {
  if (FRED_KEY && RATE_SERIES[key]) {
    try {
      return await fredLatest(RATE_SERIES[key]);
    } catch {
      /* fall through */
    }
  }
  if (YAHOO_RATE_PROXY[key]) {
    const p = await yahooPrice(YAHOO_RATE_PROXY[key]);
    return { rate_key: key, date: new Date().toISOString().slice(0, 10), value: p.price, source: "yahoo_proxy" };
  }
  throw new Error(`Rate unavailable: ${key}`);
}

export function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 5) return null;
  const x = xs.slice(-n);
  const y = ys.slice(-n);
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

export function dailyReturns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] && closes[i]) {
      out.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
  }
  return out;
}

const ASSET_SYMBOLS = {
  btc: "BTC-USD",
  gold: "GC=F",
  dxy: "DX-Y.NYB",
  ndx: "^NDX",
  spx: "^GSPC",
  t10y: "^TNX",
  vix: "^VIX",
  oil: "CL=F",
};

export function resolveSymbol(keyOrSymbol) {
  return ASSET_SYMBOLS[keyOrSymbol.toLowerCase()] || keyOrSymbol;
}
