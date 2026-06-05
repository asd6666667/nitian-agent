/** 汇总合约持仓未实现盈亏 */
export function sumFuturesUnrealised(positions = []) {
  if (!Array.isArray(positions)) return 0;
  return positions.reduce(
    (s, p) => s + Number(p.unrealisedPnl || p.unrealizedPnl || 0),
    0
  );
}

/** Bitget V3 合约持仓字段归一化（posSide → holdSide） */
export function normalizeFuturesPositions(list) {
  if (!Array.isArray(list)) return [];
  return list.map((p) => {
    const avgRaw = pickPositiveNumber(p.avgPrice, p.openPriceAvg, p.openPrice);
    const liqRaw = pickPositiveNumber(p.liquidationPrice, p.liqPrice);
    const markRaw = pickPositiveNumber(p.markPrice, p.mark_price, p.lastPrice, p.last);
    return {
      symbol: p.symbol || p.instId || "—",
      holdSide: String(p.posSide || p.holdSide || p.side || "").toLowerCase() || "—",
      posSide: String(p.posSide || p.holdSide || p.side || "").toLowerCase() || null,
      size: p.total || p.size || p.available || "0",
      total: p.total || p.size || p.available || "0",
      unrealisedPnl: Number(p.unrealisedPnl || p.unrealizedPnl || p.unrealizedPL || 0),
      realisedPnl: Number(p.curRealisedPnl || p.realisedPnl || p.realizedPnl || 0),
      margin: p.margin || p.marginSize || p.positionBalance || "—",
      leverage: p.leverage || "—",
      avgPrice: avgRaw || null,
      openPrice: avgRaw || null,
      liquidationPrice: liqRaw > 0 ? liqRaw : null,
      markPrice: markRaw > 0 ? markRaw : null,
      breakEvenPrice: pickPositiveNumber(p.breakEvenPrice) || null,
    };
  });
}

/** 持仓无 markPrice 时用现货 ticker 补现价 */
export async function enrichFuturesMarkPrices(positions = []) {
  if (!positions.length) return positions;
  const needPrice = positions.filter((p) => !p.markPrice && p.symbol && p.symbol !== "—");
  if (!needPrice.length) return positions;

  const symbols = [...new Set(needPrice.map((p) => p.symbol))];
  const priceMap = {};
  try {
    const { getTicker } = await import("../../../demo-bot/bitget-v3.js");
    await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const ticker = await getTicker(symbol);
          const price = Number(ticker?.lastPr);
          if (Number.isFinite(price) && price > 0) priceMap[symbol] = price;
        } catch {
          /* ignore */
        }
      })
    );
  } catch {
    return positions;
  }

  return positions.map((p) =>
    p.markPrice ? p : { ...p, markPrice: priceMap[p.symbol] || null }
  );
}

function pickPositiveNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}