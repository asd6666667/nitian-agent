/**
 * 逆天 Agent v2 — 感知 → 独立思考 → 决策 → 风控 → 执行 → 退出
 * 
 * 【改造要点】
 * - LLM 不再依赖规则策略信号，独立做出每 tick 决策
 * - strategySignal 现在是可选参考，不再主导
 * - 新增 fuseIndependentDecision() — 完全独立的决策路径
 * - 保留 fuseAgentDecision() 向后兼容
 */
import { gatherPerception } from "./perceptionSkills.js";
import { applyPerceptionGate, formatPerceptionLog } from "./perceptionGate.js";
import { checkStrategyRisk } from "./strategyExecution.js";
import { isAgentHubReady } from "./agentHubBridge.js";
import { isDeepseekConfigured } from "./deepseekClient.js";
import { invokeDeepseekDecision } from "./deepseekDecision.js";
import { invokeDeepseekRisk } from "./deepseekRisk.js";
import { invokeDeepseekExit } from "./deepseekExit.js";
import { recordRegime } from "./agentPerformanceMemory.js";

const BIAS_ZH = { bullish: "偏多", bearish: "偏空", neutral: "中性" };

/** 信任 LLM 判断，不设门槛 */
export const CONFIDENCE_OPEN_MIN = 0;

/** 从策略 evaluation.checks 计算条件满足情况 */
export function conditionPassRateFromSignal(strategySignal) {
  const checks = strategySignal?.evaluation?.checks || [];
  if (!checks.length) return null;
  const passed = checks.filter((c) => c.pass).length;
  return {
    rate: passed / checks.length,
    passed,
    total: checks.length,
    allPass: passed === checks.length,
  };
}

/**
 * 决策置信度
 */
export function resolveDecisionConfidence(llmConfidence, strategySignal, perception) {
  const raw = Math.max(0, Math.min(1, Number(llmConfidence) || 0));
  const cond = conditionPassRateFromSignal(strategySignal);
  const score = Math.abs(Number(perception?.composite?.score ?? 0));

  if (!cond) {
    // 无规则信号时，直接使用 LLM 的置信度
    const display = raw;
    const policy = raw;
    return {
      display,
      policy,
      llmRaw: raw,
      passRate: null,
      checksPassed: null,
      checksTotal: null,
      allPass: false,
    };
  }

  const { rate, passed, total, allPass } = cond;
  const fromChecks = 0.25 + rate * 0.7;
  const fromScore = Math.min(0.9, 0.3 + score * 0.55);
  const structural = fromChecks * 0.82 + fromScore * 0.18;

  let display = raw;
  if (raw <= 0.35) {
    display = structural * 0.72 + raw * 0.28;
  } else {
    display = raw * 0.5 + structural * 0.5;
  }
  display = Math.max(0.2, Math.min(0.95, display));

  let policy = raw;
  if (!allPass) {
    policy = Math.min(policy, CONFIDENCE_OPEN_MIN - 0.001);
  }

  return {
    display,
    policy,
    llmRaw: raw,
    passRate: rate,
    checksPassed: passed,
    checksTotal: total,
    allPass,
  };
}

/**
 * 置信度开单策略 — 信任 LLM，不做拦截
 */
export function applyConfidenceOpenPolicy({
  action,
  confidence,
  strategySignal,
  ruleAction,
  strategyHasPosition = false,
  walletHasAsset = false,
}) {
  const next = action;

  if (next === "buy") {
    if (strategyHasPosition) {
      return { action: "hold", overridden: true, note: "已持仓不重复开单" };
    }
    return { action: "buy", overridden: false, note: null };
  }

  if (next === "sell") {
    return { action: "sell", overridden: false, note: null };
  }

  return { action: next, overridden: false, note: null };
}

/** 规则层：策略信号 + 感知门禁（保留向后兼容，仅当 strategySignal 存在时使用） */
function fuseRuleDecision(strategySignal, perception, strategy) {
  if (!strategySignal) {
    return {
      decision: { action: "hold", reason: "自主决策模式 · 无规则策略信号" },
      perceptionSummary: null,
      agentReason: "独立决策模式",
      hubConnected: isAgentHubReady(),
    };
  }

  const usePerception = strategy?.usePerception !== false;
  const bias = perception?.composite?.bias || "neutral";
  const score = Number(perception?.composite?.score ?? 0);
  const biasLabel = BIAS_ZH[bias] || bias;
  const perceptionSummary = perception?.composite
    ? { bias, score, signalCount: perception.composite.signals?.length ?? 0 }
    : null;

  const base = {
    action: strategySignal.action,
    reason: strategySignal.reason,
    qty: strategySignal.qty,
    sellPct: strategySignal.sellPct,
    evaluation: strategySignal.evaluation,
    signal: strategySignal.signal,
  };

  if (!usePerception || !perception?.composite) {
    return {
      decision: {
        ...base,
        reason: `规则 · ${base.reason}`,
      },
      perceptionSummary,
      agentReason: "仅策略规则（感知未启用或不可用）",
      hubConnected: isAgentHubReady(),
    };
  }

  if (base.action === "buy" || base.action === "sell") {
    const gated = applyPerceptionGate(base, perception, { usePerception: true });
    const blocked = gated.decision.action === "hold" && base.action !== "hold";
    return {
      decision: {
        ...gated.decision,
        reason: blocked
          ? `规则暂缓 · ${gated.decision.reason}`
          : gated.decision.perceptionAllowed
            ? `规则 · ${gated.decision.reason}`
            : `规则${base.action === "buy" ? "开多" : "卖出"} · ${base.reason} · 感知${biasLabel}(${score})`,
        qty: base.qty,
        sellPct: base.sellPct,
        evaluation: base.evaluation,
        signal: base.signal,
      },
      perceptionSummary: gated.perceptionSummary || perceptionSummary,
      agentReason: blocked ? "感知与策略冲突" : gated.decision.perceptionAllowed ? "策略+感知放行" : "策略信号触发",
      hubConnected: isAgentHubReady(),
    };
  }

  return {
    decision: {
      action: "hold",
      reason: `${base.reason} · 感知${BIAS_ZH[bias] || bias}(${score})`,
    },
    perceptionSummary,
    agentReason: "策略条件未满足，持续感知",
    hubConnected: isAgentHubReady(),
  };
}

/**
 * 【v2 新函数】独立决策路径
 * DeepSeek Pro 完全根据感知数据 + 持仓状态独立思考
 * 不需要规则策略信号
 */
async function fuseIndependentDecision(perception, strategy, positionContext = {}) {
  const symbol = strategy?.symbol || perception?.symbol || "BTCUSDT";
  const hasPosition = !!positionContext.hasStrategyPosition || !!positionContext.hasWalletAsset;

  let llm = null;
  let deepseekError = null;

  try {
    llm = await invokeDeepseekDecision({
      symbol,
      strategy,
      perception,
      position: {
        hasPosition,
        entryPrice: positionContext.entryPrice || null,
        pnlPct: positionContext.pnlPct || null,
      },
      portfolio: {
        equity: positionContext.equity || null,
        available: positionContext.available || null,
      },
    });
  } catch (e) {
    deepseekError = e.message;
    console.warn("[fuseIndependentDecision] DeepSeek Pro 调用失败:", e.message);
  }

  if (!llm) {
    return {
      decision: {
        action: "hold",
        reason: deepseekError ? `AI不可用(${deepseekError})` : "决策失败，观望",
        evaluation: null,
      },
      perceptionSummary: perception?.composite
        ? { bias: perception.composite.bias, score: perception.composite.score, signalCount: perception.composite.signals?.length ?? 0 }
        : null,
      agentReason: deepseekError ? `AI 决策失败: ${deepseekError}` : "AI未返回有效决策",
      hubConnected: isAgentHubReady(),
      deepseekUsed: false,
      deepseekError,
    };
  }

  // 记录市场状态
  if (llm.regimeAssessment) {
    recordRegime(symbol, llm.regimeAssessment);
  }

  // 信任 LLM 决策
  const finalAction = llm.action;

  return {
    decision: {
      action: finalAction,
      reason: `${llm.reason}`,
      evaluation: null,
    },
    perceptionSummary: perception?.composite
      ? { bias: perception.composite.bias, score: perception.composite.score, signalCount: perception.composite.signals?.length ?? 0 }
      : null,
    agentReason: `${llm.reason}`,
    hubConnected: isAgentHubReady(),
    deepseekUsed: true,
    deepseekModel: llm.model,
    deepseekConfidence: llm.confidence,
    llmRawConfidence: llm.confidence,
    conditionPassRate: null,
    ruleSuggestion: "independent",
    deepseekCalledAt: llm.calledAt,
    llmReason: llm.reason,
    autonomousThought: llm.autonomousThought || null,
    regimeAssessment: llm.regimeAssessment || null,
  };
}

/**
 * 智能体决策（兼容新旧两种模式）
 * 
 * 新路径（无 strategySignal）: LLM 完全独立决策
 * 旧路径（有 strategySignal）: 规则信号 + LLM 覆盖（保留向后兼容）
 */
export async function fuseAgentDecision(strategySignal, perception, strategy, accountContext = {}) {
  const symbol = strategy?.symbol || perception?.symbol || "BTCUSDT";
  const strategyHasPosition = !!accountContext.strategyHasPosition;
  const walletHasAsset = !!accountContext.walletHasAsset;

  // ── v2 新路径：无规则策略信号，完全自主决策 ──
  if (!strategySignal) {
    return fuseIndependentDecision(perception, strategy, {
      hasStrategyPosition: strategyHasPosition,
      hasWalletAsset: walletHasAsset,
      entryPrice: accountContext.entryPrice,
      pnlPct: accountContext.pnlPct,
      equity: accountContext.equity,
      available: accountContext.usdtAvailable,
    });
  }

  // ── v1 旧路径：规则信号 + LLM 覆盖（向后兼容） ──
  const ruleFused = fuseRuleDecision(strategySignal, perception, strategy);

  let llm = null;
  let deepseekError = null;
  try {
    llm = await invokeDeepseekDecision({
      symbol,
      strategy,
      perception,
      position: {
        hasPosition: strategyHasPosition || walletHasAsset,
        entryPrice: accountContext.entryPrice || null,
        pnlPct: accountContext.pnlPct || null,
      },
      portfolio: {
        equity: accountContext.equity || null,
        available: accountContext.usdtAvailable || null,
      },
    });
  } catch (e) {
    deepseekError = e.message;
    console.warn("[fuseAgentDecision] DeepSeek Pro 调用失败:", e.message);
  }

  if (!llm) {
    return {
      ...ruleFused,
      decision: {
        ...ruleFused.decision,
        reason: deepseekError
          ? `${ruleFused.decision.reason} · AI不可用(${deepseekError})`
          : ruleFused.decision.reason,
      },
      deepseekUsed: false,
      deepseekConfigured: isDeepseekConfigured(),
      deepseekError,
      qwenUsed: false,
      qwenError: deepseekError,
    };
  }

  // 记录市场状态
  if (llm.regimeAssessment) {
    recordRegime(symbol, llm.regimeAssessment);
  }

  const ruleAction = ruleFused.decision.action;
  const confMeta = resolveDecisionConfidence(llm.confidence, strategySignal, perception);
  const policy = applyConfidenceOpenPolicy({
    action: llm.action,
    confidence: confMeta.policy,
    strategySignal,
    ruleAction,
    strategyHasPosition,
    walletHasAsset,
  });
  const action = policy.action;

  const reasonParts = [
    llm.reason,
  ];
  if (policy.note) reasonParts.push(policy.note);
  if (policy.overridden && llm.action !== action) {
    reasonParts.push(`原决策 ${llm.action} → ${action}`);
  }

  return {
    decision: {
      ...ruleFused.decision,
      action,
      reason: reasonParts.join(" · "),
      qty: ruleFused.decision.qty,
      sellPct: ruleFused.decision.sellPct,
      evaluation: ruleFused.decision.evaluation,
      signal: ruleFused.decision.signal,
    },
    perceptionSummary: ruleFused.perceptionSummary,
    agentReason: `智能决策 · ${llm.reason}${policy.note ? ` · ${policy.note}` : ""}`,
    hubConnected: ruleFused.hubConnected,
    deepseekUsed: true,
    deepseekConfigured: true,
    deepseekModel: llm.model,
    deepseekConfidence: confMeta.display,
    llmRawConfidence: confMeta.llmRaw,
    conditionPassRate: confMeta.passRate,
    conditionChecksPassed: confMeta.checksPassed,
    conditionChecksTotal: confMeta.checksTotal,
    ruleSuggestion: ruleAction,
    deepseekCalledAt: llm.calledAt,
    llmReason: llm.reason,
    autonomousThought: llm.autonomousThought || null,
    regimeAssessment: llm.regimeAssessment || null,
    qwenUsed: true,
    qwenModel: llm.model,
    qwenConfidence: confMeta.display,
  };
}

/** 退出评估（规则基准） */
function evaluateAgentExitRules({
  hasBase,
  entryPrice,
  lastPrice,
  strategy,
  strategySignal,
}) {
  const ep = Number(entryPrice || 0);
  const inPosition = !!hasBase && ep > 0;

  if (!inPosition) {
    return {
      triggered: false,
      hasPosition: false,
      monitoring: false,
      reason: "空仓，等待入场信号",
      pnlPct: null,
      source: null,
    };
  }

  const pnlPct = ep > 0 && lastPrice > 0 ? ((lastPrice - ep) / ep) * 100 : null;

  if (strategySignal?.action === "sell") {
    return {
      triggered: true,
      hasPosition: true,
      monitoring: false,
      action: "sell",
      reason: strategySignal.reason,
      sellPct: strategySignal.sellPct,
      qty: strategySignal.qty,
      pnlPct,
      source: "strategy",
    };
  }

  const tp = strategy?.risk?.takeProfitPct ?? 3;
  const sl = strategy?.risk?.stopLossPct ?? 2;

  if (pnlPct != null && pnlPct >= tp) {
    return {
      triggered: true,
      hasPosition: true,
      action: "sell",
      reason: `风控止盈 +${pnlPct.toFixed(2)}%（目标 ${tp}%）`,
      sellPct: 1,
      pnlPct,
      source: "take_profit",
    };
  }

  if (pnlPct != null && pnlPct <= -sl) {
    return {
      triggered: true,
      hasPosition: true,
      action: "sell",
      reason: `风控止损 ${pnlPct.toFixed(2)}%（上限 -${sl}%）`,
      pnlPct,
      source: "stop_loss",
    };
  }

  return {
    triggered: false,
    hasPosition: true,
    monitoring: true,
    reason:
      pnlPct != null
        ? `持仓监控 · 盈亏 ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}% · 止盈 +${tp}% / 止损 -${sl}%`
        : "持仓中 · 等待策略或风控出场",
    pnlPct,
    source: "monitor",
  };
}

/** 退出评估：规则 + DeepSeek Pro */
export async function evaluateAgentExit(ctx) {
  const ruleExit = evaluateAgentExitRules(ctx);

  if (!isDeepseekConfigured() || !ctx.hasBase) {
    return { ...ruleExit, deepseekUsed: false };
  }

  // 无触发条件且仅持仓监控时，规则层足够，跳过 LLM 以加速
  if (!ruleExit.triggered && ruleExit.monitoring) {
    return { ...ruleExit, deepseekUsed: false, deepseekSkipped: "持仓监控" };
  }

  try {
    const llm = await invokeDeepseekExit({
      symbol: ctx.strategy?.symbol || ctx.symbol,
      strategy: ctx.strategy,
      ruleExit,
      hasBase: ctx.hasBase,
      entryPrice: ctx.entryPrice,
      lastPrice: ctx.lastPrice,
      perception: ctx.perception,
      strategySignal: ctx.strategySignal,
    });

    if (ruleExit.triggered && ["take_profit", "stop_loss", "strategy"].includes(ruleExit.source)) {
      return {
        ...ruleExit,
        reason: llm.reason || ruleExit.reason,
        deepseekUsed: true,
        deepseekModel: llm.model,
        deepseekConfidence: llm.confidence,
        deepseekSource: llm.source,
      };
    }

    if (llm.triggered && llm.action === "sell") {
      return {
        triggered: true,
        hasPosition: true,
        monitoring: false,
        action: "sell",
        reason: llm.reason,
        sellPct: llm.sellPct ?? ruleExit.sellPct ?? 1,
        qty: llm.qty ?? ruleExit.qty,
        pnlPct: ruleExit.pnlPct,
        source: llm.source || "llm_exit",
        deepseekUsed: true,
        deepseekModel: llm.model,
        deepseekConfidence: llm.confidence,
      };
    }

    return {
      ...ruleExit,
      reason: llm.reason || ruleExit.reason,
      monitoring: !llm.triggered,
      deepseekUsed: true,
      deepseekModel: llm.model,
      deepseekConfidence: llm.confidence,
    };
  } catch (e) {
    console.warn("[evaluateAgentExit] DeepSeek Pro 失败:", e.message);
    return { ...ruleExit, deepseekUsed: false, deepseekError: e.message };
  }
}

/** 风控（规则基准） */
function evaluateAgentRiskRules({
  decision,
  strategy,
  accountState,
  sessionState,
  config,
}) {
  const checks = [];
  const paused = !!sessionState?.paused;
  const lastPrice = Number(accountState.lastPrice || 0);
  const equity =
    sessionState?.equity ??
    Number(accountState.usdtAvailable || 0) +
      Number(accountState.baseAvailable || 0) * lastPrice;
  const peak = Math.max(sessionState?.peakEquity || 0, equity);
  const dd = peak > 0 ? (peak - equity) / peak : 0;
  const maxDd = (strategy?.risk?.maxDrawdownPct ?? 5) / 100;

  checks.push({
    id: "drawdown",
    pass: dd < maxDd,
    detail: `回撤 ${(dd * 100).toFixed(2)}% / 上限 ${(maxDd * 100).toFixed(0)}%`,
  });

  const drawdownBreached = dd >= maxDd;
  if (drawdownBreached && decision.action === "buy") {
    return {
      ok: false,
      reason: `账户回撤 ${(dd * 100).toFixed(2)}% 超上限，禁止开仓`,
      pause: true,
      drawdownPct: dd * 100,
      checks,
    };
  }

  if (paused && decision.action === "buy") {
    return {
      ok: false,
      reason: "风控暂停中，禁止开仓",
      pause: true,
      drawdownPct: dd * 100,
      checks,
    };
  }

  if (decision.action === "hold") {
    checks.push({ id: "pretrade", pass: true, detail: "本轮无交易，跳过预检" });
    return {
      ok: true,
      reason: "风控通过 · 持续监控",
      pause: false,
      drawdownPct: 0,
      checks,
    };
  }

  const preTrade = checkStrategyRisk({
    decision,
    config,
    usdtAvailable: accountState.usdtAvailable,
    baseAvailable: accountState.baseAvailable,
    lastPrice,
  });

  checks.push({
    id: "pretrade",
    pass: preTrade.ok,
    detail: preTrade.ok ? "余额与每日限额检查通过" : preTrade.reason,
  });

  if (!preTrade.ok) {
    return {
      ok: false,
      reason: preTrade.reason,
      pause: drawdownBreached || paused,
      drawdownPct: dd * 100,
      checks,
    };
  }

  return {
    ok: true,
    reason: "风控通过，允许执行",
    pause: drawdownBreached || paused,
    drawdownPct: dd * 100,
    checks,
  };
}

/** 风控：规则 + DeepSeek Pro */
export async function evaluateAgentRisk(params) {
  const ruleRisk = evaluateAgentRiskRules(params);

  if (!isDeepseekConfigured()) {
    return { ...ruleRisk, deepseekUsed: false };
  }

  if (!ruleRisk.ok) {
    return { ...ruleRisk, deepseekUsed: false, deepseekSkipped: "规则拦截" };
  }

  if (params.decision?.action === "hold") {
    return { ...ruleRisk, deepseekUsed: false, deepseekSkipped: "本轮无交易" };
  }

  try {
    const llm = await invokeDeepseekRisk({
      symbol: params.strategy?.symbol,
      strategy: params.strategy,
      decision: params.decision,
      ruleRisk,
      accountState: params.accountState,
      perception: params.perception,
    });

    const ok = ruleRisk.ok && llm.approve !== false;
    return {
      ok,
      reason: ok
        ? `智能体 · ${llm.reason}`
        : `AI 拦截 · ${llm.reason}（规则：${ruleRisk.reason}）`,
      pause: ruleRisk.pause || llm.pause,
      drawdownPct: ruleRisk.drawdownPct,
      checks: ruleRisk.checks,
      deepseekUsed: true,
      deepseekModel: llm.model,
      deepseekConfidence: llm.confidence,
      ruleReason: ruleRisk.reason,
    };
  } catch (e) {
    console.warn("[evaluateAgentRisk] DeepSeek Pro 失败:", e.message);
    return { ...ruleRisk, deepseekUsed: false, deepseekError: e.message };
  }
}

/** 将退出信号覆盖到决策（持仓时优先出场） */
export function applyExitToDecision(decision, exitEval, fused) {
  if (!exitEval?.triggered || exitEval.action !== "sell") {
    return { decision, fused, exitApplied: false };
  }

  const exitReason =
    exitEval.source === "strategy"
      ? fused?.agentReason || "策略出场"
      : exitEval.source === "take_profit"
        ? "风控止盈"
        : exitEval.source === "stop_loss"
          ? "风控止损"
          : exitEval.source === "llm_exit"
            ? "智能退出"
            : "出场信号";

  const nextDecision = {
    action: "sell",
    reason:
      exitEval.source === "strategy" && fused?.decision?.action === "sell"
        ? fused.decision.reason
        : `智能体退出 · ${exitEval.reason}`,
    sellPct: exitEval.sellPct,
    qty: exitEval.qty,
    evaluation: decision.evaluation,
  };

  return {
    decision: nextDecision,
    fused: {
      ...fused,
      decision: nextDecision,
      agentReason: exitReason,
    },
    exitApplied: true,
  };
}

export async function agentPerceive(symbol) {
  try {
    return await gatherPerception(symbol, { force: false });
  } catch {
    return null;
  }
}

export function buildAgentTrace({
  perception,
  strategySignal,
  fused,
  risk,
  exit,
  executed,
  order,
  orderError,
}) {
  return {
    perceive: perception?.composite
      ? {
          bias: perception.composite.bias,
          score: perception.composite.score,
          signalCount: perception.composite.signals?.length ?? 0,
          hubConnected: perception.agentHubCore ?? isAgentHubReady(),
          dataProviders: perception.dataProviders || perception.decisionFeed?.sources || null,
          decisionFeedReady: perception.decisionFeed?.ready ?? false,
          macro: perception.decisionFeed?.macro?.us10y != null
            ? `10Y ${perception.decisionFeed.macro.us10y}% · DXY ${perception.decisionFeed.macro.dxy ?? "—"}`
            : null,
          summary: perception.deepseekPerception?.summary
            ? `${formatPerceptionLog({
                bias: perception.composite.bias,
                score: perception.composite.score,
                signalCount: perception.composite.signals?.length ?? 0,
                cached: perception.cached,
              })} · ${perception.deepseekPerception.summary}`
            : formatPerceptionLog({
                bias: perception.composite.bias,
                score: perception.composite.score,
                signalCount: perception.composite.signals?.length ?? 0,
                cached: perception.cached,
              }),
          deepseekUsed: perception.deepseekUsed ?? false,
          deepseekModel: perception.deepseekPerception?.model || null,
        }
      : { bias: "—", score: 0, signalCount: 0, summary: "感知暂不可用" },
    decide: {
      strategyAction: strategySignal?.action || "hold",
      strategyReason: strategySignal?.reason || "—",
      finalAction: fused?.decision?.action || "hold",
      finalReason: fused?.decision?.reason || "—",
      displayAction:
        exit?.hasPosition && (fused?.decision?.action || "hold") === "hold"
          ? "hold_position"
          : fused?.decision?.action || "hold",
      agentReason: fused?.agentReason || "—",
      autonomousThought: fused?.llmReason || fused?.autonomousThought || null,
      regimeAssessment: fused?.regimeAssessment || null,
      deepseekUsed: fused?.deepseekUsed ?? fused?.qwenUsed ?? false,
      deepseekModel: fused?.deepseekModel || fused?.qwenModel || null,
      deepseekConfidence: fused?.deepseekConfidence ?? fused?.qwenConfidence ?? null,
      llmRawConfidence: fused?.llmRawConfidence ?? null,
      conditionPassRate: fused?.conditionPassRate ?? null,
      conditionChecksPassed: fused?.conditionChecksPassed ?? null,
      conditionChecksTotal: fused?.conditionChecksTotal ?? null,
      qwenUsed: fused?.deepseekUsed ?? fused?.qwenUsed ?? false,
      qwenModel: fused?.deepseekModel || fused?.qwenModel || null,
      qwenConfidence: fused?.deepseekConfidence ?? fused?.qwenConfidence ?? null,
      ruleSuggestion: fused?.ruleSuggestion || null,
      qwenError: fused?.qwenError || null,
      evaluation: strategySignal?.evaluation?.summary || null,
      checks: strategySignal?.evaluation?.checks || null,
    },
    risk: {
      passed: risk?.ok !== false,
      reason: risk?.reason || "—",
      drawdownPct: risk?.drawdownPct ?? null,
      paused: !!risk?.pause,
      checks: risk?.checks || [],
      deepseekUsed: risk?.deepseekUsed ?? false,
      deepseekModel: risk?.deepseekModel || null,
      deepseekConfidence: risk?.deepseekConfidence ?? null,
      deepseekError: risk?.deepseekError || null,
    },
    execute: {
      executed: !!executed,
      orderId: order?.orderId || null,
      error: orderError || null,
      source: order?.source || "bitget-api",
      apiPath: order?.apiPath || order?.venue || null,
      bitgetApi: !!executed && !!(order?.orderId || order?.source === "bitget-api"),
      tradeType: order?.tradeType || null,
      tradeLabel: order?.tradeLabel || null,
      qty: order?.qty || null,
      side: order?.side || null,
      hubConnected: isAgentHubReady(),
      blockedByRisk: risk?.ok === false && fused?.decision?.action !== "hold",
    },
    exit: {
      hasPosition: !!exit?.hasPosition,
      triggered: !!exit?.triggered,
      monitoring: !!exit?.monitoring,
      reason: exit?.reason || "—",
      pnlPct: exit?.pnlPct ?? null,
      source: exit?.source || "—",
      closed: executed && fused?.decision?.action === "sell",
      deepseekUsed: exit?.deepseekUsed ?? false,
      deepseekModel: exit?.deepseekModel || null,
      deepseekConfidence: exit?.deepseekConfidence ?? null,
      deepseekError: exit?.deepseekError || null,
    },
  };
}

/** 链路执行中的阶段性 Agent 快照（用于 SSE 实时推送） */
export function buildPipelineAgentTrace({
  perception = null,
  strategySignal = { action: "hold", reason: "—" },
  decide = {},
  risk = { ok: true, reason: "—" },
  exit = { hasPosition: false, reason: "—" },
  execute = { executed: false },
}) {
  const trace = buildAgentTrace({
    perception,
    strategySignal,
    fused: {
      decision: {
        action: decide.finalAction || "hold",
        reason: decide.finalReason || decide.agentReason || "—",
      },
      agentReason: decide.agentReason || decide.finalReason || "—",
      deepseekUsed: decide.deepseekUsed ?? false,
      deepseekConfidence: decide.deepseekConfidence ?? null,
      llmReason: decide.autonomousThought || null,
      autonomousThought: decide.autonomousThought || null,
      regimeAssessment: decide.regimeAssessment || null,
      ruleSuggestion: decide.ruleSuggestion || null,
    },
    risk,
    exit,
    executed: !!execute.executed,
    order: execute.order || null,
    orderError: execute.error || null,
  });
  return {
    ...trace,
    decide: { ...trace.decide, ...decide },
    risk: { ...trace.risk, passed: risk.ok !== false, ...risk },
    execute: { ...trace.execute, ...execute },
    exit: { ...trace.exit, ...exit },
  };
}

export function buildWaitingAgentTrace(message) {
  return {
    perceive: {
      summary: message,
      bias: "neutral",
      score: 0,
      signalCount: 0,
      deepseekUsed: false,
    },
    decide: {
      strategyAction: "hold",
      finalAction: "hold",
      finalReason: message,
      agentReason: message,
      deepseekUsed: false,
    },
    risk: { passed: true, reason: "等待中…" },
    execute: { executed: false },
    exit: { hasPosition: false, reason: "—" },
  };
}

/** SSE 阶段性推送：感知已完成，后续步骤进行中 */
export function buildPerceptionStageTrace(perception, statusMessage = "感知完成") {
  return buildAgentTrace({
    perception,
    strategySignal: { action: "hold", reason: statusMessage },
    fused: {
      decision: { action: "hold", reason: statusMessage },
      agentReason: statusMessage,
      deepseekUsed: false,
    },
    risk: { ok: true, reason: "等待策略设计…" },
    exit: { hasPosition: false, reason: "—" },
    executed: false,
  });
}
