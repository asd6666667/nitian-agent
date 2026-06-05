export const TRADABLE_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT",
  "LTCUSDT", "BCHUSDT", "ATOMUSDT", "UNIUSDT", "FILUSDT",
];

export function normalizeSymbol(raw, fallback = "BTCUSDT") {
  if (!raw) return fallback;
  const sym = String(raw).replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9]{2,20}USDT$/.test(sym)) return fallback;
  return sym;
}
