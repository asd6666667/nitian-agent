/**
 * 感知层 — DeepSeek V4-Flash
 * 融合 FRED / Finnhub / Bitget + 五 Skill，输出市场感知 + 状态分类
 */
import {
  deepseekChatLite,
  getDeepseekLiteModel,
  parseJsonContent,
} from "./deepseekClient.js";
import { recordRegime } from "./agentPerformanceMemory.js";

function clampScore(v) {
  return +Math.max(-1, Math.min(1, Number(v) || 0)).toFixed(2);
}

function normalizeBias(raw, score) {
  const b = String(raw || "").toLowerCase();
  if (b === "bullish" || b === "bearish" || b === "neutral") return b;
  if (score > 0.2) return "bullish";
  if (score < -0.2) return "bearish";
  return "neutral";
}

const REGIME_VALUES = new Set([
  "strong_trend_up", "strong_trend_down", "ranging",
  "breakout_setup", "high_volatility", "low_volatility",
  "exhaustion", "divergence", "neutral",
]);

function normalizeRegime(raw) {
  const r = String(raw || "").toLowerCase().replace(/[^a-z_]/g, "");
  if (REGIME_VALUES.has(r)) return r;
  return "neutral";
}

export async function invokeDeepseekPerception(ctx) {
  const { symbol, cleaned, skills, ruleComposite, ruleSignals } = ctx;
  const model = getDeepseekLiteModel();

  const skillsSummary = {
    technical: skills?.technicalAnalysis?.summary?.slice(0, 100),
    sentiment: skills?.sentimentAnalyst?.summary?.slice(0, 100),
    marketIntel: skills?.marketIntel?.summary?.slice(0, 100),
    news: skills?.newsBriefing?.summary?.slice(0, 100),
    macro: skills?.macroAnalyst?.summary?.slice(0, 100),
  };

  const payload = {
    symbol,
    price: cleaned?.price,
    macro: {
      us10y: cleaned?.fred?.us10yYield,
      dxy: cleaned?.fred?.dxy,
    },
    market: {
      change24h: cleaned?.bitget?.ticker?.change24h,
      fundingRate: cleaned?.bitget?.fundingRate,
    },
    skills: skillsSummary,
    ruleBias: ruleComposite?.bias,
    ruleScore: ruleComposite?.score,
  };

  // 重试逻辑：空内容时重试一次
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const chat = await deepseekChatLite({
        model,
        system: [
          "你是加密货币市场感知引擎。根据数据输出 JSON：",
          "{",
          '  "bias": "bullish|bearish|neutral",',
          '  "score": -1.0 到 1.0,',
          '  "summary": "中文60字摘要",',
          '  "riskNote": "中文20字风险",',
          '  "regime": "市场状态: strong_trend_up|strong_trend_down|ranging|breakout_setup|high_volatility|exhaustion|divergence|neutral"',
          "}",
          "只返回 JSON 对象。",
        ].join("\n"),
        user: JSON.stringify(payload, null, 2),
        temperature: 0.15,
        json: true,
      });

      if (!chat.content || chat.content.trim().length < 10) {
        lastError = new Error("DeepSeek 返回内容为空");
        if (attempt < 2) {
          console.warn(`[deepseekPerception] 第${attempt}次返回内容为空，重试...`);
          continue;
        }
        throw lastError;
      }

      const parsed = parseJsonContent(chat.content);
      const score = clampScore(parsed.score ?? ruleComposite?.score ?? 0);
      const bias = normalizeBias(parsed.bias, score);
      const regime = normalizeRegime(parsed.regime);

      if (symbol && regime !== "neutral") {
        recordRegime(symbol, regime);
      }

      return {
        bias,
        score,
        summary: String(parsed.summary || "感知完成").slice(0, 200),
        riskNote: String(parsed.riskNote || "").slice(0, 120),
        keySignals: [],
        regime,
        model: chat.model,
        source: "deepseek/perception",
        calledAt: chat.calledAt,
        llmSignals: [],
      };
    } catch (e) {
      lastError = e;
      if (attempt < 2 && e.message.includes("内容为空")) {
        console.warn(`[deepseekPerception] 第${attempt}次失败（${e.message}），重试...`);
        continue;
      }
      throw e;
    }
  }
  throw lastError || new Error("DeepSeek 感知失败");
}
