export function checkRisk({ decision, config, usdtAvailable, btcAvailable }) {
  if (decision.action === "hold") {
    return { ok: true };
  }

  if (decision.action === "buy") {
    const usdt = Number(usdtAvailable);
    const reserve = Number(config.minUsdtReserve);
    if (usdt <= reserve) {
      return { ok: false, reason: `USDT 可用余额不足 (可用 ${usdt}, 需保留 ${reserve})` };
    }
    return { ok: true };
  }

  if (decision.action === "sell") {
    const btc = Number(btcAvailable);
    const size = Number(config.orderSizeBtc);
    if (btc < size * 0.99) {
      return { ok: false, reason: `BTC 可用不足 (可用 ${btc}, 需要 ${size})` };
    }
    return { ok: true };
  }

  return { ok: false, reason: "未知 action" };
}

export function getDailyTradeCount(logLines, dayKey) {
  return logLines.filter((line) => {
    try {
      const entry = JSON.parse(line);
      return entry.executed === true && entry.ts?.startsWith(dayKey);
    } catch {
      return false;
    }
  }).length;
}

export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}
