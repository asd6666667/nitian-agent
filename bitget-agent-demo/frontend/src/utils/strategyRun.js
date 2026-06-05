/** 策略运行实例 ID — 同 id+symbol 视为同一实例 */
export function strategyRunId(strategy) {
  if (!strategy) return "";
  if (strategy.runId) return strategy.runId;
  const id = strategy.id || `${strategy.type || "custom"}_${strategy.symbol || "BTCUSDT"}`;
  return id;
}

export function withRunId(strategy) {
  const runId = strategyRunId(strategy);
  return { ...strategy, runId };
}

export function mergeRunningStrategy(list, strategy) {
  const next = withRunId(strategy);
  const idx = list.findIndex((s) => strategyRunId(s) === next.runId);
  if (idx >= 0) {
    const copy = [...list];
    const typeChanged = copy[idx].type !== next.type;
    const summaryChanged = copy[idx].summary !== next.summary;
    copy[idx] = {
      ...copy[idx],
      ...next,
      lastAgent: typeChanged || summaryChanged ? null : copy[idx].lastAgent,
    };
    return copy;
  }
  return [...list, { ...next, lastAgent: null, startedAt: Date.now() }];
}

export function removeRunningStrategy(list, runId) {
  return list.filter((s) => strategyRunId(s) !== runId);
}
