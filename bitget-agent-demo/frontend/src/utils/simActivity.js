function formatLogSide(log) {
  const cat = log.category || "";
  const isFutures = /FUTURES|futures/i.test(cat) || Boolean(log.posSide);
  if (isFutures) {
    const ps = log.posSide || log.side;
    if (ps === "close") return "合约平仓";
    if (ps === "long" || ps === "buy") return "合约开多";
    if (ps === "short" || ps === "sell") return "合约开空";
    return "合约";
  }
  if (log.side === "buy" || log.decision?.action === "buy") return "买入";
  if (log.side === "sell" || log.decision?.action === "sell") return "卖出";
  return log.side || "交易";
}

/** 日志方向列：现货买入/卖出，合约开多/开空/平仓 */
export function formatLogAction(log) {
  if (log.tradeLabel) return log.tradeLabel;
  if (log.tradeType === "futures_open_long") return "合约开多";
  if (log.tradeType === "futures_open_short") return "合约开空";
  if (log.tradeType === "futures_close_long") return "合约平多";
  if (log.tradeType === "futures_close_short") return "合约平空";
  if (log.tradeType === "spot_buy") return "现货买入";
  if (log.tradeType === "spot_sell") return "现货卖出";

  const cat = log.category || "";
  if (/FUTURES|futures/i.test(cat) || log.posSide) {
    const ps = log.posSide || log.side;
    if (ps === "close") return "平仓";
    if (ps === "long" || ps === "buy") return "开多";
    if (ps === "short" || ps === "sell") return "开空";
    return "合约";
  }
  const action = log.decision?.action || log.side;
  if (action === "buy") return "买入";
  if (action === "sell") return "卖出";
  if (action === "hold") return "观望";
  return "—";
}

function formatLogMessage(log) {
  if (log.raw) return log.raw;

  const action = log.decision?.action || log.side;
  const reason = log.decision?.reason;

  if (reason) {
    const label = log.tradeLabel || formatLogAction(log);
    if (log.executed) {
      const oid = log.order?.orderId ? ` · #${log.order.orderId}` : "";
      return `${label} · ${reason}${oid}`;
    }
    if (log.orderError) {
      return `未成交 · ${log.orderError}`;
    }
    if (log.risk && log.risk.ok === false) {
      return `风控拦截 · ${log.risk.reason || reason}`;
    }
    if (action === "sell" || action === "buy") {
      return `拟${action === "sell" ? "卖" : "买"} · ${reason}（未提交交易所）`;
    }
    return reason;
  }

  const coin = (log.symbol || "").replace(/USDT$/i, "");
  const sideLabel = formatLogSide(log);
  const cat = log.category || "";
  const isFutures = /FUTURES|futures/i.test(cat) || Boolean(log.posSide);

  if (isFutures && coin) {
    const qty = log.qty ? ` · ${log.qty}` : "";
    const price = log.price ? ` @ $${Number(log.price).toFixed(2)}` : "";
    const lev = log.leverage ? ` · ${log.leverage}x` : "";
    return `${sideLabel} ${coin}${qty}${price}${lev}`.trim();
  }

  if (log.symbol && log.side) {
    const coin = (log.symbol || "").replace(/USDT$/i, "");
    const price = log.price ? ` @ $${Number(log.price).toFixed(2)}` : "";
    return `${sideLabel} ${coin} · ${log.orderType || "market"} · qty ${log.qty}${price}${
      log.order?.orderId ? ` · #${log.order.orderId}` : ""
    }`;
  }

  if (log.side && log.qty) {
    return `${sideLabel} · ${log.orderType || "market"} · qty ${log.qty}`;
  }

  return log.error || (log.executed ? "已执行" : "跳过");
}

/** 将 trades.jsonl 条目转为 PaperTradingPanel 实时日志格式 */
export function simLogToPanelEntry(log) {
  const action = log.decision?.action || log.side;
  let level = "info";
  if (log.executed) level = "info";
  else if (log.orderError || log.error) level = "critical";
  else if (action === "sell" || action === "buy") level = "warning";
  else if (log.risk && log.risk.ok === false) level = "warning";

  return {
    time: log.ts ? new Date(log.ts).getTime() : Date.now(),
    message: formatLogMessage(log),
    level,
  };
}

export function formatSimLogLine(log) {
  return formatLogMessage(log);
}

export function formatLogReason(log) {
  return formatLogMessage(log);
}

export function logActionClass(action) {
  if (action === "买入" || action === "开多") return "text-profit";
  if (action === "卖出" || action === "开空") return "text-loss";
  return "text-gray-400";
}

export function futuresSideLabel(p) {
  const side = String(p?.holdSide || p?.posSide || p?.side || "").toLowerCase();
  if (side === "long") return "多";
  if (side === "short") return "空";
  return "—";
}

export function futuresSideClass(p) {
  const side = String(p?.holdSide || p?.posSide || p?.side || "").toLowerCase();
  if (side === "long") return "text-profit";
  if (side === "short") return "text-loss";
  return "text-gray-400";
}

export function formatFuturesPrice(price) {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1000) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

export function formatLiquidationPrice(price) {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return formatFuturesPrice(n);
}

export function formatOrderQty(order) {
  const qty = Number(order?.qty || 0);
  if (!qty) return "0";
  if (order?.qtyIsQuote) return `${qty} USDT`;
  if (qty >= 1000) return qty.toFixed(2);
  if (qty >= 1) return qty.toFixed(4);
  return qty.toFixed(6);
}

export function formatOrderPrice(order) {
  const price = Number(order?.price || 0);
  if (!price) return "—";
  if (price >= 1000) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

export function formatOrderSide(order) {
  if (order?.tradeLabel) return order.tradeLabel;
  if (order?.tradeType === "futures_open_long") return "开多";
  if (order?.tradeType === "futures_open_short") return "开空";
  if (order?.tradeType === "futures_close_long") return "平多";
  if (order?.tradeType === "futures_close_short") return "平空";
  if (order?.category === "futures" || order?.category === "USDT-FUTURES") {
    const ps = order.posSide || order.side;
    if (ps === "long" || (order.side === "buy" && ps !== "short")) return "LONG";
    if (ps === "short" || order.side === "sell") return "SHORT";
    return "FUT";
  }
  return order?.side?.toUpperCase() || "—";
}
