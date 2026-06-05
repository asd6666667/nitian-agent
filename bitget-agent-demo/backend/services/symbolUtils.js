/**
 * 现货交易对解析 — 支持 Bitget 全量 USDT 交易对
 */
import { getSpotSymbols } from "./bitgetClient.js";

export const TRADABLE_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT",
  "LTCUSDT", "BCHUSDT", "ATOMUSDT", "UNIUSDT", "FILUSDT",
  "AAVEUSDT", "MATICUSDT", "ARBUSDT", "OPUSDT", "SUIUSDT",
];

/** 中文名 → 币种 */
export const CHINESE_TO_COIN = {
  比特币: "BTC",
  以太坊: "ETH",
  以太: "ETH",
  索拉纳: "SOL",
  狗狗币: "DOGE",
  瑞波: "XRP",
  莱特币: "LTC",
  波卡: "DOT",
  艾达: "ADA",
};

let symbolListCache = { list: [], ts: 0 };

export async function getCachedSpotSymbols() {
  if (Date.now() - symbolListCache.ts < 3600000 && symbolListCache.list.length) {
    return symbolListCache.list;
  }
  try {
    const list = await getSpotSymbols();
    symbolListCache = { list, ts: Date.now() };
    return list;
  } catch {
    return TRADABLE_SYMBOLS;
  }
}

export function normalizeSymbol(raw, fallback = "BTCUSDT") {
  if (!raw || typeof raw !== "string") return fallback;
  const sym = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9]{2,20}USDT$/.test(sym)) return fallback;
  return sym;
}

export function coinToSymbol(coin) {
  const c = String(coin || "")
    .toUpperCase()
    .replace(/USDT$/i, "")
    .trim();
  if (!c) return "BTCUSDT";
  return `${c}USDT`;
}

export function baseCoinFromSymbol(symbol) {
  return String(symbol || "BTCUSDT")
    .replace(/USDT$/i, "")
    .toUpperCase();
}

/** 同步快速匹配（无 API） */
export function resolveSymbolFromTextSync(text, fallback = null) {
  if (!text) return fallback;

  const explicit = text.match(/([A-Za-z0-9]{2,20})USDT/i);
  if (explicit) return explicit[0].toUpperCase();

  for (const [cn, coin] of Object.entries(CHINESE_TO_COIN)) {
    if (text.includes(cn)) return coinToSymbol(coin);
  }

  const upper = text.toUpperCase();
  const tickers = [
    "WIF", "BONK", "PEPE", "SHIB", "FLOKI", "RENDER", "FET", "NEAR", "APT", "SUI",
    "ARB", "OP", "TIA", "INJ", "SEI", "STX", "IMX", "GRT", "RUNE", "AAVE", "MATIC",
    "AVAX", "LINK", "UNI", "ATOM", "FIL", "DOT", "ADA", "DOGE", "XRP", "LTC", "BCH",
    "BNB", "SOL", "ETH", "BTC",
  ];
  for (const coin of tickers) {
    const re = new RegExp(`(?:^|[\\s，,、：:])${coin}(?:USDT)?(?:[\\s，,、]|$)`, "i");
    if (re.test(text) || new RegExp(`\\b${coin}\\b`, "i").test(upper)) {
      return coinToSymbol(coin);
    }
  }
  if (/BTC|比特币/i.test(text)) return "BTCUSDT";
  if (/ETH/i.test(text)) return "ETHUSDT";

  return fallback;
}

/** 异步：在 Bitget 在线交易对中校验/补全 */
export async function resolveSymbolFromText(text, fallback = "BTCUSDT") {
  const spotSymbols = await getCachedSpotSymbols();
  const set = new Set(spotSymbols);

  const sync = resolveSymbolFromTextSync(text, null);
  if (sync && set.has(sync)) return sync;

  const upper = text.toUpperCase();
  for (const sym of spotSymbols) {
    const coin = sym.replace("USDT", "");
    if (upper.includes(sym)) return sym;
    if (coinInTextPattern(coin).test(text)) return sym;
  }

  if (sync && /^[A-Z0-9]{2,20}USDT$/.test(sync)) return sync;

  const fromStrategy = extractCoinFromStrategyText(text);
  if (fromStrategy) return fromStrategy;

  return normalizeSymbol(fallback);
}

function coinInTextPattern(coin) {
  return new RegExp(`(?<![A-Z0-9])${coin}(?:USDT)?(?![A-Z0-9])`, "i");
}
export function extractScanSymbolFromText(text) {
  if (!text?.trim()) return null;
  const t = text.trim();

  for (const [cn, coin] of Object.entries(CHINESE_TO_COIN)) {
    if (t.includes(cn) && /扫描|信号|分析/.test(t)) return coinToSymbol(coin);
  }

  const explicit = t.match(/([A-Za-z0-9]{2,20})USDT/i);
  if (explicit) return explicit[0].toUpperCase();

  const scanLead = t.match(/^扫描\s*([A-Za-z0-9]{2,15})(?:\s|$|信号|的)/i);
  if (scanLead) return coinToSymbol(scanLead[1]);

  const scanTail = t.match(/([A-Za-z0-9]{2,15})\s*信号(?:扫描)?/i);
  if (scanTail && /扫描|信号/.test(t)) return coinToSymbol(scanTail[1]);

  const afterSignal = t.match(/信号扫描\s*([A-Za-z0-9]{2,15})/i);
  if (afterSignal) return coinToSymbol(afterSignal[1]);

  if (/全面分析|市场分析/.test(t)) {
    return resolveSymbolFromTextSync(text, null);
  }

  return null;
}

/** 解析扫描目标 symbol（全 Bitget USDT 现货对） */
export async function resolveScanSymbol(text, fallback = "BTCUSDT") {
  const t = (text || "").trim();
  if (/^扫描\s*$/i.test(t)) return normalizeSymbol(fallback);

  const sync = extractScanSymbolFromText(t);
  if (sync) {
    const list = await getCachedSpotSymbols();
    if (!list.length || list.includes(sync)) return sync;
    if (/^[A-Z0-9]{2,20}USDT$/.test(sync)) return sync;
  }

  const mentioned = await extractMentionedSymbolAsync(t);
  if (mentioned) return mentioned;

  return normalizeSymbol(fallback);
}

/** 从策略相关语句中提取币种（不依赖 API 列表） */
export function extractCoinFromStrategyText(text) {
  if (!text?.trim()) return null;

  const explicit = text.match(/([A-Za-z0-9]{2,20})USDT/i);
  if (explicit) return explicit[0].toUpperCase();

  const resymbol = text.match(/(?:换成|换到|把策略换成|策略换到|应用到)\s*([A-Za-z0-9]{2,15})/i);
  if (resymbol) return coinToSymbol(resymbol[1]);

  const lead = text.match(/(?:^|[\s，,])([A-Za-z0-9]{2,15})\s*(?:突破|网格|套利|趋势)/i);
  if (lead) return coinToSymbol(lead[1]);

  return null;
}

/** 从文本中提取提到的交易对；未提到则返回 null（用于策略解析，避免误改 symbol） */
export async function extractMentionedSymbolAsync(text) {
  if (!text?.trim()) return null;

  const spotSymbols = await getCachedSpotSymbols();
  const upper = text.toUpperCase();

  const explicit = text.match(/([A-Za-z0-9]{2,20})USDT/i);
  if (explicit) {
    const sym = explicit[0].toUpperCase();
    if (!spotSymbols.length || spotSymbols.includes(sym)) return sym;
  }

  const sync = resolveSymbolFromTextSync(text, null);
  if (sync && (!spotSymbols.length || spotSymbols.includes(sync))) return sync;

  const sorted = [...spotSymbols].sort(
    (a, b) => b.replace("USDT", "").length - a.replace("USDT", "").length
  );
  for (const sym of sorted) {
    const coin = sym.replace("USDT", "");
    if (upper.includes(sym)) return sym;
    if (coinInTextPattern(coin).test(text)) return sym;
  }

  if (sync && /^[A-Z0-9]{2,20}USDT$/.test(sync)) return sync;

  return extractCoinFromStrategyText(text);
}

/** 自主执行一轮：从文本/持仓/策略推断交易对（默认不强制 BTC） */
export async function resolveAutonomousRoundSymbol(text, previousStrategy = null, accountLoader = null) {
  const mentioned = await extractMentionedSymbolAsync(text);
  if (mentioned) return mentioned;

  if (previousStrategy?.symbol) {
    return normalizeSymbol(previousStrategy.symbol, "ETHUSDT");
  }

  if (accountLoader) {
    try {
      const acct = await accountLoader();
      const spot = (acct?.spotAssets || [])
        .filter((a) => a.coin && a.coin !== "USDT" && Number(a.usdValue || 0) >= 5)
        .sort((a, b) => Number(b.usdValue || 0) - Number(a.usdValue || 0));
      if (spot.length) return coinToSymbol(spot[0].coin);

      const fut = (acct?.futuresPositions || []).find(
        (p) => Number(p.total || p.size || p.available || 0) > 0
      );
      if (fut?.symbol) return normalizeSymbol(fut.symbol, "ETHUSDT");
    } catch {
      /* ignore */
    }
  }

  const ROTATION = [
    "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT",
    "AVAXUSDT", "LINKUSDT", "ADAUSDT", "SUIUSDT", "ARBUSDT",
  ];
  return ROTATION[Math.floor(Date.now() / 7200000) % ROTATION.length];
}

/** 从账户持仓推断可交易 symbol 列表 */
export function symbolsFromHoldings(spotAssets = []) {
  const syms = new Set();
  for (const a of spotAssets) {
    if (a.coin && a.coin !== "USDT") syms.add(coinToSymbol(a.coin));
  }
  return [...syms];
}

export function formatOrderQty(qty, decimals = 6) {
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) return "0";
  return n.toFixed(decimals).replace(/\.?0+$/, "") || n.toFixed(decimals);
}
