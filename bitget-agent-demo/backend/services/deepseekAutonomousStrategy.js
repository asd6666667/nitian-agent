/**
 * 自主策略生成 — 结合感知数据，调用 DeepSeek API 完全自主设计策略
 * 不限制类型，AI 根据市场情况自由发挥
 */
import {
  deepseekChatLite,
  getDeepseekLiteModel,
  isDeepseekConfigured,
  parseJsonContent,
} from "./deepseekClient.js";
import { normalizeStrategy } from "./deepseekStrategy.js";

/** 读取最近生成的策略类型（仅记录，不作限制） */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const RECENT_TYPES_FILE = "./recentStrategyTypes.json";
const servicesDir = new URL(".", import.meta.url).pathname;
const recentTypesPath = join(servicesDir, RECENT_TYPES_FILE);

function loadRecentTypes() {
  try {
    const raw = readFileSync(recentTypesPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function recordNewType(type) {
  const types = loadRecentTypes();
  types.push(type);
  if (types.length > 10) types.shift();
  try {
    writeFileSync(recentTypesPath, JSON.stringify(types, null, 2), "utf-8");
  } catch { /* ignore */ }
}

function buildPerceptionContext(perception) {
  const composite = perception?.composite || {};
  const feed = perception?.decisionFeed || {};
  return {
    symbol: perception?.symbol,
    bias: composite.bias,
    score: composite.score,
    signals: (composite.signals || []).map((s) => s.signal),
    summary: perception?.deepseekPerception?.summary,
    riskNote: perception?.deepseekPerception?.riskNote,
    price: feed.price,
    macro: feed.macro,
    sentiment: feed.sentiment,
    technical: feed.technical,
    skillsSummary: feed.skillsSummary,
    news: (feed.news?.topHeadlines || []).slice(0, 3).map((h) => h.title),
  };
}

export async function invokeDeepseekAutonomousStrategy(ctx) {
  if (!isDeepseekConfigured()) {
    throw new Error("AI 未配置，请在 backend/.env 设置 DEEPSEEK_API_KEY");
  }

  const { symbol, perception, hint, previousStrategy } = ctx;
  const model = getDeepseekLiteModel();

  const marketCtx = buildPerceptionContext(perception);

  // 记录最近用过的类型（仅作参考，不强制 AI 避开）
  const recentTypes = loadRecentTypes();
  const recentNote = recentTypes.length > 0
    ? `近期历史策略类型：${recentTypes.join("、")}（供你参考，你可以选择相同或完全不同的类型）`
    : "";

  const payload = {
    task: "autonomous_strategy_design",
    symbol: symbol || perception?.symbol || "BTCUSDT",
    userHint: hint || null,
    previousStrategy: previousStrategy
      ? { type: previousStrategy.type, symbol: previousStrategy.symbol, summary: previousStrategy.summary }
      : null,
    marketContext: marketCtx,
    recentNote,
    outputFormat: {
      reasoning: "中文详细分析：1) 当前市场状态判断 2) 风险/机会评估 3) 为什么选这个策略思路 4) 入场/出场/风控逻辑。300字内",
      marketView: "一句话市场观点",
      strategy: {
        type: "任意策略类型（自由命名，如 momentum, mean_reversion, breakout, grid, arbitrage, scalping 等）",
        symbol: "XXXUSDT",
        name: "策略名",
        summary: "策略摘要 80字内，说明核心逻辑",
        category: "futures|spot — 默认 futures",
        leverage: "1-125，合约必填，根据波动率和风险决定",
        marginMode: "crossed|isolated",
        positionPct: "1-100，单笔仓位百分比",
        candleGranularity: "1H|4H|15m|1D",
        conditions: "入场条件（指标、均线、量能、形态等，自由设计）",
        risk: "止盈%/止损%/最大回撤%/风险控制逻辑",
        usePerception: true,
      },
      confidence: "0-1",
    },
    constraints: [
      "仅输出 JSON 对象",
      "根据当前 marketContext 的 bias、score、signals 来判断市场多空倾向",
      "如果市场偏空（bias=bearish），可以设计做空策略或观望型策略",
      "如果市场偏多（bias=bullish），可以设计做多策略",
      "如果中性（bias=neutral），可以设计网格/均值回归/套利类策略",
      "策略 type 字段自由命名，不限预设列表",
      "必须输出完整的入场、出场、风控逻辑",
      "默认 USDT 永续合约；用户明确「现货/不做合约」才用 spot",
      "合约策略必须输出 leverage，reasoning 中说明杠杆选择依据",
      "reasoning 必须展示完整的思考过程，不能只给结论",
    ],
  };

  const chat = await deepseekChatLite({
    model,
    system: `你是顶级加密货币交易策略设计师。根据实时感知数据独立思考，设计一个可执行的模拟盘策略。

你的核心能力：
- 能读懂技术指标（MACD、RSI、SAR、布林带、均线等）
- 能判断市场情绪和趋势方向
- 能根据不同市况（单边趋势/震荡/突破/反转）选择合适策略
- 能自主命名策略类型，不被预设框架限制
- 能给出合理的止盈止损和风险控制

请自由发挥，不要局限于任何预设策略模板。每次都要根据当前市场数据重新思考。`,
    user: JSON.stringify(payload, null, 2),
    temperature: 0.35,
    json: true,
  });

  const parsed = parseJsonContent(chat.content);
  const strategyPayload = parsed.strategy || parsed;
  const generatedType = strategyPayload?.type || (strategyPayload?.strategy_type) || "custom_autonomous";

  // 记录这次生成的类型
  recordNewType(generatedType);

  return {
    reasoning: String(parsed.reasoning || parsed.marketView || "").slice(0, 400),
    marketView: String(parsed.marketView || "").slice(0, 120),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.7)),
    strategy: normalizeStrategy(strategyPayload, previousStrategy, {
      parsedBy: "autonomous",
      sourceText: hint || "",
    }),
    model: chat.model,
    calledAt: chat.calledAt,
  };
}
