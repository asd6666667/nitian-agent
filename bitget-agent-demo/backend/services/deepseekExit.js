/**
 * 退出层 — DeepSeek V4-Pro
 */
import { deepseekChatPremium, getDeepseekPremiumModel, parseJsonContent } from "./deepseekClient.js";

function normalizeAction(raw) {
  const a = String(raw || "hold").toLowerCase();
  if (a === "sell" || a === "close" || a === "exit") return "sell";
  return "hold";
}

export async function invokeDeepseekExit(ctx) {
  const model = getDeepseekPremiumModel();
  const {
    symbol,
    strategy,
    ruleExit,
    hasBase,
    entryPrice,
    lastPrice,
    perception,
    strategySignal,
  } = ctx;

  const payload = {
    task: "crypto_exit_evaluation",
    symbol,
    position: {
      hasBase,
      entryPrice,
      lastPrice,
      pnlPct: ruleExit?.pnlPct,
    },
    strategy: {
      type: strategy?.type,
      takeProfitPct: strategy?.risk?.takeProfitPct,
      stopLossPct: strategy?.risk?.stopLossPct,
    },
    strategySignal: {
      action: strategySignal?.action,
      reason: strategySignal?.reason,
    },
    ruleBaseline: {
      triggered: ruleExit?.triggered,
      action: ruleExit?.action,
      reason: ruleExit?.reason,
      source: ruleExit?.source,
      monitoring: ruleExit?.monitoring,
    },
    perception: {
      bias: perception?.composite?.bias,
      score: perception?.composite?.score,
      summary: perception?.deepseekPerception?.summary,
      riskNote: perception?.deepseekPerception?.riskNote,
    },
    outputFormat: {
      triggered: "boolean — 是否应出场",
      action: "sell | hold",
      reason: "中文 60字内",
      source: "strategy | take_profit | stop_loss | llm_exit | monitor",
      confidence: "0-1",
    },
    constraints: [
      "空仓时 triggered=false action=hold",
      "规则已触发止盈/止损/策略卖时优先尊重，可补充 reason",
      "仅输出 JSON",
    ],
  };

  // 重试逻辑：空内容时重试一次
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const chat = await deepseekChatPremium({
        model,
        system:
          "你是加密货币模拟盘退出评估引擎。结合持仓盈亏、策略信号与感知数据决定是否平仓。必须严格返回 JSON。",
        user: JSON.stringify(payload, null, 2),
        temperature: 0.12,
        json: true,
      });

      if (!chat.content || chat.content.trim().length < 10) {
        lastError = new Error("DeepSeek 返回内容为空");
        if (attempt < 2) {
          console.warn(`[deepseekExit] 第${attempt}次返回内容为空，重试...`);
          continue;
        }
        throw lastError;
      }

      const parsed = parseJsonContent(chat.content);
      const action = normalizeAction(parsed.action);

      return {
        triggered: parsed.triggered === true || action === "sell",
        action,
        reason: String(parsed.reason || ruleExit?.reason || "智能退出评估").slice(0, 120),
        source: String(parsed.source || "llm_exit").slice(0, 32),
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.6)),
        sellPct: ruleExit?.sellPct ?? 1,
        qty: ruleExit?.qty,
        model: chat.model,
        calledAt: chat.calledAt,
      };
    } catch (e) {
      lastError = e;
      if (attempt < 2 && e.message.includes("内容为空")) {
        console.warn(`[deepseekExit] 第${attempt}次失败（${e.message}），重试...`);
        continue;
      }
      throw e;
    }
  }
  throw lastError || new Error("DeepSeek 退出评估失败");
}
