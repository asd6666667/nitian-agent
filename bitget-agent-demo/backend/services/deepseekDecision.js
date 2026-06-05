/**
 * 决策层 — DeepSeek V4-Pro
 * 
 * v2：LLM 根据感知数据 + 持仓上下文独立思考交易决策
 * 不再依赖规则策略信号
 */
import {
  deepseekChatPremium,
  getDeepseekPremiumModel,
  parseJsonContent,
} from "./deepseekClient.js";

const TIMEOUT_MS = Number(process.env.DEEPSEEK_TIMEOUT_MS) || 15000;

function normalizeAction(raw) {
  const a = String(raw || "hold").toLowerCase().trim();
  if (a === "buy" || a === "long" || a === "open_long" || a === "open") return "buy";
  if (a === "sell" || a === "short" || a === "close" || a === "close_long" || a === "close_short") return "sell";
  return "hold";
}

/** 构建简洁的决策 prompt — 只给必要信息 */
function buildDecisionPrompt({ symbol, strategy, perception, position, portfolio }) {
  const feed = perception?.decisionFeed || {};
  const composite = perception?.composite || {};
  const deepPercept = perception?.deepseekPerception || {};

  const lines = [];
  lines.push(`币种: ${symbol}`);
  lines.push(`价格: ${feed.price ?? "—"}`);
  lines.push(`综合倾向: ${composite.bias} (${composite.score})`);
  lines.push(`市场状态: ${deepPercept.regime || "—"}`);
  lines.push(`感知摘要: ${deepPercept.summary || "—"}`);
  lines.push(`风险提示: ${deepPercept.riskNote || "—"}`);

  const tech = feed.technical || {};
  lines.push(`技术面: 趋势=${tech.trend} RSI=${tech.rsi} MA20=${tech.ma20}`);

  const market = feed.market || {};
  lines.push(`衍生品: 24h=${market.change24h}% 费率=${market.fundingRate}% OI=${market.openInterest}`);

  const sentiment = feed.sentiment || {};
  lines.push(`情绪: 贪婪恐惧=${sentiment.fearGreed} 多空比=${sentiment.longShortRatio}`);

  const macro = feed.macro || {};
  lines.push(`宏观: 10Y=${macro.us10y}% DXY=${macro.dxy}`);

  const skills = feed.skillsSummary || {};
  const skillLines = Object.entries(skills).filter(([, v]) => v).map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`);
  if (skillLines.length) lines.push(`Skills: ${skillLines.join(" | ")}`);

  const signals = composite.signals || [];
  if (signals.length) lines.push(`信号: ${signals.slice(0, 6).map(s => s.signal || s).join(", ")}`);

  const news = feed.news?.topHeadlines || [];
  if (news.length) lines.push(`头条: ${news.slice(0, 2).map(h => typeof h === "string" ? h : h.title || "").join(" | ")}`);

  if (strategy) {
    lines.push(`策略参考: ${strategy.name || strategy.type} ${strategy.summary || ""}`);
  }

  // 持仓
  if (position?.hasPosition) {
    lines.push(`持仓: ${symbol} 入场=${position.entryPrice} 盈亏=${position.pnlPct != null ? position.pnlPct.toFixed(2) + "%" : "—"}`);
  } else {
    lines.push("持仓: 空仓");
  }

  if (portfolio) {
    lines.push(`账户: 权益=${portfolio.equity} 可用=${portfolio.available}`);
  }

  return {
    task: "trading_decision",
    symbol,
    marketData: lines.join("\n"),
  };
}

export async function invokeDeepseekDecision(ctx) {
  const { symbol, strategy, perception, position, portfolio } = ctx;
  const model = getDeepseekPremiumModel();
  const prompt = buildDecisionPrompt({ symbol, strategy, perception, position, portfolio });

  const userContent = JSON.stringify(prompt, null, 2);

  // 重试逻辑：空内容或 parse 失败时重试一次
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const chat = await deepseekChatPremium({
        model,
        system: [
          "你是激进的加密交易决策 AI。看到机会就开仓，不要犹豫。根据实时数据独立思考，输出 JSON：",
          "{",
          '  "action": "buy" | "sell" | "hold",',
          '  "reason": "中文20字内决策理由",',
          '  "autonomousThought": "中文80字内思考链",',
          '  "confidence": 0.0-1.0,',
          '  "regime": "strong_trend_up|strong_trend_down|ranging|breakout_setup|high_volatility|exhaustion|divergence|neutral"',
          "}",
          "核心原则：",
          "- 有明显机会就果断开仓，不要一直观望",
          "- 市场恐惧时是买入机会，市场贪婪时警惕回调",
          "- 已持仓且无明显反转信号则 hold",
          "- 你有本金可以亏，不敢开仓才是最大的风险",
          "- 输出 JSON，不要加其他文字",
        ].join("\n"),
        user: userContent,
        temperature: 0.3,
        json: true,
      });

      if (!chat.content || chat.content.trim().length < 10) {
        lastError = new Error("DeepSeek 返回内容为空");
        if (attempt < 2) {
          console.warn(`[deepseekDecision] 第${attempt}次返回内容为空，重试...`);
          continue;
        }
        throw lastError;
      }

      const parsed = parseJsonContent(chat.content);
      const action = normalizeAction(parsed.action);
      const regime = String(parsed.regime || "neutral").toLowerCase().replace(/[^a-z_]/g, "");

      return {
        action,
        reason: String(parsed.reason || "智能决策").slice(0, 200),
        autonomousThought: String(parsed.autonomousThought || parsed.reasoning || "").slice(0, 400),
        regimeAssessment: regime,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
        model: chat.model,
        source: "deepseek/decision/v2",
        calledAt: chat.calledAt,
      };
    } catch (e) {
      lastError = e;
      if (attempt < 2 && e.message.includes("内容为空")) {
        console.warn(`[deepseekDecision] 第${attempt}次失败（${e.message}），重试...`);
        continue;
      }
      throw e;
    }
  }
  throw lastError || new Error("DeepSeek 决策失败");
}

export { invokeDeepseekDecision as invokeQwenDecision };
