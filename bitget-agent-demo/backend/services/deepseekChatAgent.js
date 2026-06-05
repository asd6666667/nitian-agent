/**
 * 聊天层 — DeepSeek V4-Flash 理解意图与自然回复
 */
import {
  deepseekChatLite,
  getDeepseekLiteModel,
  isDeepseekConfigured,
  parseJsonContent,
} from "./deepseekClient.js";

const VALID_ACTIONS = new Set([
  "reply",
  "strategy",
  "autonomous_strategy",
  "scan",
  "help",
  "account",
  "market",
]);

export function isGreetingMessage(text) {
  const t = String(text || "").trim();
  return /^(你好|您好|hi|hello|hey|在吗|早上好|晚上好|嗨|哈喽|谢谢|感谢)[!.？?~\s]*$/i.test(t);
}

/** DeepSeek 路由：闲聊 vs 策略/扫描等 */
export async function routeChatMessage(text, ctx = {}) {
  if (!isDeepseekConfigured()) {
    return { action: "reply", content: fallbackReply(text, ctx) };
  }

  const model = getDeepseekLiteModel();
  const payload = {
    message: text,
    hasStrategy: !!ctx.previousStrategy,
    strategySymbol: ctx.previousStrategy?.symbol,
    simConnected: !!ctx.simConnected,
    allowedActions: ["reply", "strategy", "autonomous_strategy", "scan", "help"],
    rules: [
      "reply: 问候、闲聊、感谢、问 Agent 能做什么（简短介绍）",
      "strategy: 用户明确描述交易规则/仓位/止盈止损/突破/grid 等（含具体参数的长文）",
      "strategy: 用户调整当前策略杠杆，如「改成10倍」「杠杆调到3x」「倍数改为20」",
      "autonomous_strategy: 用户要求想/设计/生成/推荐策略，如「想一个BTC策略」「生成BTC策略」「帮我设计快速执行的策略」",
      "scan: 用户要看某币扫描/信号/感知",
      "help: 用户问帮助/功能/指令列表",
      "仅输出 JSON: { action, reply }",
      "reply 用中文，80字内，友好专业",
    ],
  };

  try {
    const chat = await deepseekChatLite({
      model,
      system:
        "你是逆天 Agent 的对话路由助手。判断用户意图并给出 reply 文本。不要假装已下单。模拟盘场景。",
      user: JSON.stringify(payload, null, 2),
      temperature: 0.25,
      json: true,
    });
    const parsed = parseJsonContent(chat.content);
    const action = VALID_ACTIONS.has(parsed.action) ? parsed.action : "reply";
    return {
      action,
      content: String(parsed.reply || parsed.content || "").slice(0, 400),
      model: chat.model,
      source: "deepseek/chat-route",
    };
  } catch (e) {
    return { action: "reply", content: fallbackReply(text, ctx), error: e.message };
  }
}

/** 聊天层入口：问候走本地模板，其余走 DeepSeek Flash 路由 */
export async function handleChatLayer(text, ctx = {}) {
  if (isGreetingMessage(text)) {
    return { action: "reply", content: greetingReply(ctx), source: "local/greeting" };
  }
  if (!isDeepseekConfigured()) {
    return { action: "reply", content: fallbackReply(text, ctx), source: "local/fallback" };
  }
  const routed = await routeChatMessage(text, ctx);
  const action = routed.action === "reply" ? "reply" : routed.action;
  return {
    action,
    content: routed.content || fallbackReply(text, ctx),
    model: routed.model,
    source: routed.source,
    error: routed.error,
  };
}

export async function generateChatReply(text, ctx = {}) {
  const layer = await handleChatLayer(text, ctx);
  return layer.content;
}

function greetingReply(ctx) {
  const sym = ctx.previousStrategy?.symbol?.replace(/USDT$/i, "") || "BTC";
  const lines = [
    "你好，我是逆天 Agent 👋",
    `感知层 · 决策/风控/退出 · 三源已接入。`,
    ctx.previousStrategy
      ? `当前策略「${ctx.previousStrategy.name || sym}」。可以说「扫描 ${sym}」「启动策略」「生成 ${sym} 策略」。`
      : `可以说「扫描 ${sym}」「生成 ${sym} 策略」自主设计，或描述你的交易策略。`,
  ];
  return lines.join("\n");
}

function fallbackReply(text, ctx) {
  if (isGreetingMessage(text)) return greetingReply(ctx);
  return (
    "我是逆天 Agent，负责感知→决策→执行全流程。\n" +
    "试试：「生成 BTC 策略」「扫描 BTC」「我的资产」，或直接描述交易策略。"
  );
}
