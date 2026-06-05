/** 隐藏 UI 中的模型/供应商名称 */
export function hideModelTerms(text) {
  if (text == null || text === "") return text;
  return String(text)
    .replace(/deepseek[-\s]?/gi, "")
    .replace(/\b(lite|flash)\b/gi, "")
    .replace(/\bv4[-\s]?(flash|pro)\b/gi, "")
    .replace(/\bpro\b(?=\s*(决策|风控|退出|未))/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s·\s·/g, " · ")
    .trim();
}

/** Agent 链路各步是否完成 / 跳过（未开单时执行、风控不打勾） */
export function agentStepFlags(agent) {
  const { perceive, decide, risk, execute, exit } = agent || {};
  const perceiveDone = !!perceive?.summary && perceive.summary !== "—";
  const decideDone = !!decide?.finalReason && decide.finalReason !== "—";
  const executed = !!execute?.executed;
  const blockedByRisk = !!execute?.blockedByRisk;
  const tradeIntent = decide?.finalAction === "buy" || decide?.finalAction === "sell";

  const executeDone = executed;
  const executeSkipped = !executed && !blockedByRisk && !execute?.error;

  const riskInvolved = executed || blockedByRisk;
  const riskDone = riskInvolved && risk?.passed !== false && !risk?.paused;
  const riskFailed = blockedByRisk || risk?.passed === false || !!risk?.paused;
  const riskSkipped = !riskInvolved;

  const exitDone = !!exit?.triggered || !!exit?.closed;
  const exitSkipped = !exit?.hasPosition && !exitDone;
  const exitMonitoring = !!exit?.hasPosition && !!exit?.monitoring && !exitDone;

  return {
    perceiveDone,
    decideDone,
    executeDone,
    executeSkipped,
    riskDone,
    riskFailed,
    riskSkipped,
    riskInvolved,
    exitDone,
    exitSkipped,
    exitMonitoring,
    tradeIntent,
    executed,
  };
}
