/**
 * 自然语言 → 结构化策略参数（支持全 USDT 现货交易对）
 */
import {
  resolveSymbolFromText,
  resolveSymbolFromTextSync,
  baseCoinFromSymbol,
  getCachedSpotSymbols,
  extractMentionedSymbolAsync,
} from "./symbolUtils.js";

const DEFAULTS = {
  symbol: "BTCUSDT",
  type: "trend",
  category: "futures",
  leverage: 5,
  marginMode: "crossed",
  positionPct: 50,
  takeProfitPct: 3,
  stopLossPct: 2,
  maxDrawdownPct: 5,
  maPeriod: 20,
  volumeMultiplier: 1.5,
  gridSpacingPct: 1.2,
  arbitrageSpreadPct: 0.3,
  usePerception: true,
};

/** 用户明确只要现货（否则默认合约） */
export function isSpotOnlyStrategy(text) {
  return /(?:仅|只|专门)?(?:做|交易)?\s*现货|现货(?:策略|交易|买卖)|spot\s*only|不做合约|不用合约|非合约|只买现货/i.test(
    String(text || "")
  );
}

export function hasExplicitLeverageInText(text) {
  const t = String(text || "");
  return (
    /(\d+)\s*[xX×倍]/.test(t) ||
    /杠杆.{0,16}(\d+)/.test(t) ||
    /倍数.{0,12}(\d+)/.test(t) ||
    /(?:改|换|调|设|为|成|到|提到|升到|降到).{0,16}(\d+)\s*(?:倍|[xX×])/.test(t)
  );
}

export function parseLeverageFromText(text, fallback = DEFAULTS.leverage) {
  const t = String(text || "");
  const patterns = [
    /(?:改|换|调|设|用|为|成|到|提到|升到|降到).{0,16}?(\d+)\s*(?:倍|[xX×])/,
    /(?:杠杆|倍数).{0,16}?(\d+)\s*(?:倍|[xX×])?/,
    /(\d+)\s*[xX×倍]\s*(?:杠杆)?/,
    /(?:杠杆)\s*(\d+)\s*[xX×倍]?/,
    /倍数\s*(?:改|为|成|到)?\s*(\d+)/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) return Math.min(125, Math.max(1, Number(m[1])));
  }
  return fallback;
}

/** 仅调整杠杆/倍数（需已有策略，非即时开单） */
export function isStrategyLeverageTweak(text, previousStrategy = null) {
  if (!previousStrategy) return false;
  const t = String(text || "").trim();
  if (!hasExplicitLeverageInText(t)) return false;
  if (/^(开多|开空|平多|平空|平仓|做多|做空)/.test(t)) return false;
  if (/(?:开多|开空|平多|平空|做多|做空)/.test(t) && /\d+\s*u\b/i.test(t)) return false;
  if (
    /(?:改|换|调|设|用|变成|改为|改成|调整到|换成|提到|升到|降到).{0,12}(?:杠杆|倍数)/.test(t) ||
    /(?:杠杆|倍数).{0,12}(?:改|换|调|设|为|成|到)/.test(t)
  ) {
    return true;
  }
  if (t.length <= 32 && !/(?:买入|卖出|市价单|保证金|开[仓多空]|平[仓多空])/i.test(t)) {
    return true;
  }
  return false;
}

export function resolveStrategyCategory(text, previousCategory = null) {
  if (isSpotOnlyStrategy(text)) return "spot";
  if (/永续|合约|futures|USDT-FUTURES/i.test(String(text || ""))) return "futures";
  if (previousCategory === "spot" && !parseLeverageFromText(text, null)) return "spot";
  return previousCategory || DEFAULTS.category;
}

export function venueLabel(category) {
  return category === "spot" ? "现货" : "USDT 永续";
}

/** 合约策略必须有杠杆；现货清除杠杆 */
export function ensureStrategyLeverage(strategy, sourceText = "") {
  if (!strategy) return strategy;
  const text = sourceText || strategy.rawInstruction || "";
  if (isSpotOnlyStrategy(text)) {
    strategy.category = "spot";
    strategy.leverage = null;
    return strategy;
  }
  if (strategy.category !== "spot") {
    strategy.category = "futures";
    if (hasExplicitLeverageInText(text)) {
      const parsed = parseLeverageFromText(text, null);
      if (parsed != null) strategy.leverage = parsed;
    } else {
      strategy.leverage = strategy.leverage ?? DEFAULTS.leverage;
    }
    if (/逐仓|isolated/i.test(text)) strategy.marginMode = "isolated";
    else if (/全仓|crossed/i.test(text)) strategy.marginMode = "crossed";
    else strategy.marginMode = strategy.marginMode || DEFAULTS.marginMode;
  }
  return strategy;
}

function leverageParamRow(strategy) {
  if (strategy.category === "spot") return null;
  const lev = strategy.leverage ?? DEFAULTS.leverage;
  const margin = strategy.marginMode === "isolated" ? "逐仓" : "全仓";
  return {
    dim: "杠杆倍数",
    status: `${lev}x · ${margin} · ${venueLabel(strategy.category)}`,
    signal: "可说「改成10x」「杠杆调到20倍」",
    emoji: "⚡",
  };
}

function insertLeverageRow(rows, strategy) {
  const row = leverageParamRow(strategy);
  if (!row) return rows;
  const idx = rows.findIndex((r) => /交易对/.test(r.dim));
  rows.splice(idx >= 0 ? idx + 1 : 0, 0, row);
  return rows;
}

function pickNumber(text, patterns, fallback) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return Number(m[1]);
  }
  return fallback;
}

function detectType(text) {
  if (
    /200\s*(?:MA|ma|均线)|20\s*(?:根|K|k)\s*线.*(?:高|低)|盈亏比\s*\d+\s*[:：]\s*1|趋势突破|突破.*(?:高|低)点/.test(
      text
    )
  ) {
    return "breakout_trend";
  }
  if (/EMA(?:回调)?|ema\s*(?:回调|pullback)/i.test(text)) return "ema_pullback";
  if (/SAR/i.test(text) && /MACD/i.test(text)) return "sar_macd";
  if (/网格|grid/i.test(text)) return "grid";
  if (/套利|arbitrage/i.test(text)) return "arbitrage";
  return "trend";
}

/** 长文策略说明 — 不继承旧预设的仓位/止盈止损 */
function isNewStrategyDocument(text) {
  const t = (text || "").trim();
  if (t.length < 80) return false;
  return (
    (/止损/.test(t) && /(?:止盈|盈亏比)/.test(t)) ||
    (/做多/.test(t) && /做空/.test(t)) ||
    /全局风控|入场条件|开仓条件/.test(t)
  );
}

function pickTimeframe(text) {
  if (/1\s*[Hh]|1\s*小时|1h/i.test(text)) return "1H";
  if (/4\s*[Hh]|4\s*小时/i.test(text)) return "4H";
  if (/15\s*[Mm]|15\s*分钟/i.test(text)) return "15m";
  if (/1\s*[Dd]|日线/i.test(text)) return "1D";
  return null;
}

function truncateText(s, max = 140) {
  if (!s) return "";
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 从策略原文提取带标题的段落（入场/出场/风控等） */
function extractSection(text, labels) {
  if (!text) return null;
  for (const label of labels) {
    const re = new RegExp(
      `(?:^|\\n)\\s*(?:[一二三四五六七八九十\\d]+[、.．）\\)]\\s*)?${label}\\s*[：:]\\s*([^\\n]+)`,
      "i"
    );
    const m = text.match(re);
    if (!m) continue;

    const start = m.index + m[0].length - m[1].length;
    const tail = text.slice(start);
    const lines = [m[1].trim()];
    for (const line of tail.split("\n").slice(1)) {
      const t = line.trim();
      if (!t) continue;
      if (/^(?:[一二三四五六七八九十\\d]+[、.．）\\)]|[#*]{1,3}\\s|【)/.test(t)) break;
      if (/^(?:做多|做空|入场|开仓|离场|出场|平仓|仓位|全局|风控|核心|建仓)/.test(t) && /[：:]/.test(t)) break;
      lines.push(t);
      if (lines.length >= 5) break;
    }
    return truncateText(lines.join(" · "));
  }
  return null;
}

/** 生成与 UI 策略参数卡片一一对应的行 */
export function buildParamRows(strategy, sourceText = "") {
  const c = strategy?.conditions || {};
  const r = strategy?.risk || {};
  const src = (sourceText || strategy?.rawInstruction || "").trim();
  const rows = [];

  if (strategy.type === "breakout_trend") {
    rows.push({
      dim: "交易对 / 周期",
      status: `${strategy.symbol} · ${strategy.candleGranularity || "1H"} · ${venueLabel(strategy.category)}`,
      signal: `单笔风险 ${r.riskPerTradePct ?? strategy.positionPct ?? 1}%`,
      emoji: "⚙️",
    });

    const longEntry =
      extractSection(src, ["做多条件", "做多入场", "开多条件", "多头入场"]) ||
      `价格 > ${c.trendMaPeriod ?? 200}MA · 突破近 ${c.breakoutLookback ?? 20}K 高点 · 成交量 > ${c.volumeMultiplier ?? 1.5}x 均量`;
    rows.push({ dim: "做多入场", status: longEntry, signal: "已解析", emoji: "📈" });

    if (c.bidirectional) {
      const shortEntry =
        extractSection(src, ["做空条件", "做空入场", "开空条件", "空头入场"]) ||
        `价格 < ${c.trendMaPeriod ?? 200}MA · 跌破近 ${c.breakoutLookback ?? 20}K 低点 · 成交量 > ${c.volumeMultiplier ?? 1.5}x 均量`;
      rows.push({ dim: "做空入场", status: shortEntry, signal: "已解析", emoji: "📉" });
    }

    rows.push({
      dim: "仓位 / 盈亏比",
      status: `单笔风险 ${r.riskPerTradePct ?? strategy.positionPct ?? 1}% · 盈亏比 ${r.rewardRiskRatio ?? 2}:1`,
      signal: `${r.trailingStopAtR ?? 1}R 移动止损至成本`,
      emoji: "💰",
    });

    rows.push({
      dim: "出场",
      status:
        extractSection(src, ["离场条件", "出场条件", "平仓条件", "止损止盈"]) ||
        "止损：突破K线高/低点 · 止盈：严格 2:1 · 浮盈 1R 移动止损至成本",
      signal: "已解析",
      emoji: "🎯",
    });

    rows.push({
      dim: "全局风控",
      status:
        extractSection(src, ["全局风控", "风控规则", "风险控制", "全局规则"]) ||
        `日止损 ≤ ${r.maxDailyStopLoss ?? 2} 次 · 连亏 ${r.reduceRiskAfterLosses ?? 3} 次风险降至 ${r.reducedRiskPct ?? 0.5}%`,
      signal: "已解析",
      emoji: "🛡️",
    });
  } else if (strategy.type === "sar_macd") {
    rows.push({
      dim: "交易对 / 仓位",
      status: `${strategy.symbol} · ${venueLabel(strategy.category)}`,
      signal: `仓位 ${strategy.positionPct ?? "—"}%`,
      emoji: "⚙️",
    });
    rows.push({
      dim: "入场条件",
      status:
        extractSection(src, ["入场条件", "开仓条件", "开多条件"]) ||
        "SAR 之上 · MACD 多头(DIF>DEA 且柱>0) · 量能 MA5>MA10",
      signal: "已解析",
      emoji: "✅",
    });
    rows.push({
      dim: "风控",
      status: `止盈 ${r.takeProfitPct ?? "—"}% · 止损 ${r.stopLossPct ?? "—"}%`,
      signal: `回撤暂停 ${r.maxDrawdownPct ?? "—"}%`,
      emoji: "🛡️",
    });
    rows.push({
      dim: "出场",
      status:
        extractSection(src, ["离场条件", "出场条件", "平仓条件"]) ||
        `止损：跌破 SAR · 止盈：近 ${c.recentHighLookback ?? 20} 根高点平仓 ${c.takeProfitPartialPct ?? 50}%`,
      signal: "已解析",
      emoji: "🎯",
    });
  } else if (strategy.type === "grid") {
    rows.push({
      dim: "交易对 / 仓位",
      status: `${strategy.symbol} · ${venueLabel(strategy.category)}`,
      signal: `仓位 ${strategy.positionPct ?? "—"}%`,
      emoji: "⚙️",
    });
    rows.push({
      dim: "入场条件",
      status:
        extractSection(src, ["入场条件", "网格规则", "开仓条件"]) ||
        `网格间距 ${c.gridSpacingPct ?? "—"}% · ${c.gridLevels ?? "—"} 层`,
      signal: "已解析",
      emoji: "✅",
    });
    rows.push({
      dim: "风控",
      status: `止盈 ${r.takeProfitPct ?? "—"}% · 止损 ${r.stopLossPct ?? "—"}%`,
      signal: `回撤暂停 ${r.maxDrawdownPct ?? "—"}%`,
      emoji: "🛡️",
    });
  } else {
    rows.push({
      dim: "交易对 / 仓位",
      status: `${strategy.symbol} · ${venueLabel(strategy.category)}`,
      signal: `仓位 ${strategy.positionPct ?? "—"}%`,
      emoji: "⚙️",
    });
    rows.push({
      dim: "入场条件",
      status:
        extractSection(src, ["入场条件", "开仓条件", "核心逻辑"]) ||
        `突破 ${c.maPeriod ?? 20} 日均线 · 量比 > ${c.volumeMultiplier ?? 1.5}x`,
      signal: "已解析",
      emoji: "✅",
    });
    rows.push({
      dim: "风控",
      status: `止盈 ${r.takeProfitPct ?? "—"}% · 止损 ${r.stopLossPct ?? "—"}%`,
      signal: `回撤暂停 ${r.maxDrawdownPct ?? "—"}%`,
      emoji: "🛡️",
    });
    const exit = extractSection(src, ["离场条件", "出场条件", "平仓条件"]);
    if (exit) rows.push({ dim: "出场", status: exit, signal: "已解析", emoji: "🎯" });
  }

  const core = extractSection(src, ["核心逻辑", "策略逻辑", "交易逻辑"]);
  if (core && !rows.some((row) => row.status?.includes(core.slice(0, 20)))) {
    rows.splice(1, 0, { dim: "核心逻辑", status: core, signal: "原文", emoji: "📋" });
  }

  if (strategy.usePerception !== false) {
    rows.push({
      dim: "感知 Skill",
      status: "已启用 · 偏空拦截买入 · 手动卖出不拦截",
      signal: "联动执行层",
      emoji: "🧠",
    });
  }

  if (strategy.symbolValid === false && strategy.symbolNote) {
    rows.push({ dim: "交易对校验", status: strategy.symbolNote, signal: "请检查", emoji: "⚠️" });
  }

  return insertLeverageRow(rows, strategy);
}

export function buildStrategyName(s) {
  const coin = baseCoinFromSymbol(s.symbol);
  const typeLabel =
    s.type === "sar_macd"
      ? "SAR+MACD"
      : s.type === "breakout_trend"
        ? "突破趋势"
        : s.type === "grid"
          ? "网格"
          : s.type === "arbitrage"
            ? "套利"
            : "趋势";
  return `${typeLabel} · ${coin}`;
}

export function buildSummary(s) {
  const coin = baseCoinFromSymbol(s.symbol);
  const typeWord =
    s.type === "sar_macd"
      ? "SAR+MACD"
      : s.type === "breakout_trend"
        ? "突破趋势"
        : s.type === "grid"
          ? "网格"
          : s.type === "arbitrage"
            ? "套利"
            : "趋势";
  const parts = [`${coin} ${typeWord}`];

  if (s.type === "breakout_trend") {
    const c = s.conditions || {};
    const r = s.risk || {};
    parts.push(`单笔风险 ${r.riskPerTradePct ?? s.positionPct ?? 1}%`);
    parts.push(`盈亏比 ${r.rewardRiskRatio ?? 2}:1`);
    parts.push(`${c.trendMaPeriod ?? 200}MA 过滤`);
    parts.push(`${c.breakoutLookback ?? 20}K 高低突破`);
    parts.push(`量>${c.volumeMultiplier ?? 1.5}x`);
    if (s.candleGranularity) parts.push(s.candleGranularity);
    if (s.category === "futures") parts.push("永续");
    if (c.bidirectional) parts.push("多空双向");
    if (r.maxDailyStopLoss) parts.push(`日止损≤${r.maxDailyStopLoss}次`);
    return parts.join(" · ");
  }

  parts.push(`仓位 ${s.positionPct}%`);
  parts.push(`止盈 ${s.risk.takeProfitPct}% / 止损 ${s.risk.stopLossPct}%`);
  parts.push(`最大回撤暂停 ${s.risk.maxDrawdownPct}%`);
  if (s.category !== "spot") {
    parts.push(`${venueLabel(s.category)} · ${s.leverage ?? DEFAULTS.leverage}x`);
  } else {
    parts.push("现货");
  }
  if (s.type === "sar_macd") {
    const pct = s.conditions?.takeProfitPartialPct ?? 50;
    parts.push(`条件: SAR之上 + MACD多头 + 量能MA5>MA10 · 止盈分批${pct}% · 止损跌破SAR`);
  } else if (s.type === "trend") {
    parts.push(
      `条件: 突破${s.conditions.maPeriod}日均线且成交量>${s.conditions.volumeMultiplier}x`
    );
  } else if (s.type === "grid") {
    parts.push(`网格间距 ${s.conditions.gridSpacingPct}% · ${s.conditions.gridLevels} 层`);
  } else if (s.type === "arbitrage") {
    parts.push(`价差阈值 ≥ ${s.conditions.arbitrageSpreadPct}%`);
  }
  return parts.join(" · ");
}

/** 仅当文本里提到币种时才更新 symbol，避免改止盈时误改交易对 */
function detectMentionedSymbol(text) {
  return resolveSymbolFromTextSync(text, null);
}

export function parseIntent(nlText, previousStrategy = null) {
  const text = (nlText || "").trim();
  const fullReplace = isNewStrategyDocument(text);
  const prev = fullReplace
    ? { usePerception: previousStrategy?.usePerception ?? DEFAULTS.usePerception }
    : previousStrategy || {};
  const conditions = {
    maPeriod: prev.conditions?.maPeriod ?? DEFAULTS.maPeriod,
    trendMaPeriod: prev.conditions?.trendMaPeriod ?? 200,
    breakoutLookback: prev.conditions?.breakoutLookback ?? 20,
    volumeMaPeriod: prev.conditions?.volumeMaPeriod ?? 20,
    volumeMultiplier: prev.conditions?.volumeMultiplier ?? DEFAULTS.volumeMultiplier,
    breakoutAboveMa: prev.conditions?.breakoutAboveMa ?? true,
    bidirectional: prev.conditions?.bidirectional ?? false,
    gridSpacingPct: prev.conditions?.gridSpacingPct ?? DEFAULTS.gridSpacingPct,
    arbitrageSpreadPct: prev.conditions?.arbitrageSpreadPct ?? DEFAULTS.arbitrageSpreadPct,
    gridLevels: prev.conditions?.gridLevels ?? 5,
  };
  const risk = {
    takeProfitPct: prev.risk?.takeProfitPct ?? DEFAULTS.takeProfitPct,
    stopLossPct: prev.risk?.stopLossPct ?? DEFAULTS.stopLossPct,
    maxDrawdownPct: prev.risk?.maxDrawdownPct ?? DEFAULTS.maxDrawdownPct,
    riskPerTradePct: prev.risk?.riskPerTradePct ?? 1,
    rewardRiskRatio: prev.risk?.rewardRiskRatio ?? 2,
    trailingStopAtR: prev.risk?.trailingStopAtR ?? 1,
    maxDailyStopLoss: prev.risk?.maxDailyStopLoss ?? 2,
    reduceRiskAfterLosses: prev.risk?.reduceRiskAfterLosses ?? 3,
    reducedRiskPct: prev.risk?.reducedRiskPct ?? 0.5,
  };

  const strategy = {
    id: fullReplace ? `strat_${Date.now()}` : prev.id || `strat_${Date.now()}`,
    name: fullReplace ? "自定义策略" : prev.name || "自定义策略",
    symbol: prev.symbol || DEFAULTS.symbol,
    type: fullReplace ? DEFAULTS.type : prev.type || DEFAULTS.type,
    category: fullReplace
      ? resolveStrategyCategory(text, null)
      : resolveStrategyCategory(text, prev.category || DEFAULTS.category),
    leverage: prev.leverage ?? DEFAULTS.leverage,
    marginMode: prev.marginMode ?? DEFAULTS.marginMode,
    candleGranularity: prev.candleGranularity || "1H",
    positionPct: fullReplace ? 1 : prev.positionPct ?? DEFAULTS.positionPct,
    rawInstruction: text,
    updatedAt: new Date().toISOString(),
    usePerception: prev.usePerception ?? DEFAULTS.usePerception,
    conditions: { ...conditions },
    risk: { ...risk },
  };

  const mentioned = detectMentionedSymbol(text);
  if (mentioned) strategy.symbol = mentioned;

  strategy.type = detectType(text) || strategy.type;

  const riskPct = pickNumber(
    text,
    [
      /(?:单笔|每笔|单次).*?(\d+(?:\.\d+)?)\s*%\s*(?:风险|Risk)/i,
      /(\d+(?:\.\d+)?)\s*%\s*(?:风险)/,
      /账户(?:权益|资金).*?(\d+(?:\.\d+)?)\s*%/,
      /(?:风险|Risk).*?(\d+(?:\.\d+)?)\s*%/,
    ],
    null
  );
  if (riskPct != null) {
    strategy.risk.riskPerTradePct = riskPct;
    strategy.positionPct = riskPct;
  }

  strategy.positionPct = pickNumber(
    text,
    [/(\d+(?:\.\d+)?)\s*%\s*仓位/, /买入\s*(\d+(?:\.\d+)?)\s*%/, /position\s*(\d+)/i, /总仓位\s*(\d+(?:\.\d+)?)\s*%/],
    strategy.positionPct
  );

  strategy.risk.rewardRiskRatio = pickNumber(
    text,
    [/盈亏比\s*(\d+(?:\.\d+)?)\s*[:：]\s*1/, /(\d+(?:\.\d+)?)\s*[:：]\s*1\s*(?:盈亏|r|R)/i, /R\s*[:：]\s*(\d+)/i],
    strategy.risk.rewardRiskRatio
  );

  strategy.risk.trailingStopAtR = pickNumber(
    text,
    [/(\d+(?:\.\d+)?)\s*R(?:时|后)?.*移动/, /移动止损.*?(\d+(?:\.\d+)?)\s*R/, /浮盈.*?(\d+(?:\.\d+)?)\s*R/],
    strategy.risk.trailingStopAtR
  );

  strategy.risk.maxDailyStopLoss = pickNumber(
    text,
    [/累计.*?(\d+)\s*次.*止损/, /(\d+)\s*次.*止损.*停止/, /最多.*?(\d+)\s*次/],
    strategy.risk.maxDailyStopLoss
  );

  strategy.risk.reduceRiskAfterLosses = pickNumber(
    text,
    [/连续\s*(\d+)\s*次.*(?:亏损|止损)/],
    strategy.risk.reduceRiskAfterLosses
  );

  strategy.risk.reducedRiskPct = pickNumber(
    text,
    [/降至\s*(\d+(?:\.\d+)?)\s*%/, /降为\s*(\d+(?:\.\d+)?)\s*%/, /(\d+(?:\.\d+)?)\s*%.*(?:每笔|单笔)/],
    strategy.risk.reducedRiskPct
  );

  strategy.risk.takeProfitPct = pickNumber(
    text,
    [/(\d+(?:\.\d+)?)\s*%\s*止盈/, /止盈\s*(\d+(?:\.\d+)?)\s*%/, /take.?profit\s*(\d+)/i],
    strategy.type === "breakout_trend" ? strategy.risk.takeProfitPct : strategy.risk?.takeProfitPct ?? DEFAULTS.takeProfitPct
  );

  strategy.risk.stopLossPct = pickNumber(
    text,
    [/(\d+(?:\.\d+)?)\s*%\s*止损/, /止损\s*(\d+(?:\.\d+)?)\s*%/, /stop.?loss\s*(\d+)/i],
    strategy.type === "breakout_trend" ? strategy.risk.stopLossPct : strategy.risk?.stopLossPct ?? DEFAULTS.stopLossPct
  );

  strategy.risk.maxDrawdownPct = pickNumber(
    text,
    [/回撤(?:超过|大于|>|超过)?\s*(\d+(?:\.\d+)?)\s*%/, /max.?drawdown\s*(\d+)/i],
    strategy.risk?.maxDrawdownPct ?? DEFAULTS.maxDrawdownPct
  );

  strategy.conditions.trendMaPeriod = pickNumber(
    text,
    [/(\d+)\s*(?:MA|ma|均线)(?!\s*均量)/, /(?:MA|ma)\s*(\d+)/],
    strategy.conditions.trendMaPeriod
  );

  strategy.conditions.breakoutLookback = pickNumber(
    text,
    [/(\d+)\s*(?:根|K|k)\s*线/, /近\s*(\d+)\s*根/, /(\d+)K(?:线)?(?:高|低)/i],
    strategy.conditions.breakoutLookback
  );

  strategy.conditions.volumeMaPeriod = pickNumber(
    text,
    [/(\d+)\s*日(?:平均)?(?:成交)?量/, /VolMA\s*(\d+)/i],
    strategy.conditions.volumeMaPeriod
  );

  strategy.conditions.maPeriod = pickNumber(
    text,
    [/(\d+)\s*日(?:均)?线/, /ma\s*(\d+)/i],
    strategy.conditions?.maPeriod ?? DEFAULTS.maPeriod
  );

  if (strategy.type === "breakout_trend") {
    // 避免「2:1盈亏比」等误写入 maPeriod
    strategy.conditions.maPeriod = strategy.conditions.breakoutLookback;
  }

  strategy.conditions.volumeMultiplier = pickNumber(
    text,
    [
      /(?:成交量|量能).*?[>＞]\s*(\d+(?:\.\d+)?)\s*(?:倍|[xX])/,
      /(\d+(?:\.\d+)?)\s*(?:倍|[xX]).*?(?:均量|平均)/,
      /成交量(?:放大|增加)?\s*(\d+(?:\.\d+)?)\s*倍/,
      /volume\s*(\d+(?:\.\d+)?)x/i,
    ],
    strategy.conditions?.volumeMultiplier ?? DEFAULTS.volumeMultiplier
  );

  strategy.conditions.breakoutAboveMa = /突破.*均线|above.*ma|breakout/i.test(text)
    ? true
    : strategy.conditions?.breakoutAboveMa ?? true;

  if (strategy.type === "breakout_trend") {
    strategy.conditions.bidirectional = /做空|开空|多空|双向/.test(text);
    strategy.category = resolveStrategyCategory(text, strategy.category);
    const tf = pickTimeframe(text);
    if (tf) strategy.candleGranularity = tf;
    strategy.candleLimit = Math.max(
      strategy.candleLimit || 0,
      (strategy.conditions.trendMaPeriod || 200) + 50
    );
    if (!riskPct && strategy.risk.riskPerTradePct) {
      strategy.positionPct = strategy.risk.riskPerTradePct;
    }
  }

  if (/SAR/i.test(text) && /MACD/i.test(text) && strategy.type !== "breakout_trend") {
    strategy.type = "sar_macd";
    strategy.candleGranularity = strategy.candleGranularity || "1h";
    strategy.candleLimit = Math.max(strategy.candleLimit || 0, 120);
    strategy.conditions.sarStep = 0.02;
    strategy.conditions.sarMax = 0.2;
    strategy.conditions.recentHighLookback = pickNumber(
      text,
      [/近期(?:高|高点).*?(\d+)/, /(\d+)\s*根.*高/],
      20
    );
    strategy.conditions.takeProfitPartialPct = pickNumber(
      text,
      [/平仓\s*(\d+(?:\.\d+)?)\s*%/, /止盈.*?(\d+(?:\.\d+)?)\s*%/],
      strategy.conditions.takeProfitPartialPct ?? 50
    );
    strategy.positionPct = pickNumber(
      text,
      [/不超过.*?(\d+(?:\.\d+)?)\s*%/, /单(?:笔|次)仓位.*?(\d+(?:\.\d+)?)\s*%/, /仓位.*?(\d+(?:\.\d+)?)\s*%/],
      strategy.positionPct > 50 ? 10 : strategy.positionPct
    );
  }

  if (/网格/i.test(text)) {
    strategy.conditions.gridSpacingPct = pickNumber(
      text,
      [/网格(?:间距)?\s*(\d+(?:\.\d+)?)\s*%/],
      strategy.conditions?.gridSpacingPct ?? DEFAULTS.gridSpacingPct
    );
    strategy.conditions.gridLevels = pickNumber(
      text,
      [/(\d+)\s*层/, /网格层数\s*(\d+)/],
      strategy.conditions?.gridLevels ?? 5
    );
  }

  if (/套利/i.test(text)) {
    strategy.conditions.arbitrageSpreadPct = pickNumber(
      text,
      [/价差\s*(\d+(?:\.\d+)?)\s*%/, /spread\s*(\d+(?:\.\d+)?)/i],
      strategy.conditions?.arbitrageSpreadPct ?? DEFAULTS.arbitrageSpreadPct
    );
  }

  if (/关闭感知|不用感知|禁用\s*skill/i.test(text)) {
    strategy.usePerception = false;
  } else if (/开启感知|启用感知|感知\s*skill/i.test(text)) {
    strategy.usePerception = true;
  }

  ensureStrategyLeverage(strategy, text);

  strategy.name = buildStrategyName(strategy);
  strategy.summary = buildSummary(strategy);
  strategy.paramRows = buildParamRows(strategy, text);
  strategy.confidence = text.length > 20 ? 0.92 : 0.78;
  return strategy;
}

/** 异步解析：规则 + DeepSeek Flash（Lite） */
export async function parseIntentAsync(nlText, previousStrategy = null) {
  const ruleStrategy = parseIntent(nlText, previousStrategy);

  let strategy = ruleStrategy;
  const levTweak = isStrategyLeverageTweak(nlText, previousStrategy);
  const explicitLev = parseLeverageFromText(nlText, null);

  if (nlText?.trim().length >= 12 && !levTweak) {
    try {
      const { invokeDeepseekStrategyParse } = await import("./deepseekStrategy.js");
      const llm = await invokeDeepseekStrategyParse(nlText, previousStrategy || ruleStrategy);
      if (llm?.strategy) {
        strategy = {
          ...ruleStrategy,
          ...llm.strategy,
          conditions: { ...ruleStrategy.conditions, ...llm.strategy.conditions },
          risk: { ...ruleStrategy.risk, ...llm.strategy.risk },
          leverage: explicitLev ?? llm.strategy.leverage ?? ruleStrategy.leverage,
          category: explicitLev != null ? "futures" : llm.strategy.category ?? ruleStrategy.category,
          rawInstruction: nlText.trim(),
          deepseekParsed: true,
          deepseekModel: llm.model,
        };
        ensureStrategyLeverage(strategy, nlText);
      }
    } catch (e) {
      console.warn("[parseIntentAsync] DeepSeek Lite 解析失败，使用规则:", e.message);
    }
  } else if (levTweak && previousStrategy) {
    strategy = {
      ...previousStrategy,
      ...ruleStrategy,
      id: previousStrategy.id,
      type: previousStrategy.type,
      symbol: previousStrategy.symbol,
      conditions: { ...previousStrategy.conditions, ...ruleStrategy.conditions },
      risk: { ...previousStrategy.risk, ...ruleStrategy.risk },
      rawInstruction: [previousStrategy.rawInstruction, nlText.trim()].filter(Boolean).join("\n"),
      leverageTweak: true,
    };
    ensureStrategyLeverage(strategy, nlText);
  }

  const mentioned = await extractMentionedSymbolAsync(nlText);

  if (mentioned) {
    strategy.symbol = mentioned;
  }

  try {
    const list = await getCachedSpotSymbols();
    if (list.length && !list.includes(strategy.symbol)) {
      strategy.symbolValid = false;
      strategy.symbolNote = `${strategy.symbol} 未在 Bitget 在线列表中，请检查拼写`;
    } else {
      strategy.symbolValid = true;
    }
  } catch {
    strategy.symbolValid = true;
  }

  strategy.name = buildStrategyName(strategy);
  strategy.summary = buildSummary(strategy);
  strategy.paramRows = buildParamRows(strategy, nlText);
  ensureStrategyLeverage(strategy, nlText);
  return strategy;
}

export function getPresetStrategies() {
  const presets = [
    {
      id: "preset_sar_macd_btc",
      name: "SAR+MACD · BTC",
      type: "sar_macd",
      symbol: "BTCUSDT",
      category: "futures",
      leverage: 5,
      marginMode: "crossed",
      positionPct: 10,
      rawInstruction:
        "SAR+MACD双信号：SAR之上且MACD多头且量能MA5>MA10开多，止损跌破SAR，近高止盈平仓50%，单笔仓位不超过10%",
      conditions: {
        sarStep: 0.02,
        sarMax: 0.2,
        recentHighLookback: 20,
        takeProfitPartialPct: 50,
      },
      risk: { takeProfitPct: 3, stopLossPct: 2, maxDrawdownPct: 5 },
    },
    {
      id: "preset_trend_btc",
      name: "趋势 · BTC",
      type: "trend",
      symbol: "BTCUSDT",
      category: "futures",
      leverage: 5,
      positionPct: 50,
      rawInstruction:
        "当BTC突破20日均线且成交量放大1.5倍时，买入50%仓位，设置3%止盈和2%止损，回撤超过5%时暂停交易",
      conditions: { maPeriod: 20, volumeMultiplier: 1.5, breakoutAboveMa: true },
      risk: { takeProfitPct: 3, stopLossPct: 2, maxDrawdownPct: 5 },
    },
    {
      id: "preset_grid_eth",
      name: "网格 · ETH",
      type: "grid",
      symbol: "ETHUSDT",
      category: "futures",
      leverage: 3,
      positionPct: 30,
      rawInstruction: "ETH在1.2%网格间距内低买高卖，总仓位30%，止损2%",
      conditions: { gridSpacingPct: 1.2, gridLevels: 5 },
      risk: { takeProfitPct: 1.2, stopLossPct: 2, maxDrawdownPct: 8 },
    },
    {
      id: "preset_trend_sol",
      name: "趋势 · SOL",
      type: "trend",
      symbol: "SOLUSDT",
      category: "futures",
      leverage: 5,
      positionPct: 40,
      rawInstruction: "SOL突破20日均线且成交量放大1.5倍时买入40%仓位，止盈4%止损2%",
      conditions: { maPeriod: 20, volumeMultiplier: 1.5, breakoutAboveMa: true },
      risk: { takeProfitPct: 4, stopLossPct: 2, maxDrawdownPct: 6 },
    },
    {
      id: "preset_grid_doge",
      name: "网格 · DOGE",
      type: "grid",
      symbol: "DOGEUSDT",
      category: "futures",
      leverage: 3,
      positionPct: 25,
      rawInstruction: "DOGE网格间距2%，总仓位25%，止损3%",
      conditions: { gridSpacingPct: 2, gridLevels: 6 },
      risk: { takeProfitPct: 1.5, stopLossPct: 3, maxDrawdownPct: 10 },
    },
    {
      id: "preset_arbitrage_btc",
      name: "套利 · BTC",
      type: "arbitrage",
      symbol: "BTCUSDT",
      category: "futures",
      leverage: 2,
      positionPct: 40,
      rawInstruction: "当BTC现货与模拟永续价差超过0.3%时套利，仓位40%，止盈0.25%止损0.15%",
      conditions: { arbitrageSpreadPct: 0.3 },
      risk: { takeProfitPct: 0.25, stopLossPct: 0.15, maxDrawdownPct: 3 },
    },
  ];

  return presets.map((p) => ({
    ...p,
    usePerception: p.usePerception ?? true,
    summary: buildSummary(p),
    paramRows: buildParamRows(p, p.rawInstruction || ""),
    updatedAt: new Date().toISOString(),
  }));
}

/** 将当前策略模板应用到任意交易对 */
export function cloneStrategyForSymbol(template, symbol) {
  const sym = String(symbol || template.symbol).toUpperCase();
  const next = {
    ...template,
    id: `strat_${Date.now()}`,
    symbol: sym,
    updatedAt: new Date().toISOString(),
  };
  next.name = buildStrategyName(next);
  next.summary = buildSummary(next);
  next.paramRows = buildParamRows(next, next.rawInstruction || "");
  return next;
}
