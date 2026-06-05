/**
 * SAR + MACD 双信号策略 — 条件校验与 tick 决策
 */
import {
  computeMacd,
  computeSar,
  computeVolumeMaConfirm,
  recentHigh,
} from "./indicators.js";

const DEFAULTS = {
  sarStep: 0.02,
  sarMax: 0.2,
  recentHighLookback: 20,
  takeProfitPartialPct: 50,
  volumeMaFast: 5,
  volumeMaSlow: 10,
};

function fmtPrice(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

/** 逐条校验入场条件，供聊天展示 */
export function evaluateSarMacd(candles, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const latest = candles?.at(-1);
  const minBars = 35;
  if (!latest || candles.length < minBars) {
    const got = candles?.length || 0;
    return {
      ready: false,
      entryReady: false,
      checks: [{
        id: "data",
        label: "K线数据",
        pass: false,
        detail: got ? `当前 ${got} 根，需至少 ${minBars} 根` : "K线拉取失败或为空",
      }],
      summary: got
        ? `K线数据不足（${got}/${minBars} 根），无法分析`
        : "K线数据不足，无法分析",
    };
  }

  const close = Number(latest.close);
  const sar = computeSar(candles, opts.sarStep, opts.sarMax);
  const macd = computeMacd(candles.map((c) => c.close));
  const volume = computeVolumeMaConfirm(candles);
  const high = recentHigh(candles, opts.recentHighLookback);

  const checks = [
    {
      id: "sar",
      label: "收盘价在 SAR 之上（多头趋势）",
      pass: !!(sar?.priceAboveSar && sar?.trend === "long"),
      detail: sar
        ? `收盘 ${fmtPrice(close)} · SAR ${fmtPrice(sar.value)} · 趋势 ${sar.trend === "long" ? "多" : "空"}`
        : "SAR 不可用",
    },
    {
      id: "macd",
      label: "MACD 多头（DIF > DEA 且柱 > 0）",
      pass: !!macd?.bullish,
      detail: macd
        ? `DIF ${macd.dif} · DEA ${macd.dea} · 柱 ${macd.hist}`
        : "MACD 不可用",
    },
    {
      id: "volume",
      label: "量能 MA(5) > MA(10)",
      pass: !!volume.ok,
      detail:
        volume.volMa5 != null
          ? `VolMA5 ${Number(volume.volMa5).toFixed(2)} · VolMA10 ${Number(volume.volMa10).toFixed(2)}`
          : "量能数据不足",
    },
  ];

  const entryReady = checks.every((c) => c.pass);
  const passCount = checks.filter((c) => c.pass).length;

  return {
    ready: true,
    entryReady,
    passCount,
    totalChecks: checks.length,
    checks,
    sar,
    macd,
    volume,
    recentHigh: high,
    close,
    summary: entryReady
      ? "三项入场条件均已满足，可执行开多"
      : `入场条件 ${passCount}/${checks.length} 满足，暂不建议开仓`,
  };
}

/** 模拟 tick / 回测决策 */
export function decideSarMacdTick({
  candles,
  lastPrice,
  hasBase,
  baseAvailable,
  usdtAvailable,
  strategy,
  sessionEntryPrice = 0,
}) {
  const opts = {
    ...DEFAULTS,
    ...(strategy?.conditions || {}),
    takeProfitPartialPct:
      strategy?.conditions?.takeProfitPartialPct ??
      strategy?.risk?.takeProfitPartialPct ??
      DEFAULTS.takeProfitPartialPct,
  };

  const evalResult = evaluateSarMacd(candles, opts);
  if (!evalResult.ready) {
    return { action: "hold", reason: evalResult.summary, evaluation: evalResult };
  }

  const positionPct = (strategy?.positionPct || 10) / 100;
  const close = Number(lastPrice ?? evalResult.close);
  const hasPosition =
    hasBase &&
    Number(sessionEntryPrice) > 0 &&
    Number(baseAvailable || 0) * close >= 5;

  if (hasPosition) {
    const sar = evalResult.sar;
    const high = evalResult.recentHigh;
    const partialPct = (opts.takeProfitPartialPct || 50) / 100;

    if (sar && close < sar.value) {
      return {
        action: "sell",
        reason: `止损：价格 ${fmtPrice(close)} 跌破 SAR ${fmtPrice(sar.value)}`,
        evaluation: evalResult,
      };
    }

    if (high && close >= high * 0.998) {
      return {
        action: "sell",
        sellPct: partialPct,
        reason: `止盈：接近近期高点 ${fmtPrice(high)}，平仓 ${opts.takeProfitPartialPct}%`,
        evaluation: evalResult,
      };
    }

    return {
      action: "hold",
      reason: `持仓中 · SAR ${fmtPrice(sar?.value)} · 近期高 ${fmtPrice(high)}`,
      evaluation: evalResult,
    };
  }

  if (evalResult.entryReady) {
    const spend = Number(usdtAvailable || 0) * positionPct;
    const qty = spend > 0 && close > 0 ? spend / close : 0;
    if (qty <= 0) {
      return { action: "hold", reason: "USDT 余额不足", evaluation: evalResult };
    }
    return {
      action: "buy",
      reason: `SAR+MACD 开多 · ${evalResult.passCount}/${evalResult.totalChecks} 条件满足`,
      qty: qty >= 1 ? qty.toFixed(4) : qty.toFixed(6),
      evaluation: evalResult,
    };
  }

  const failed = evalResult.checks.filter((c) => !c.pass).map((c) => c.id).join("、");
  return {
    action: "hold",
    reason: `SAR+MACD 观望（未满足：${failed || "—"}）`,
    evaluation: evalResult,
  };
}
