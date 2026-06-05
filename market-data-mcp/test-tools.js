process.env.NODE_USE_ENV_PROXY = "1";
process.env.HTTP_PROXY = process.env.HTTP_PROXY || "http://127.0.0.1:7897";
process.env.HTTPS_PROXY = process.env.HTTPS_PROXY || "http://127.0.0.1:7897";

import {
  yahooPrice,
  fetchJson,
  getRate,
  pearson,
  dailyReturns,
  yahooOhlcv,
  resolveSymbol,
} from "./lib/fetch.js";

const tests = [
  ["global_assets BTC", () => yahooPrice("BTC-USD")],
  ["Fear&Greed", () => fetchJson("https://api.alternative.me/fng/?limit=1")],
  ["CoinGecko", () => fetchJson("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd")],
  ["rates t10y", () => getRate("t10y")],
  ["DeFiLlama", () => fetchJson("https://api.llama.fi/protocols").then((d) => d.slice(0, 2))],
  ["Bitget OI", () => fetchJson("https://api.bitget.com/api/v2/mix/market/open-interest?symbol=BTCUSDT&productType=USDT-FUTURES")],
  ["cross_asset", async () => {
    const b = await yahooOhlcv(resolveSymbol("btc"), "90d");
    const g = await yahooOhlcv(resolveSymbol("gold"), "90d");
    return pearson(
      dailyReturns(b.rows.map((r) => r.close)),
      dailyReturns(g.rows.map((r) => r.close))
    );
  }],
];

for (const [name, fn] of tests) {
  try {
    const result = await fn();
    console.log(`✓ ${name}:`, JSON.stringify(result).slice(0, 120));
  } catch (e) {
    console.log(`✗ ${name}:`, e.message);
  }
}
