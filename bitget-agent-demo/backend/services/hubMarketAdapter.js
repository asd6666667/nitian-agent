/** 将 bitget-core 工具返回的 K 线归一化为内部 candle 结构 */
export function normalizeHubCandles(payload) {
  const rows = payload?.data?.data ?? payload?.data ?? payload;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      if (Array.isArray(row)) {
        return {
          time: Number(row[0]),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5]),
        };
      }
      if (row && typeof row === "object") {
        return {
          time: Number(row.ts ?? row.time ?? row[0]),
          open: Number(row.open ?? row.o),
          high: Number(row.high ?? row.h),
          low: Number(row.low ?? row.l),
          close: Number(row.close ?? row.c),
          volume: Number(row.volume ?? row.baseVol ?? row.v ?? 0),
        };
      }
      return null;
    })
    .filter((c) => c && Number.isFinite(c.close))
    .sort((a, b) => a.time - b.time);
}

export function hubToolData(result) {
  return result?.data?.data ?? result?.data ?? result;
}
