/** 共享技术指标 — SAR / MACD / 均线 / 量能 */

export function computeMa(values, period) {
  if (!values?.length || values.length < period) return null;
  return +(values.slice(-period).reduce((a, b) => a + b, 0) / period).toFixed(6);
}

export function computeEmaSeries(values, period) {
  if (!values?.length || values.length < period) return [];
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = [ema];
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

export function computeMacd(closes) {
  if (!closes?.length || closes.length < 35) return null;
  const ema12 = computeEmaSeries(closes, 12);
  const ema26 = computeEmaSeries(closes, 26);
  const offset = ema12.length - ema26.length;
  const macdLine = [];
  for (let i = 0; i < ema26.length; i++) {
    macdLine.push(ema12[i + offset] - ema26[i]);
  }
  if (macdLine.length < 9) return null;
  const signalLine = computeEmaSeries(macdLine, 9);
  const dif = +macdLine.at(-1).toFixed(4);
  const dea = +signalLine.at(-1).toFixed(4);
  const hist = +(dif - dea).toFixed(4);
  return {
    dif,
    dea,
    hist,
    bullish: dif > dea && hist > 0,
    bearish: dif < dea && hist < 0,
  };
}

/** Parabolic SAR（标准迭代算法） */
export function computeSar(candles, step = 0.02, maxStep = 0.2) {
  if (!candles?.length || candles.length < 3) return null;

  const highs = candles.map((c) => Number(c.high ?? c.close));
  const lows = candles.map((c) => Number(c.low ?? c.close));
  const closes = candles.map((c) => Number(c.close));

  let uptrend = highs[1] + lows[1] >= highs[0] + lows[0];
  let af = step;
  let ep = uptrend ? highs[0] : lows[0];
  let sar = uptrend ? lows[0] : highs[0];

  for (let i = 1; i < candles.length; i++) {
    const prevSar = sar;
    sar = prevSar + af * (ep - prevSar);

    if (uptrend) {
      sar = Math.min(sar, lows[i - 1], i >= 2 ? lows[i - 2] : lows[i - 1]);
      if (lows[i] < sar) {
        uptrend = false;
        sar = ep;
        ep = lows[i];
        af = step;
      } else if (highs[i] > ep) {
        ep = highs[i];
        af = Math.min(af + step, maxStep);
      }
    } else {
      sar = Math.max(sar, highs[i - 1], i >= 2 ? highs[i - 2] : highs[i - 1]);
      if (highs[i] > sar) {
        uptrend = true;
        sar = ep;
        ep = highs[i];
        af = step;
      } else if (lows[i] < ep) {
        ep = lows[i];
        af = Math.min(af + step, maxStep);
      }
    }
  }

  const close = closes.at(-1);
  const value = +sar.toFixed(4);
  return {
    value,
    trend: uptrend ? "long" : "short",
    priceAboveSar: close > value,
    priceBelowSar: close < value,
    bullish: uptrend && close > value,
  };
}

export function computeVolumeMaConfirm(candles) {
  if (!candles?.length || candles.length < 10) return { ok: false, volMa5: null, volMa10: null };
  const volumes = candles.map((c) => Number(c.volume || 0));
  const volMa5 = computeMa(volumes, 5);
  const volMa10 = computeMa(volumes, 10);
  return {
    ok: volMa5 != null && volMa10 != null && volMa5 > volMa10,
    volMa5,
    volMa10,
  };
}

export function recentHigh(candles, lookback = 20) {
  if (!candles?.length) return null;
  const slice = candles.slice(-lookback);
  return Math.max(...slice.map((c) => Number(c.high ?? c.close)));
}
