/**
 * EMA 回调快进快出策略 — 趋势过滤 + RSI 超卖 + 动能反转
 * 入场条件宽松（2/3 即可触发），止损止盈紧密
 */

export function computeRsi(closes, period = 14) {
  if (!closes?.length || closes.length < period + 1) return null;
  const gains = [];
  const losses = [];
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(Math.max(0, change));
    losses.push(Math.max(0, -change));
  }
  const avgGainRaw = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
  const avgLossRaw = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
  if (avgLossRaw === 0) return { rsi: 100 };
  const rs = avgGainRaw / avgLossRaw;
  return { rsi: +(100 - 100 / (1 + rs)).toFixed(2) };
}

export function computeEma(values, period) {
  if (!values?.length || values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return +ema.toFixed(6);
}

function fmt(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n >= 1000 ? n.toFixed(2) : n >= 1 ? n.toFixed(4) : n.toFixed(6);
}

export function evaluateEmaPullback(candles, options = {}) {
  const emaFastPeriod = options.emaFastPeriod || 20;
  const emaSlowPeriod = options.emaSlowPeriod || 50;
  const rsiPeriod = options.rsiPeriod || 14;
  const rsiOversold = options.rsiOversold || 35;
  const volumeMultiplier = options.volumeMultiplier || 1.2;

  const minBars = Math.max(emaSlowPeriod + 5, rsiPeriod + 10);
  if (!candles?.length || candles.length < minBars) {
    const got = candles?.length || 0;
    return {
      ready: false,
      entryReady: false,
      checks: [{ id: "data", label: "K线数据", pass: false, detail: got ? `当前 ${got} 根，需至少 ${minBars} 根` : "K线拉取失败或为空" }],
      summary: got ? `K线数据不足（${got}/${minBars} 根）` : "K线数据不足",
    };
  }

  const closes = candles.map((c) => Number(c.close));
  const volumes = candles.map((c) => Number(c.volume || 0));
  const latest = candles.at(-1);
  const close = Number(latest.close);

  const ema20 = computeEma(closes, emaFastPeriod);
  const ema50 = computeEma(closes, emaSlowPeriod);
  const rsiData = computeRsi(closes, rsiPeriod);
  const rsiVal = rsiData?.rsi;

  // VolMA check: last bar volume > volMA(volumeMaPeriod)
  const volumeMaPeriod = options.volumeMaPeriod || 10;
  const volAvg = volumes.slice(-volumeMaPeriod).reduce((a, b) => a + b, 0) / volumeMaPeriod;
  const volRatio = volAvg > 0 ? latest.volume / volAvg : 0;
  const volOk = volRatio >= volumeMultiplier;

  // Condition 1: Price is above EMA50 (upward trend filter)
  const trendOk = close > ema50;

  // Condition 2: RSI oversold or approaching oversold (pullback zone)
  const rsiOk = rsiVal != null && (rsiVal <= rsiOversold + 10);

  // Condition 3: Momentum recovering — last 2 bars closing higher, and volume supporting
  let momentumRecovering = false;
  if (closes.length >= 3) {
    const prevClose = closes.at(-2);
    const currClose = closes.at(-1);
    const prevPrevClose = closes.at(-3);
    // Price bounced back from low (not strictly lower than prev, but holding)
    momentumRecovering = currClose >= prevClose * 0.998 && prevClose >= prevPrevClose * 0.99;
  }

  const longChecks = [
    {
      id: "ema_trend",
      label: `价格在上行 ${emaSlowPeriod}EMA 上方`,
      pass: trendOk,
      detail: `收盘 ${fmt(close)} · ${emaSlowPeriod}EMA ${fmt(ema50)} · ${trendOk ? "多头区" : "空头区"}`,
    },
    {
      id: "rsi_pullback",
      label: `RSI 回调至超卖区 (${rsiPeriod})`,
      pass: rsiOk,
      detail: rsiVal != null ? `RSI ${rsiVal.toFixed(2)} · 回调 ${rsiVal <= rsiOversold ? "已超卖" : "接近超卖"}` : "RSI 不可用",
    },
    {
      id: "momentum_recovery",
      label: `动能恢复 + 量能支撑`,
      pass: momentumRecovering && volOk,
      detail: volRatio != null ? `量比 ${volRatio.toFixed(2)}x · ${volOk ? "量能够" : "量能不足"} · 动能${momentumRecovering ? "恢复中" : "偏弱"}` : "动能判断中",
    },
  ];

  const shortChecks = [
    { ...longChecks[0], id: "ema_trend_short", label: `价格在下行 ${emaSlowPeriod}EMA 下方`, pass: close < ema50, detail: `反向：${trendOk ? "非空头区" : "空头区"}` },
    { ...longChecks[1], id: "rsi_bullish", label: `RSI 远离超买区 (${rsiPeriod})`, pass: rsiVal != null && rsiVal >= 60, detail: `反向：RSI ${rsiVal != null ? rsiVal.toFixed(2) : "?"} · ${rsiVal >= 60 ? "远离超买" : "未远离超买"}` },
    { ...longChecks[2], id: "momentum_decline", label: `动能走弱 + 量能支撑`, pass: false, detail: "做空需额外确认（暂不启用）" },
  ];

  const longReady = longChecks.filter((c) => c.pass).length >= 2;
  const shortReady = shortChecks.filter((c) => c.pass).length >= 2;
  const allPassCount = [...longChecks].filter((c) => c.pass).length;

  return {
    ready: true,
    entryReady: longReady,
    longReady,
    shortReady,
    passCount: allPassCount,
    totalChecks: longChecks.length,
    checks: longChecks,
    ema20,
    ema50,
    rsi: rsiVal,
    volRatio,
    close,
    summary: longReady
      ? "做多三条件中至少两项满足，可执行开多"
      : shortReady
        ? "做空三条件满足（需合约支持）"
        : `条件 ${allPassCount}/${longChecks.length} 满足 · 做多${longReady ? "✓" : "×"}${shortReady ? " · 做空✓" : ""}`,
  };
}

export function decideEmaPullbackTick({ candles, lastPrice, hasBase, baseAvailable, usdtAvailable, strategy, sessionEntryPrice = 0 }) {
  const c = strategy?.conditions || {};
  const r = strategy?.risk || {};
  const opts = {
    emaFastPeriod: c.emaFastPeriod || 20,
    emaSlowPeriod: c.emaSlowPeriod || 50,
    rsiPeriod: c.rsiPeriod || 14,
    rsiOversold: c.rsiOversold || 35,
    volumeMultiplier: c.volumeMultiplier || 1.2,
    volumeMaPeriod: c.volumeMaPeriod || 10,
  };
  const evalResult = evaluateEmaPullback(candles, opts);
  if (!evalResult.ready) {
    return { action: "hold", reason: evalResult.summary, evaluation: evalResult };
  }

  const price = Number(lastPrice ?? evalResult.close);
  const riskPct = (r.riskPerTradePct ?? strategy?.positionPct ?? 1) / 100;
  const entry = Number(sessionEntryPrice || 0);
  const hasPosition = hasBase && entry > 0 && Number(baseAvailable || 0) * price >= 5;

  if (hasPosition) {
    // Stop loss: tight
    const slDist = evalResult.ema50 != null ? evalResult.ema50 : entry * 0.98;
    const slPct = r.stopLossPct || 0.03;
    const tpPct = r.takeProfitPct || 0.06;
    const pnlPct = ((price - entry) / entry) * 100;

    // Trailing stop after profit > 2R
    if (entry > 0 && price > entry * 1.03) {
      const trailStop = entry * (1 + (price - entry) * 0.5 / entry);
      if (price < trailStop) {
        return {
          action: "sell",
          reason: `移动止盈激活 · 浮盈 ${(pnlPct).toFixed(2)}% · 回撤至成本线以上止盈`,
          evaluation: evalResult,
        };
      }
    }

    // Hard stop loss
    if (price <= entry * (1 - slPct)) {
      return {
        action: "sell",
        reason: `止损：亏损达 ${slPct * 100}% · 价格 ${fmt(price)} vs 入场 ${fmt(entry)}`,
        evaluation: evalResult,
      };
    }

    // Take profit
    if (price >= entry * (1 + tpPct)) {
      return {
        action: "sell",
        sellPct: r.takeProfitPartialPct !== undefined ? (r.takeProfitPartialPct / 100) : 1,
        reason: `止盈：盈利达 ${tpPct * 100}% · 价格 ${fmt(price)} vs 入场 ${fmt(entry)}`,
        evaluation: evalResult,
      };
    }

    // RSI overbought exit for longs
    if (evalResult.rsi != null && evalResult.rsi >= 75 && pnlPct > 2) {
      return {
        action: "sell",
        sellPct: 0.5,
        reason: `RSI 超买 ${evalResult.rsi.toFixed(2)} · 锁定部分利润`,
        evaluation: evalResult,
      };
    }

    return {
      action: "hold",
      reason: `持仓中 · 盈亏 ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}% · 止损 ${fmt(slDist)} · RSI ${evalResult.rsi?.toFixed(2)}`,
      evaluation: evalResult,
    };
  }

  // Enter long
  if (evalResult.longReady) {
    const spend = Number(usdtAvailable || 0) * riskPct;
    const qty = spend > 0 && price > 0 ? spend / price : 0;
    if (qty <= 0) return { action: "hold", reason: "USDT 不足", evaluation: evalResult };
    return {
      action: "buy",
      reason: `EMA回调做多 · ${opts.emaSlowPeriod}EMA上 · RSI ${evalResult.rsi?.toFixed(2)} · 量比 ${evalResult.volRatio.toFixed(2)}x`,
      qty: qty >= 1 ? qty.toFixed(4) : qty.toFixed(6),
      evaluation: evalResult,
    };
  }

  return {
    action: "hold",
    reason: `EMA回调观望（${evalResult.passCount}/${evalResult.totalChecks} 条件满足）· RSI ${evalResult.rsi?.toFixed(2)}`,
    evaluation: evalResult,
  };
}
