/**
 * 策略决策引擎 + 回测引擎
 */
import { computeMacd, computeSar, computeVolumeMaConfirm, recentHigh } from "./indicators.js";

function ma(values, period, i) {
  if (i < period - 1) return null;
  const slice = values.slice(i - period + 1, i + 1);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function generateSignals(strategy, candles) {
  const signals = [];
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const period = strategy.conditions?.maPeriod || 20;

  for (let i = period; i < candles.length; i++) {
    const maVal = ma(closes, period, i);
    const volAvg = ma(volumes, period, i);
    const c = candles[i];
    const volRatio = volAvg ? c.volume / volAvg : 1;

    if (strategy.type === "sar_macd") {
      const sar = computeSar(candles.slice(0, i + 1));
      const macd = computeMacd(closes.slice(0, i + 1));
      const volume = computeVolumeMaConfirm(candles.slice(0, i + 1));
      const high = recentHigh(candles.slice(0, i + 1), strategy.conditions?.recentHighLookback || 20);
      const partialPct = (strategy.conditions?.takeProfitPartialPct || 50) / 100;

      if (sar && c.close < sar.value && i > period) {
        signals.push({
          index: i,
          time: c.time,
          type: "sell",
          price: c.close,
          reason: `跌破SAR ${sar.value.toFixed(2)}`,
        });
      } else if (high && c.close >= high * 0.998 && i > period) {
        signals.push({
          index: i,
          time: c.time,
          type: "sell",
          price: c.close,
          reason: `触及近期高点 ${high.toFixed(2)} 止盈${(partialPct * 100).toFixed(0)}%`,
        });
      } else if (
        sar?.priceAboveSar &&
        sar?.trend === "long" &&
        macd?.bullish &&
        volume.ok &&
        i > period
      ) {
        signals.push({
          index: i,
          time: c.time,
          type: "buy",
          price: c.close,
          reason: `SAR+MACD 开多 · SAR ${sar.value.toFixed(2)}`,
        });
      }
    } else if (strategy.type === "trend") {
      const mult = strategy.conditions?.volumeMultiplier || 1.5;
      const breakout = strategy.conditions?.breakoutAboveMa !== false;
      if (breakout && c.close > maVal && volRatio >= mult) {
        signals.push({
          index: i,
          time: c.time,
          type: "buy",
          price: c.close,
          reason: `突破MA${period} & 量比${volRatio.toFixed(2)}`,
        });
      } else if (c.close < maVal * 0.995) {
        signals.push({
          index: i,
          time: c.time,
          type: "sell",
          price: c.close,
          reason: `跌破MA${period}`,
        });
      }
    } else if (strategy.type === "grid") {
      const spacing = (strategy.conditions?.gridSpacingPct || 1.2) / 100;
      const ref = closes[i - 1];
      const change = (c.close - ref) / ref;
      if (change <= -spacing) {
        signals.push({ index: i, time: c.time, type: "buy", price: c.close, reason: "网格下轨买入" });
      } else if (change >= spacing) {
        signals.push({ index: i, time: c.time, type: "sell", price: c.close, reason: "网格上轨卖出" });
      }
    } else if (strategy.type === "arbitrage") {
      const spread = (strategy.conditions?.arbitrageSpreadPct || 0.3) / 100;
      const syntheticPerp = c.close * (1 + (Math.sin(i / 5) * spread));
      const diff = (syntheticPerp - c.close) / c.close;
      if (Math.abs(diff) >= spread) {
        signals.push({
          index: i,
          time: c.time,
          type: diff > 0 ? "sell" : "buy",
          price: c.close,
          reason: `模拟价差套利 ${(diff * 100).toFixed(2)}%`,
        });
      }
    }
  }
  return signals;
}

export function runBacktest(strategy, candles, accountBasis = null) {
  const basis =
    accountBasis && typeof accountBasis === "object"
      ? accountBasis
      : typeof accountBasis === "number"
        ? { initialEquity: accountBasis, cash: accountBasis, position: 0, otherAssetsUsd: 0, entryPrice: 0 }
        : { initialEquity: 10000, cash: 10000, position: 0, otherAssetsUsd: 0, entryPrice: 0 };

  const initialEquity = basis.initialEquity ?? 10000;
  const otherAssetsUsd = basis.otherAssetsUsd ?? 0;

  const signals = generateSignals(strategy, candles);
  let cash = basis.cash ?? initialEquity;
  let position = basis.position ?? 0;
  let entryPrice = basis.entryPrice ?? 0;
  const firstPrice = candles[0]?.close || basis.markPrice || 0;
  let peakEquity = cash + position * firstPrice + otherAssetsUsd || initialEquity;
  let maxDrawdown = 0;
  let paused = false;
  const trades = [];
  const equityCurve = [];
  const tp = (strategy.risk?.takeProfitPct || 3) / 100;
  const sl = (strategy.risk?.stopLossPct || 2) / 100;
  const maxDd = (strategy.risk?.maxDrawdownPct || 5) / 100;
  const posPct = (strategy.positionPct || 50) / 100;

  for (let i = 0; i < candles.length; i++) {
    const price = candles[i].close;
    let equity = cash + position * price + otherAssetsUsd;

    if (position > 0) {
      const pnlPct = (price - entryPrice) / entryPrice;
      if (pnlPct >= tp || pnlPct <= -sl) {
        const reason = pnlPct >= tp ? "止盈" : "止损";
        cash += position * price;
        trades.push({
          id: `t_${trades.length + 1}`,
          side: "sell",
          price,
          qty: position,
          time: candles[i].time,
          pnl: (price - entryPrice) * position,
          pnlPct: pnlPct * 100,
          reason,
        });
        position = 0;
        entryPrice = 0;
        equity = cash;
      }
    }

    peakEquity = Math.max(peakEquity, equity);
    const dd = peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0;
    maxDrawdown = Math.max(maxDrawdown, dd);
    if (dd >= maxDd) paused = true;

    const signal = signals.find((s) => s.index === i);
    if (!paused && signal) {
      if (signal.type === "buy" && position === 0) {
        const spend = cash * posPct;
        position = spend / price;
        cash -= spend;
        entryPrice = price;
        trades.push({
          id: `t_${trades.length + 1}`,
          side: "buy",
          price,
          qty: position,
          time: candles[i].time,
          reason: signal.reason,
        });
      } else if (signal.type === "sell" && position > 0) {
        const pnlPct = ((price - entryPrice) / entryPrice) * 100;
        cash += position * price;
        trades.push({
          id: `t_${trades.length + 1}`,
          side: "sell",
          price,
          qty: position,
          time: candles[i].time,
          pnl: (price - entryPrice) * position,
          pnlPct,
          reason: signal.reason,
        });
        position = 0;
        entryPrice = 0;
      }
    }

    equityCurve.push({
      time: candles[i].time,
      equity: cash + position * price + otherAssetsUsd,
      drawdown: dd * 100,
      price,
    });
  }

  const finalEquity = cash + position * candles.at(-1).close + otherAssetsUsd;
  const totalReturn = ((finalEquity - initialEquity) / initialEquity) * 100;
  const closed = trades.filter((t) => t.side === "sell" && t.pnl != null);
  const wins = closed.filter((t) => t.pnl > 0);
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const returns = equityCurve.slice(1).map((p, j) => {
    const prev = equityCurve[j].equity;
    return prev ? (p.equity - prev) / prev : 0;
  });
  const avgRet = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const std = returns.length
    ? Math.sqrt(returns.reduce((s, r) => s + (r - avgRet) ** 2, 0) / returns.length)
    : 0;
  const sharpe = std > 0 ? (avgRet / std) * Math.sqrt(252) : 0;

  return {
    metrics: {
      initialCapital: +initialEquity.toFixed(2),
      initialCash: +(basis.cash ?? 0).toFixed(2),
      initialPosition: position,
      baseCoin: basis.baseCoin || strategy.symbol?.replace(/USDT$/i, ""),
      otherAssetsUsd: +otherAssetsUsd.toFixed(2),
      accountBased: !!(basis.accountEquity || basis.usdtEquityUsd != null),
      simulatedPnl: +(finalEquity - initialEquity).toFixed(2),
      realAccountEquity: basis.realAccountEquity ?? null,
      usdtAvailable: basis.usdtAvailable ?? null,
      usdtEquityUsd: basis.usdtEquityUsd ?? null,
      finalEquity: +finalEquity.toFixed(2),
      totalReturnPct: +totalReturn.toFixed(2),
      winRate: +winRate.toFixed(1),
      maxDrawdownPct: +(maxDrawdown * 100).toFixed(2),
      sharpeRatio: +sharpe.toFixed(2),
      totalTrades: trades.length,
      pausedByRisk: paused,
    },
    trades,
    equityCurve,
    signals,
  };
}

export { generateSignals };
