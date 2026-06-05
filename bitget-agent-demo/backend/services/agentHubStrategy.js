/**
 * Agent Hub 策略 — 识别 / 自主生成 / 执行
 */
import {
  parseIntentAsync,
  buildParamRows,
  buildStrategyName,
  buildSummary,
  ensureStrategyLeverage,
} from "./intentParser.js";
import { gatherPerception } from "./perceptionSkills.js";
import { evaluateBreakoutTrend } from "./breakoutTrendStrategy.js";
import { evaluateSarMacd } from "./sarMacdStrategy.js";
import { evaluateEmaPullback } from "./emaPullbackStrategy.js";
import { getCandles } from "./bitgetClient.js";
import {
  getAgentHubCapabilities,
  callAgentHubTool,
  hubGetCandles,
  isAgentHubReady,
} from "./agentHubBridge.js";
import { getOfficialSkillRegistry } from "./hubSkillProvider.js";
import { isSimApiConfigured, runSimTick, resolveCandleParams } from "./simulationApi.js";
import { invokeDeepseekAutonomousStrategy } from "./deepseekAutonomousStrategy.js";
import { getCachedSpotSymbols } from "./symbolUtils.js";

export { getAgentHubCapabilities };

export async function runStrategyCheck(strategy) {
  let strategyCheck = null;
  try {
    const { granularity: gran, limit, category } = resolveCandleParams(strategy);
    let candles = null;
    if (isAgentHubReady()) {
      try {
        candles = await hubGetCandles(strategy.symbol, { granularity: gran, limit, category });
      } catch { /* fallback */ }
    }
    if (!candles?.length) {
      candles = await getCandles(strategy.symbol, gran, limit, category);
    }
    if (candles?.length) {
      if (strategy.type === "breakout_trend") {
        strategyCheck = evaluateBreakoutTrend(candles, strategy.conditions);
      } else if (strategy.type === "sar_macd") {
        strategyCheck = evaluateSarMacd(candles, strategy.conditions);
      } else if (strategy.type === "ema_pullback") {
        strategyCheck = evaluateEmaPullback(candles, strategy.conditions);
      }
    }
  } catch { /* ignore */ }
  return strategyCheck;
}

async function finalizeStrategyRecord(strategy, sourceText = "") {
  const next = {
    ...strategy,
    id: strategy.id || `strat_auto_${Date.now()}`,
    updatedAt: new Date().toISOString(),
    rawInstruction: sourceText || strategy.rawInstruction || strategy.summary,
  };
  next.name = buildStrategyName(next);
  next.summary = buildSummary(next);
  next.paramRows = buildParamRows(next, next.rawInstruction);

  try {
    const list = await getCachedSpotSymbols();
    if (list.length && !list.includes(next.symbol)) {
      next.symbolValid = false;
      next.symbolNote = `${next.symbol} 未在 Bitget 在线列表中`;
    } else {
      next.symbolValid = true;
    }
  } catch {
    next.symbolValid = true;
  }
  return ensureStrategyLeverage(next, next.rawInstruction);
}

/** 1. 策略识别 — NL → 结构化策略 */
export async function recognizeStrategy(text, previousStrategy = null) {
  const strategy = await parseIntentAsync(text, previousStrategy);
  let strategyCheck = null;
  let perception = null;

  if (strategy.usePerception !== false) {
    try {
      perception = await gatherPerception(strategy.symbol, { force: true });
    } catch { /* ignore */ }
  }

  strategyCheck = await runStrategyCheck(strategy);

  return {
    layer: "recognize",
    source: "intentParser + skill-hub",
    strategy,
    strategyCheck,
    perception,
    hub: { ...getAgentHubCapabilities(), officialSkills: getOfficialSkillRegistry() },
  };
}

/** 2. 自主策略生成 — 感知 → AI 思考 → 策略 */
export async function generateAutonomousStrategy({
  symbol = "BTCUSDT",
  hint = "",
  previousStrategy = null,
  cachedPerception = null,
} = {}) {
  const sym = String(symbol || previousStrategy?.symbol || "BTCUSDT").toUpperCase();

  let perception = cachedPerception;
  if (!perception) {
    try {
      perception = await gatherPerception(sym, { force: true });
    } catch (e) {
      throw new Error(`感知数据不可用：${e.message}`);
    }
  }

  const llm = await invokeDeepseekAutonomousStrategy({
    symbol: sym,
    perception,
    hint,
    previousStrategy,
  });

  // Build all candidate checks
  const candidateChecks = (llm.candidates || []).map(async (c) => {
    if (!c) return null;
    try {
      return { ...await runStrategyCheck(c), strategy: c };
    } catch {
      return { summary: "校验失败", entryReady: false, strategy: c };
    }
  });
  const resolvedCandidates = (await Promise.all(candidateChecks)).filter(Boolean);

  // Use primary candidate as main strategy
  const primaryIdx = llm.primaryCandidate ? resolvedCandidates.findIndex(rc => rc?.strategy === llm.primaryCandidate) : -1;
  const primaryStrategy = llm.primaryCandidate || llm.strategy;
  
  let strategy = await finalizeStrategyRecord(
    {
      ...primaryStrategy,
      symbol: primaryStrategy.symbol || sym,
      generatedBy: "autonomous",
      autonomousThought: llm.reasoning,
      autonomousMarketView: llm.marketView,
      autonomousConfidence: llm.confidence,
    },
    llm.reasoning
  );

  const strategyCheck = await runStrategyCheck(strategy);

  return {
    layer: "autonomous-generate",
    source: "perception + autonomous-ai",
    strategy,
    strategyCheck,
    perception,
    autonomousThought: llm.reasoning,
    marketView: llm.marketView,
    confidence: llm.confidence,
    candidates: resolvedCandidates.map((rc, idx) => ({
      index: idx,
      name: rc.strategy?.name || `候选策略 ${idx + 1}`,
      type: rc.strategy?.type || "unknown",
      symbol: rc.strategy?.symbol || sym,
      summary: rc.strategy?.summary || "",
      conditions: rc.strategy?.conditions,
      risk: rc.strategy?.risk,
      check: rc.check || { ready: false, summary: "未计算" },
      isPrimary: idx === primaryIdx,
    })),
    primaryIndex: primaryIdx >= 0 ? primaryIdx : 0,
    hub: { ...getAgentHubCapabilities(), officialSkills: getOfficialSkillRegistry() },
  };
}

/** 3. 策略执行 — 单次决策 */
export async function executeStrategyOnce(strategy, options = {}) {
  if (!isSimApiConfigured()) {
    throw new Error("请先连接 Bitget 模拟 API");
  }
  const tick = await runSimTick(strategy, {
    mode: options.mode || "agent",
    session: options.session || {},
  });

  return {
    layer: "execute",
    source: "runSimTick + bitget-api",
    tick,
    hubExecution: tick.order?.source === "bitget-api" ? tick.order : null,
  };
}

/** 4. 自主策略 tick — 完整 Agent 链路一轮 */
export async function runAutonomousStrategyTick(strategy, session = {}, options = {}) {
  if (!isSimApiConfigured()) {
    throw new Error("请先连接 Bitget 模拟 API");
  }

  const result = await runSimTick(strategy, {
    mode: "agent",
    session,
    cachedPerception: options.cachedPerception || null,
  });

  return {
    layer: "autonomous",
    source: "tradingAgent + bitget-api",
    strategy: { id: strategy.id, name: strategy.name, type: strategy.type, symbol: strategy.symbol },
    tick: result,
    agent: result.agent,
    decision: result.decision,
    executed: result.executed,
    order: result.order,
    risk: result.risk,
    hub: getAgentHubCapabilities(),
    timestamp: result.ts,
  };
}

export async function queryHubMarket(symbol) {
  const sym = symbol || "BTCUSDT";
  try {
    const spot = await callAgentHubTool("spot_get_ticker", { symbol: sym });
    return { symbol: sym, spot };
  } catch (e) {
    return { symbol: sym, error: e.message };
  }
}
