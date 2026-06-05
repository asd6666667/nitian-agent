function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function ruleStrategy({ candles, btcAvailable, lastPrice }) {
  const closes = candles.map((row) => Number(row[4])).filter(Boolean);
  if (closes.length < 20) {
    return { action: "hold", reason: "K线数据不足" };
  }

  const ma5 = average(closes.slice(-5));
  const ma20 = average(closes.slice(-20));
  const hasBtc = Number(btcAvailable) > 0.00001;

  if (ma5 > ma20 && !hasBtc) {
    return {
      action: "buy",
      reason: `MA5(${ma5.toFixed(2)}) > MA20(${ma20.toFixed(2)})，无 BTC 持仓，买入`,
      ma5,
      ma20,
      lastPrice,
    };
  }

  if (ma5 < ma20 && hasBtc) {
    return {
      action: "sell",
      reason: `MA5(${ma5.toFixed(2)}) < MA20(${ma20.toFixed(2)})，有 BTC 持仓，卖出`,
      ma5,
      ma20,
      lastPrice,
    };
  }

  return {
    action: "hold",
    reason: hasBtc
      ? `MA5(${ma5.toFixed(2)}) >= MA20(${ma20.toFixed(2)})，继续持有`
      : `MA5(${ma5.toFixed(2)}) <= MA20(${ma20.toFixed(2)})，观望`,
    ma5,
    ma20,
    lastPrice,
  };
}
