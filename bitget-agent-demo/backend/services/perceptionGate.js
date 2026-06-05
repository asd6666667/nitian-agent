/**
 * 感知 Skill → 执行层门禁
 * 策略信号先过 Skill Hub 综合分，再决定是否下单
 */

const BIAS_LABEL = { bullish: "偏多", bearish: "偏空", neutral: "中性" };

export function applyPerceptionGate(decision, perception, opts = {}) {
  const enabled = opts.usePerception !== false;
  if (opts.forceExecute || opts.skipGate) {
    return { decision, perceptionUsed: false, perceptionSummary: null };
  }
  if (!enabled || !perception?.composite || decision?.action === "hold") {
    return { decision, perceptionUsed: false, perceptionSummary: null };
  }

  const { bias, score, signals = [] } = perception.composite;
  const label = BIAS_LABEL[bias] || bias;
  const summary = { bias, score, signalCount: signals.length, cached: !!perception.cached };

  if (decision.action === "buy") {
    if (bias === "bearish" || score < -0.2) {
      return {
        decision: {
          action: "hold",
          reason: `策略买入 · 感知 Skill 偏空 (${label} ${score})，暂缓开仓`,
          originalAction: "buy",
          originalReason: decision.reason,
          perceptionBlocked: true,
        },
        perceptionUsed: true,
        perceptionSummary: summary,
      };
    }
    return {
      decision: {
        ...decision,
        reason: `${decision.reason} · 感知${label}(${score})放行`,
        perceptionAllowed: true,
      },
      perceptionUsed: true,
      perceptionSummary: summary,
    };
  }

  if (decision.action === "sell") {
    if (bias === "bullish" && score > 0.35) {
      return {
        decision: {
          action: "hold",
          reason: `策略卖出 · 感知 Skill 强偏多 (${label} ${score})，暂保留仓位`,
          originalAction: "sell",
          originalReason: decision.reason,
          perceptionBlocked: true,
        },
        perceptionUsed: true,
        perceptionSummary: summary,
      };
    }
    return {
      decision: {
        ...decision,
        reason: `${decision.reason} · 感知${label}(${score})放行`,
        perceptionAllowed: true,
      },
      perceptionUsed: true,
      perceptionSummary: summary,
    };
  }

  return { decision, perceptionUsed: false, perceptionSummary: summary };
}

export function formatPerceptionLog(summary) {
  if (!summary) return null;
  const label = BIAS_LABEL[summary.bias] || summary.bias;
  return `综合 ${label} · 分 ${summary.score} · ${summary.signalCount} 个信号${summary.cached ? " (缓存)" : ""}`;
}
