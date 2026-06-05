/**
 * 趋势突破策略 — 200MA 过滤 + N 根 K 线高低点突破 + 量比
 */
function fmt(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

export function evaluateBreakoutTrend(candles, options = {}) {
  const trendMaPeriod = options.trendMaPeriod || 200;
  const breakoutLookback = options.breakoutLookback || 20;
  const volumeMaPeriod = options.volumeMaPeriod || 20;
  const volumeMultiplier = options.volumeMultiplier || 1.5;

  const minBars = trendMaPeriod + 5;
  if (!candles?.length || candles.length < minBars) {
    const got = candles?.length || 0;
    return {
      ready: false,
      entryReady: false,
      checks: [{
        id: "data",
        label: "K线数据",
        pass: false,
        detail: got ? `当前 ${got} 根，需至少 ${minBars} 根（${trendMaPeriod}MA）` : "K线拉取失败或为空",
      }],
      summary: got ? `K线数据不足（${got}/${minBars} 根）` : "K线数据不足",
    };
  }

  const latest = candles.at(-1);
  const closes = candles.map((c) => c.close);
  const trendMa = closes.slice(-trendMaPeriod).reduce((a, b) => a + b, 0) / trendMaPeriod;
  const window = candles.slice(-breakoutLookback);
  const rangeHigh = Math.max(...window.map((c) => c.high));
  const rangeLow = Math.min(...window.map((c) => c.low));
  const volSlice = candles.slice(-volumeMaPeriod);
  const volAvg = volSlice.reduce((s, c) => s + c.volume, 0) / volSlice.length;
  const volRatio = volAvg > 0 ? latest.volume / volAvg : 0;
  const close = Number(latest.close);

  const longTrend = close > trendMa;
  const shortTrend = close < trendMa;
  const breakHigh = close >= rangeHigh * 0.999;
  const breakLow = close <= rangeLow * 1.001;
  const volOk = volRatio >= volumeMultiplier;

  const longReady = longTrend && breakHigh && volOk;
  const shortReady = shortTrend && breakLow && volOk;

  const checks = [
    {
      id: "trend_ma",
      label: `收盘价 vs ${trendMaPeriod}MA（趋势过滤）`,
      pass: longTrend || shortTrend,
      detail: `收盘 ${fmt(close)} · ${trendMaPeriod}MA ${fmt(trendMa)} · ${longTrend ? "多头区" : shortTrend ? "空头区" : "均线附近"}`,
    },
    {
      id: "breakout",
      label: `${breakoutLookback}K 高低点突破`,
      pass: breakHigh || breakLow,
      detail: `区间高 ${fmt(rangeHigh)} / 低 ${fmt(rangeLow)} · ${breakHigh ? "突破高点" : breakLow ? "跌破低点" : "区间内"}`,
    },
    {
      id: "volume",
      label: `成交量 > ${volumeMaPeriod}均量 × ${volumeMultiplier}`,
      pass: volOk,
      detail: `量比 ${volRatio.toFixed(2)}x（VolMA${volumeMaPeriod} ${Number(volAvg).toFixed(2)}）`,
    },
  ];

  const passCount = checks.filter((c) => c.pass).length;
  const entryReady = longReady || (options.bidirectional && shortReady);

  return {
    ready: true,
    entryReady,
    longReady,
    shortReady,
    passCount,
    totalChecks: checks.length,
    checks,
    trendMa,
    rangeHigh,
    rangeLow,
    volRatio,
    close,
    summary: longReady
      ? "做多三条件满足"
      : shortReady
        ? "做空三条件满足"
        : `条件 ${passCount}/${checks.length} · 做多${longReady ? "✓" : "×"} 做空${shortReady ? "✓" : "×"}`,
  };
}

export function decideBreakoutTrendTick({
  candles,
  lastPrice,
  hasBase,
  baseAvailable,
  usdtAvailable,
  strategy,
  sessionEntryPrice = 0,
}) {
  const c = strategy?.conditions || {};
  const r = strategy?.risk || {};
  const opts = {
    trendMaPeriod: c.trendMaPeriod || 200,
    breakoutLookback: c.breakoutLookback || 20,
    volumeMaPeriod: c.volumeMaPeriod || 20,
    volumeMultiplier: c.volumeMultiplier || 1.5,
    bidirectional: c.bidirectional !== false,
  };
  const evalResult = evaluateBreakoutTrend(candles, opts);
  if (!evalResult.ready) {
    return { action: "hold", reason: evalResult.summary, evaluation: evalResult };
  }

  const price = Number(lastPrice ?? evalResult.close);
  const riskPct = (r.riskPerTradePct ?? strategy?.positionPct ?? 1) / 100;
  const rr = r.rewardRiskRatio || 2;
  const breakoutLow = evalResult.rangeLow;
  const breakoutHigh = evalResult.rangeHigh;
  const entry = Number(sessionEntryPrice || 0);
  const hasPosition =
    hasBase && entry > 0 && Number(baseAvailable || 0) * price >= 5;

  if (hasPosition) {
    const riskDist = Math.abs(entry - breakoutLow);
    const tpPrice = entry + riskDist * rr;
    const pnlPct = ((price - entry) / entry) * 100;

    if (price < breakoutLow) {
      return {
        action: "sell",
        reason: `止损：跌破突破K线低点 ${fmt(breakoutLow)}`,
        evaluation: evalResult,
      };
    }
    if (price >= tpPrice) {
      return {
        action: "sell",
        reason: `止盈：达到 ${rr}:1 盈亏比目标 ${fmt(tpPrice)}`,
        evaluation: evalResult,
      };
    }
    if (r.trailingStopAtR && riskDist > 0) {
      const profitR = (price - entry) / riskDist;
      if (profitR >= r.trailingStopAtR) {
        return {
          action: "hold",
          reason: `移动止损已激活 · 浮盈 ${profitR.toFixed(2)}R · 止损上移至成本`,
          evaluation: evalResult,
        };
      }
    }
    return {
      action: "hold",
      reason: `持仓中 · 盈亏 ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}% · 止损 ${fmt(breakoutLow)} · 目标 ${fmt(tpPrice)}`,
      evaluation: evalResult,
    };
  }

  if (evalResult.longReady) {
    const spend = Number(usdtAvailable || 0) * riskPct;
    const qty = spend > 0 && price > 0 ? spend / price : 0;
    if (qty <= 0) return { action: "hold", reason: "USDT 不足", evaluation: evalResult };
    return {
      action: "buy",
      reason: `突破做多 · ${opts.trendMaPeriod}MA上 · 突破${opts.breakoutLookback}K高 · 量比${evalResult.volRatio.toFixed(2)}x`,
      qty: qty >= 1 ? qty.toFixed(4) : qty.toFixed(6),
      evaluation: evalResult,
      breakoutStop: breakoutLow,
    };
  }

  if (evalResult.shortReady && opts.bidirectional) {
    const spend = Number(usdtAvailable || 0) * riskPct;
    const qty = spend > 0 && price > 0 ? spend / price : 0;
    if (qty <= 0) return { action: "hold", reason: "USDT 不足", evaluation: evalResult };
    const isFutures = strategy?.category === "futures" || /永续|合约/i.test(String(strategy?.category || ""));
    if (isFutures) {
      return {
        action: "buy",
        posSide: "short",
        reason: `突破做空 · ${opts.trendMaPeriod}MA下 · 跌破${opts.breakoutLookback}K低 · 量比${evalResult.volRatio.toFixed(2)}x`,
        qty: qty >= 1 ? qty.toFixed(4) : qty.toFixed(6),
        evaluation: evalResult,
        breakoutStop: breakoutHigh,
      };
    }
    return {
      action: "hold",
      reason: `做空信号（${opts.trendMaPeriod}MA下 · 跌破${opts.breakoutLookback}K低）· 请使用永续/合约策略以执行`,
      evaluation: evalResult,
    };
  }

  return {
    action: "hold",
    reason: evalResult.summary,
    evaluation: evalResult,
  };
}
