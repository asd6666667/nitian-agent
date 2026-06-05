/**
 * Bitget 模拟盘（paptrading）可交易对校验
 * 公开行情支持全币种，但 V3 下单接口仅部分交易对可用
 */
import { getUnfilledOrders } from "../../../demo-bot/bitget-v3.js";
import { isSimApiConfigured } from "./simulationApi.js";
import { normalizeSymbol } from "./symbolUtils.js";

/** 已探测可用的模拟盘交易对（探测结果缓存） */
const KNOWN_DEMO_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT"];

const cache = { valid: new Set(KNOWN_DEMO_SYMBOLS), invalid: new Set() };

export function getKnownDemoSymbols() {
  return [...cache.valid];
}

export async function isDemoTradableSymbol(symbol) {
  if (!isSimApiConfigured()) return true;
  const sym = normalizeSymbol(symbol, "");
  if (!sym) return false;
  if (cache.valid.has(sym)) return true;
  if (cache.invalid.has(sym)) return false;

  try {
    await getUnfilledOrders(sym);
    cache.valid.add(sym);
    return true;
  } catch (e) {
    if (/40034|does not exist|不存在/i.test(e.message)) {
      cache.invalid.add(sym);
      return false;
    }
    throw e;
  }
}

export async function assertDemoTradable(symbol) {
  const sym = normalizeSymbol(symbol);
  if (!(await isDemoTradableSymbol(sym))) {
    const list = getKnownDemoSymbols().map((s) => s.replace("USDT", "")).join(" / ");
    throw new Error(
      `Bitget 模拟盘暂不支持 ${sym} 下单（公开行情可查，模拟交易仅开放部分币种）。` +
        ` 当前可用：${list}。请换用上述币种或实盘 API。`
    );
  }
  return sym;
}
