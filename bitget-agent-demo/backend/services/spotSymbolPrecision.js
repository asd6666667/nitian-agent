/** Bitget 现货数量/价格精度 — 来自 public/symbols，带本地缓存 */

const FALLBACK_QTY_DECIMALS = {
  BTCUSDT: 4,
  ETHUSDT: 4,
  SOLUSDT: 4,
  BNBUSDT: 4,
  XRPUSDT: 1,
  DOGEUSDT: 0,
  ADAUSDT: 1,
  AVAXUSDT: 2,
  LINKUSDT: 2,
  DOTUSDT: 2,
};

const FALLBACK_PRICE_DECIMALS = {
  BTCUSDT: 2,
  ETHUSDT: 2,
  SOLUSDT: 2,
  BNBUSDT: 2,
  XRPUSDT: 4,
  DOGEUSDT: 5,
  ADAUSDT: 4,
  AVAXUSDT: 3,
  LINKUSDT: 3,
  DOTUSDT: 3,
};

/** @type {Map<string, { qtyDecimals: number, priceDecimals: number }>} */
const cache = new Map();
const pending = new Map();

function parseQtyPrecision(row) {
  const raw =
    row?.quantityPrecision ??
    row?.volumePlace ??
    row?.quantityScale ??
    row?.sizeScale ??
    row?.basePrecision;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parsePricePrecision(row) {
  const raw = row?.pricePrecision ?? row?.pricePlace ?? row?.priceScale;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function fallbackMeta(sym) {
  return {
    qtyDecimals: FALLBACK_QTY_DECIMALS[sym] ?? 4,
    priceDecimals: FALLBACK_PRICE_DECIMALS[sym] ?? 2,
  };
}

/** 同步读取 base 数量小数位（需先 ensureSpotSymbolPrecision 或命中 fallback） */
export function getSpotBaseQtyDecimals(symbol) {
  const sym = String(symbol || "BTCUSDT").toUpperCase();
  return cache.get(sym)?.qtyDecimals ?? FALLBACK_QTY_DECIMALS[sym] ?? 4;
}

/** 同步读取限价 price 小数位 */
export function getSpotPriceDecimals(symbol) {
  const sym = String(symbol || "BTCUSDT").toUpperCase();
  return cache.get(sym)?.priceDecimals ?? FALLBACK_PRICE_DECIMALS[sym] ?? 2;
}

/** 格式化为 Bitget 接受的限价字符串（避免 25200 delegatePrice scale illegal） */
export function formatSpotPrice(price, symbol) {
  const p = Number(price);
  if (!p || p <= 0) return null;
  const decimals = getSpotPriceDecimals(symbol);
  const factor = 10 ** decimals;
  const rounded = Math.round(p * factor) / factor;
  if (rounded <= 0) return null;
  return rounded.toFixed(decimals);
}

export async function ensureSpotSymbolPrecision(symbol) {
  const sym = String(symbol || "BTCUSDT").toUpperCase();
  if (cache.has(sym)) return cache.get(sym);

  if (pending.has(sym)) return pending.get(sym);

  const task = (async () => {
    try {
      const res = await fetch(`https://api.bitget.com/api/v2/spot/public/symbols?symbol=${sym}`, {
        signal: AbortSignal.timeout(8000),
        headers: { Accept: "application/json" },
      });
      const data = await res.json();
      const row = Array.isArray(data.data) ? data.data[0] : data.data;
      const qtyDecimals = parseQtyPrecision(row);
      const priceDecimals = parsePricePrecision(row);
      if (qtyDecimals != null || priceDecimals != null) {
        const fb = fallbackMeta(sym);
        const meta = {
          qtyDecimals: qtyDecimals ?? fb.qtyDecimals,
          priceDecimals: priceDecimals ?? fb.priceDecimals,
        };
        cache.set(sym, meta);
        return meta;
      }
    } catch {
      /* fallback */
    }
    const meta = fallbackMeta(sym);
    cache.set(sym, meta);
    return meta;
  })();

  pending.set(sym, task);
  try {
    return await task;
  } finally {
    pending.delete(sym);
  }
}

export async function preloadSpotSymbolPrecisions(symbols = []) {
  await Promise.all(symbols.map((s) => ensureSpotSymbolPrecision(s)));
}
