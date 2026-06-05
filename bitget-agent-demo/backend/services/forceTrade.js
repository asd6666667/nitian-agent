/**
 * 用户强制交易指令 — 跳过感知 Skill 门禁，直接执行
 */
export function isForceUserTrade(text) {
  const t = String(text || "").trim();
  return (
    /强制(?:买入|买|卖出|卖|开仓|开多|开空|做多|做空|平多|平空|平仓|平掉全部|全部平仓|下单|清仓)/.test(t) ||
    /必须(?:买入|买|卖出|卖|开仓|开多|开空|平多|平空|平仓|下单)/.test(t) ||
    /无视感知|忽略感知|不计感知|强制执行/.test(t)
  );
}

export function isForceFuturesTrade(text) {
  const t = String(text || "").trim();
  if (!isForceUserTrade(t)) return false;
  return /开|平|多|空|仓|保证金|杠杆|永续/i.test(t);
}

export function isForceSpotTrade(text) {
  const t = String(text || "").trim();
  if (!isForceUserTrade(t)) return false;
  return /买|卖|清仓|现货/i.test(t) || (!/开多|开空|平多|平空|平仓|保证金|杠杆|永续/i.test(t) && /卖|买/.test(t));
}

export function forceTradeSuffix(text) {
  return isForceUserTrade(text) ? " · 强制指令直接执行" : "";
}
