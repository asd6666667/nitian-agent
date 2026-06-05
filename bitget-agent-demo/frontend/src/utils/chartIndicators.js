/** Bitget 风格技术指标 — 与 backend/services/chartIndicators.js 同步 */

export const MAIN_INDICATORS = ["MA", "EMA", "BOLL", "SAR", "AVL", "RESIST", "SUPER", "VWAP"];
export const SUB_INDICATORS = [
  "VOL",
  "MACD",
  "KDJ",
  "RSI",
  "ROC",
  "CCI",
  "WR",
  "OBV",
  "StochRSI",
  "MFI",
  "DMI",
  "DMA",
  "MTM",
  "EMV",
];

export const MA_COLORS = ["#8B6914", "#A83232", "#2B6B6B", "#3A8F8F", "#7A6F5F"];
export const BULL = "#3A8F8F";
export const BEAR = "#A83232";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function smaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += num(values[j]);
    out[i] = s / period;
  }
  return out;
}

export function emaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + num(b), 0) / period;
  out[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema = num(values[i]) * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

function trueRange(candles, i) {
  if (i === 0) return candles[i].high - candles[i].low;
  const prev = candles[i - 1].close;
  return Math.max(
    candles[i].high - candles[i].low,
    Math.abs(candles[i].high - prev),
    Math.abs(candles[i].low - prev)
  );
}

export function atrSeries(candles, period = 14) {
  const trs = candles.map((_, i) => trueRange(candles, i));
  return emaSeries(trs, period);
}

export function bollSeries(closes, period = 20, mult = 2) {
  const mid = smaSeries(closes, period);
  const upper = [...mid];
  const lower = [...mid];
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1).map(num);
    const mean = mid[i];
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    upper[i] = mean + mult * std;
    lower[i] = mean - mult * std;
  }
  return { mid, upper, lower };
}

export function sarSeries(candles, step = 0.02, maxStep = 0.2) {
  const out = new Array(candles.length).fill(null);
  if (candles.length < 2) return out;

  let uptrend = candles[1].close >= candles[0].close;
  let af = step;
  let ep = uptrend ? candles[0].high : candles[0].low;
  let sar = uptrend ? candles[0].low : candles[0].high;
  out[0] = sar;

  for (let i = 1; i < candles.length; i++) {
    const prevSar = sar;
    sar = prevSar + af * (ep - prevSar);
    if (uptrend) {
      sar = Math.min(sar, candles[i - 1].low, i >= 2 ? candles[i - 2].low : candles[i - 1].low);
      if (candles[i].low < sar) {
        uptrend = false;
        sar = ep;
        ep = candles[i].low;
        af = step;
      } else if (candles[i].high > ep) {
        ep = candles[i].high;
        af = Math.min(af + step, maxStep);
      }
    } else {
      sar = Math.max(sar, candles[i - 1].high, i >= 2 ? candles[i - 2].high : candles[i - 1].high);
      if (candles[i].high > sar) {
        uptrend = true;
        sar = ep;
        ep = candles[i].high;
        af = step;
      } else if (candles[i].low < ep) {
        ep = candles[i].low;
        af = Math.min(af + step, maxStep);
      }
    }
    out[i] = sar;
  }
  return out;
}

export function vwapSeries(candles) {
  const out = new Array(candles.length).fill(null);
  let cumVol = 0;
  let cumTpVol = 0;
  for (let i = 0; i < candles.length; i++) {
    const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
    const vol = num(candles[i].volume);
    cumVol += vol;
    cumTpVol += tp * vol;
    out[i] = cumVol > 0 ? cumTpVol / cumVol : tp;
  }
  return out;
}

export function avlSeries(candles, period = 20) {
  const typical = candles.map((c) => (c.high + c.low + c.close) / 3);
  return smaSeries(typical, period);
}

export function resistSeries(candles, lookback = 20) {
  const out = new Array(candles.length).fill(null);
  for (let i = lookback - 1; i < candles.length; i++) {
    const slice = candles.slice(i - lookback + 1, i + 1);
    const high = Math.max(...slice.map((c) => c.high));
    const low = Math.min(...slice.map((c) => c.low));
    const close = candles[i].close;
    const pivot = (high + low + close) / 3;
    out[i] = 2 * pivot - low;
  }
  return out;
}

export function superTrendSeries(candles, period = 10, mult = 3) {
  const atr = atrSeries(candles, period);
  const up = new Array(candles.length).fill(null);
  const down = new Array(candles.length).fill(null);
  const trend = new Array(candles.length).fill(null);
  let dir = 1;
  let st = null;

  for (let i = period; i < candles.length; i++) {
    const hl2 = (candles[i].high + candles[i].low) / 2;
    const bu = hl2 + mult * (atr[i] || 0);
    const bd = hl2 - mult * (atr[i] || 0);
    up[i] = bu;
    down[i] = bd;
    if (st == null) {
      st = dir === 1 ? bd : bu;
    } else if (dir === 1) {
      st = Math.max(bd, st);
      if (candles[i].close < st) {
        dir = -1;
        st = bu;
      }
    } else {
      st = Math.min(bu, st);
      if (candles[i].close > st) {
        dir = 1;
        st = bd;
      }
    }
    trend[i] = st;
  }
  return trend;
}

export function macdSeries(closes) {
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const dif = closes.map((_, i) =>
    ema12[i] != null && ema26[i] != null ? ema12[i] - ema26[i] : null
  );
  const validDif = dif.filter((v) => v != null);
  const deaRaw = emaSeries(validDif, 9);
  let j = 0;
  const dea = dif.map((v) => {
    if (v == null) return null;
    return deaRaw[j++];
  });
  const hist = dif.map((v, i) => (v != null && dea[i] != null ? v - dea[i] : null));
  return { dif, dea, hist };
}

export function kdjSeries(candles, n = 9, kPeriod = 3, dPeriod = 3) {
  const k = new Array(candles.length).fill(null);
  const d = new Array(candles.length).fill(null);
  const j = new Array(candles.length).fill(null);
  let prevK = 50;
  let prevD = 50;

  for (let i = n - 1; i < candles.length; i++) {
    const slice = candles.slice(i - n + 1, i + 1);
    const hn = Math.max(...slice.map((c) => c.high));
    const ln = Math.min(...slice.map((c) => c.low));
    const rsv = hn === ln ? 50 : ((candles[i].close - ln) / (hn - ln)) * 100;
    const kv = (2 / 3) * prevK + (1 / 3) * rsv;
    const dv = (2 / 3) * prevD + (1 / 3) * kv;
    k[i] = kv;
    d[i] = dv;
    j[i] = 3 * kv - 2 * dv;
    prevK = kv;
    prevD = dv;
  }
  return { k, d, j };
}

export function rsiSeries(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function rocSeries(closes, period = 12) {
  const out = new Array(closes.length).fill(null);
  for (let i = period; i < closes.length; i++) {
    const prev = closes[i - period];
    out[i] = prev ? ((closes[i] - prev) / prev) * 100 : null;
  }
  return out;
}

export function cciSeries(candles, period = 20) {
  const out = new Array(candles.length).fill(null);
  const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
  for (let i = period - 1; i < candles.length; i++) {
    const slice = tp.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const md = slice.reduce((s, v) => s + Math.abs(v - mean), 0) / period;
    out[i] = md === 0 ? 0 : (tp[i] - mean) / (0.015 * md);
  }
  return out;
}

export function wrSeries(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1);
    const hn = Math.max(...slice.map((c) => c.high));
    const ln = Math.min(...slice.map((c) => c.low));
    out[i] = hn === ln ? -50 : ((hn - candles[i].close) / (hn - ln)) * -100;
  }
  return out;
}

export function obvSeries(candles) {
  const out = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i - 1].close) out[i] = out[i - 1] + num(candles[i].volume);
    else if (candles[i].close < candles[i - 1].close) out[i] = out[i - 1] - num(candles[i].volume);
    else out[i] = out[i - 1];
  }
  return out;
}

export function stochRsiSeries(closes, rsiPeriod = 14, stochPeriod = 14) {
  const rsi = rsiSeries(closes, rsiPeriod);
  const out = new Array(closes.length).fill(null);
  for (let i = stochPeriod - 1; i < closes.length; i++) {
    const slice = rsi.slice(i - stochPeriod + 1, i + 1).filter((v) => v != null);
    if (slice.length < stochPeriod) continue;
    const min = Math.min(...slice);
    const max = Math.max(...slice);
    out[i] = max === min ? 50 : ((rsi[i] - min) / (max - min)) * 100;
  }
  return out;
}

export function mfiSeries(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
  const rmf = tp.map((t, i) => t * num(candles[i].volume));

  for (let i = period; i < candles.length; i++) {
    let pos = 0;
    let neg = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (tp[j] > tp[j - 1]) pos += rmf[j];
      else if (tp[j] < tp[j - 1]) neg += rmf[j];
    }
    const mfr = neg === 0 ? 100 : pos / neg;
    out[i] = 100 - 100 / (1 + mfr);
  }
  return out;
}

export function dmiSeries(candles, period = 14) {
  const plus = new Array(candles.length).fill(null);
  const minus = new Array(candles.length).fill(null);
  const adx = new Array(candles.length).fill(null);
  const trArr = candles.map((_, i) => trueRange(candles, i));
  const plusDm = [0];
  const minusDm = [0];

  for (let i = 1; i < candles.length; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    plusDm.push(up > down && up > 0 ? up : 0);
    minusDm.push(down > up && down > 0 ? down : 0);
  }

  const trSm = emaSeries(trArr, period);
  const plusSm = emaSeries(plusDm, period);
  const minusSm = emaSeries(minusDm, period);

  for (let i = period; i < candles.length; i++) {
    if (!trSm[i]) continue;
    plus[i] = (100 * plusSm[i]) / trSm[i];
    minus[i] = (100 * minusSm[i]) / trSm[i];
    const dx =
      plus[i] + minus[i] === 0 ? 0 : (Math.abs(plus[i] - minus[i]) / (plus[i] + minus[i])) * 100;
    adx[i] = dx;
  }
  const adxSm = emaSeries(
    adx.map((v) => v ?? 0),
    period
  );
  return { plus, minus, adx: adxSm };
}

export function dmaSeries(closes, short = 10, long = 50) {
  const s = smaSeries(closes, short);
  const l = smaSeries(closes, long);
  return closes.map((_, i) => (s[i] != null && l[i] != null ? s[i] - l[i] : null));
}

export function mtmSeries(closes, period = 12) {
  const out = new Array(closes.length).fill(null);
  for (let i = period; i < closes.length; i++) {
    out[i] = closes[i] - closes[i - period];
  }
  return out;
}

export function emvSeries(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  const emvRaw = candles.map((c, i) => {
    if (i === 0) return 0;
    const midMove = (c.high + c.low) / 2 - (candles[i - 1].high + candles[i - 1].low) / 2;
    const boxRatio = num(c.volume) / Math.max(c.high - c.low, 0.0001);
    return boxRatio === 0 ? 0 : midMove / boxRatio;
  });
  return smaSeries(emvRaw, period);
}

export function computeAllIndicators(candles) {
  const closes = candles.map((c) => num(c.close));
  const volumes = candles.map((c) => num(c.volume));
  const ma5 = smaSeries(closes, 5);
  const ma10 = smaSeries(closes, 10);
  const ma20 = smaSeries(closes, 20);
  const volMa5 = smaSeries(volumes, 5);
  const volMa10 = smaSeries(volumes, 10);

  return {
    ma5,
    ma10,
    ma20,
    ema12: emaSeries(closes, 12),
    ema26: emaSeries(closes, 26),
    boll: bollSeries(closes),
    sar: sarSeries(candles),
    avl: avlSeries(candles),
    resist: resistSeries(candles),
    super: superTrendSeries(candles),
    vwap: vwapSeries(candles),
    volMa5,
    volMa10,
    macd: macdSeries(closes),
    kdj: kdjSeries(candles),
    rsi: rsiSeries(closes),
    roc: rocSeries(closes),
    cci: cciSeries(candles),
    wr: wrSeries(candles),
    obv: obvSeries(candles),
    stochRsi: stochRsiSeries(closes),
    mfi: mfiSeries(candles),
    dmi: dmiSeries(candles),
    dma: dmaSeries(closes),
    mtm: mtmSeries(closes),
    emv: emvSeries(candles),
  };
}

export function lastVal(series) {
  if (!series?.length) return null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] != null && Number.isFinite(series[i])) return series[i];
  }
  return null;
}
