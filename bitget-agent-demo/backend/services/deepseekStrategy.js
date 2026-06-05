/**
 * 策略解析 — DeepSeek V4-Flash（Lite）
 */
import { deepseekChatLite, getDeepseekLiteModel, isDeepseekConfigured, parseJsonContent } from "./deepseekClient.js";
import {
  ensureStrategyLeverage,
  hasExplicitLeverageInText,
  isSpotOnlyStrategy,
  parseLeverageFromText,
  resolveStrategyCategory,
} from "./intentParser.js";

const VALID_TYPES = new Set(["trend", "breakout_trend", "sar_macd", "grid", "arbitrage"]);

export function normalizeStrategy(parsed, fallback, { parsedBy = "deepseek-lite", sourceText = "" } = {}) {
  const type = VALID_TYPES.has(parsed.type) ? parsed.type : fallback?.type || "trend";
  let symbol = String(parsed.symbol || fallback?.symbol || "BTCUSDT").toUpperCase();
  if (!symbol.endsWith("USDT")) symbol = `${symbol}USDT`;

  const text = sourceText || parsed.rawInstruction || "";
  let finalCategory = "futures";
  if (parsed.category === "spot" || isSpotOnlyStrategy(text)) {
    finalCategory = "spot";
  } else if (parsed.category === "futures" || parsed.leverage) {
    finalCategory = "futures";
  } else {
    finalCategory = resolveStrategyCategory(text, fallback?.category);
  }

  const strategy = {
    ...fallback,
    type,
    symbol,
    name: String(parsed.name || fallback?.name || "自定义策略").slice(0, 80),
    summary: String(parsed.summary || fallback?.summary || "").slice(0, 200),
    positionPct: Number(parsed.positionPct ?? fallback?.positionPct ?? 50),
    usePerception: parsed.usePerception !== false,
    candleGranularity: parsed.candleGranularity || fallback?.candleGranularity || "1H",
    category: finalCategory,
    leverage:
      finalCategory === "spot"
        ? null
        : Number(
            (hasExplicitLeverageInText(text) ? parseLeverageFromText(text, null) : null) ??
              parsed.leverage ??
              fallback?.leverage ??
              5
          ),
    marginMode:
      parsed.marginMode ||
      (/逐仓|isolated/i.test(text) ? "isolated" : fallback?.marginMode || "crossed"),
    conditions: { ...(fallback?.conditions || {}), ...(parsed.conditions || {}) },
    risk: {
      ...(fallback?.risk || {}),
      takeProfitPct: Number(parsed.risk?.takeProfitPct ?? fallback?.risk?.takeProfitPct ?? 3),
      stopLossPct: Number(parsed.risk?.stopLossPct ?? fallback?.risk?.stopLossPct ?? 2),
      maxDrawdownPct: Number(parsed.risk?.maxDrawdownPct ?? fallback?.risk?.maxDrawdownPct ?? 5),
      riskPerTradePct: Number(parsed.risk?.riskPerTradePct ?? fallback?.risk?.riskPerTradePct ?? 1),
      rewardRiskRatio: Number(parsed.risk?.rewardRiskRatio ?? fallback?.risk?.rewardRiskRatio ?? 2),
    },
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.85)),
    parsedBy,
  };

  return ensureStrategyLeverage(strategy, text);
}

/** 自然语言 → 结构化策略（Flash） */
export async function invokeDeepseekStrategyParse(text, previousStrategy = null) {
  if (!isDeepseekConfigured()) return null;

  const model = getDeepseekLiteModel();
  const payload = {
    task: "parse_trading_strategy",
    text,
    previousStrategy: previousStrategy
      ? {
          type: previousStrategy.type,
          symbol: previousStrategy.symbol,
          positionPct: previousStrategy.positionPct,
          category: previousStrategy.category,
          leverage: previousStrategy.leverage,
        }
      : null,
    outputFormat: {
      type: "trend|breakout_trend|sar_macd|grid|arbitrage",
      symbol: "XXXUSDT",
      name: "策略名",
      summary: "中文摘要 60字内",
      category: "futures|spot — 默认 futures，仅用户明确「现货」时为 spot",
      leverage: "1-125，合约策略必填；结合波动与风险给出合理倍数",
      marginMode: "crossed|isolated",
      positionPct: "1-100",
      conditions: "object — maPeriod, volumeMultiplier, gridSpacingPct 等",
      risk: { takeProfitPct: "number", stopLossPct: "number", maxDrawdownPct: "number" },
      usePerception: "boolean",
      confidence: "0-1",
    },
    constraints: [
      "仅输出 JSON 对象",
      "默认 USDT 永续合约；用户明确「现货/不做合约」才用 spot",
      "合约策略必须输出 leverage，并说明选择依据（波动/风险）",
      "高波动小币杠杆偏低，BTC/ETH 可略高，通常 3-20x",
    ],
  };

  const chat = await deepseekChatLite({
    model,
    system:
      "你是交易策略解析器。将用户自然语言转为结构化 JSON 策略参数。默认合约交易，必须分析并给出杠杆倍数。",
    user: JSON.stringify(payload, null, 2),
    temperature: 0.15,
    json: true,
  });

  const parsed = parseJsonContent(chat.content);
  return {
    strategy: normalizeStrategy(parsed, previousStrategy, { sourceText: text }),
    model: chat.model,
    source: "deepseek/strategy-parse",
    calledAt: chat.calledAt,
  };
}
