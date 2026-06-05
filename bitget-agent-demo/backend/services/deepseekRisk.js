/**
 * 风控层 — DeepSeek V4-Pro
 */
import { deepseekChatPremium, getDeepseekPremiumModel, parseJsonContent } from "./deepseekClient.js";

export async function invokeDeepseekRisk(ctx) {
  const model = getDeepseekPremiumModel();
  const { symbol, strategy, decision, ruleRisk, accountState, perception } = ctx;

  const payload = {
    task: "crypto_risk_control",
    symbol,
    decision: { action: decision?.action, reason: decision?.reason },
    strategy: {
      type: strategy?.type,
      positionPct: strategy?.positionPct,
      maxDrawdownPct: strategy?.risk?.maxDrawdownPct,
      stopLossPct: strategy?.risk?.stopLossPct,
      takeProfitPct: strategy?.risk?.takeProfitPct,
    },
    ruleBaseline: {
      ok: ruleRisk?.ok,
      reason: ruleRisk?.reason,
      pause: ruleRisk?.pause,
      drawdownPct: ruleRisk?.drawdownPct,
      checks: ruleRisk?.checks,
    },
    account: {
      equity: accountState?.equity,
      usdtAvailable: accountState?.usdtAvailable,
      baseAvailable: accountState?.baseAvailable,
      lastPrice: accountState?.lastPrice,
      hasBase: accountState?.hasBase,
    },
    perception: {
      bias: perception?.composite?.bias,
      score: perception?.composite?.score,
      summary: perception?.deepseekPerception?.summary,
      riskNote: perception?.deepseekPerception?.riskNote,
    },
    outputFormat: {
      approve: "boolean — 是否允许执行当前 decision",
      pause: "boolean — 是否暂停新开仓",
      reason: "中文 60字内风控结论",
      confidence: "0-1",
    },
    constraints: [
      "规则层已触发硬拦截(回撤/暂停/余额不足)时必须 approve=false",
      "仅输出 JSON",
      "模拟盘场景",
    ],
  };

  // 重试逻辑：空内容时重试一次
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const chat = await deepseekChatPremium({
        model,
        system:
          "你是加密货币模拟盘风控引擎。在规则检查结果基础上做最终风控裁决。必须严格返回 JSON。",
        user: JSON.stringify(payload, null, 2),
        temperature: 0.1,
        json: true,
      });

      if (!chat.content || chat.content.trim().length < 10) {
        lastError = new Error("DeepSeek 返回内容为空");
        if (attempt < 2) {
          console.warn(`[deepseekRisk] 第${attempt}次返回内容为空，重试...`);
          continue;
        }
        throw lastError;
      }

      const parsed = parseJsonContent(chat.content);
      return {
        approve: parsed.approve !== false,
        pause: !!parsed.pause,
        reason: String(parsed.reason || "智能风控通过").slice(0, 120),
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.6)),
        model: chat.model,
        source: "deepseek/risk",
        calledAt: chat.calledAt,
      };
    } catch (e) {
      lastError = e;
      if (attempt < 2 && e.message.includes("内容为空")) {
        console.warn(`[deepseekRisk] 第${attempt}次失败（${e.message}），重试...`);
        continue;
      }
      throw e;
    }
  }
  throw lastError || new Error("DeepSeek 风控失败");
}
