import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findAsset,
  getAssets,
  getCandles,
  getTicker,
  getUnfilledOrders,
  placeSpotOrder,
} from "./bitget-v3.js";
import { checkRisk, getDailyTradeCount, todayKey } from "./risk.js";
import { ruleStrategy } from "./strategy.js";
import config from "./config.json" with { type: "json" };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, "logs");
const LOG_FILE = path.join(LOG_DIR, "trades.jsonl");

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function log(entry) {
  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(LOG_FILE, line);
  console.log(JSON.stringify(entry, null, 2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readDailyTrades() {
  if (!fs.existsSync(LOG_FILE)) return 0;
  const lines = fs.readFileSync(LOG_FILE, "utf8").trim().split("\n").filter(Boolean);
  return getDailyTradeCount(lines, todayKey());
}

async function executeDecision(decision, ticker, btcAvailable) {
  const lastPrice = Number(ticker.lastPr);
  const buffer = Number(config.limitPriceBuffer);

  if (decision.action === "buy") {
    return placeSpotOrder({
      symbol: config.symbol,
      side: "buy",
      orderType: "limit",
      qty: config.orderSizeBtc,
      price: String(Math.ceil(lastPrice * buffer)),
      timeInForce: "gtc",
    });
  }

  if (decision.action === "sell") {
    const sellQty = Math.min(Number(config.orderSizeBtc), Number(btcAvailable)).toFixed(6);
    return placeSpotOrder({
      symbol: config.symbol,
      side: "sell",
      orderType: "limit",
      qty: sellQty,
      price: String(Math.floor(lastPrice * (2 - buffer))),
      timeInForce: "gtc",
    });
  }

  return null;
}

export async function runOnce() {
  const ts = new Date().toISOString();
  console.log(`\n[${ts}] 开始一轮`);

  const [assets, ticker, candles, openOrders] = await Promise.all([
    getAssets(),
    getTicker(config.symbol),
    getCandles(config.symbol, config.candleGranularity, config.candleLimit),
    getUnfilledOrders(config.symbol),
  ]);

  const btc = findAsset(assets, "BTC");
  const usdt = findAsset(assets, "USDT");
  const btcAvailable = btc?.available ?? "0";
  const usdtAvailable = usdt?.available ?? "0";

  console.log(`BTC 可用: ${btcAvailable}, USDT 可用: ${usdtAvailable}, 现价: ${ticker.lastPr}`);

  if (openOrders.length > 0) {
    const entry = {
      ts,
      decision: { action: "hold", reason: `有 ${openOrders.length} 笔未成交挂单，跳过` },
      openOrders: openOrders.map((o) => ({
        orderId: o.orderId,
        side: o.side,
        price: o.price,
        qty: o.qty,
      })),
      executed: false,
    };
    log(entry);
    return entry;
  }

  const decision = ruleStrategy({
    candles,
    btcAvailable,
    lastPrice: Number(ticker.lastPr),
  });
  console.log("策略决策:", decision.reason);

  const risk = checkRisk({
    decision,
    config,
    usdtAvailable,
    btcAvailable,
    dailyTrades: readDailyTrades(),
  });

  if (!risk.ok) {
    const entry = { ts, decision, risk, executed: false };
    log(entry);
    return entry;
  }

  if (decision.action === "hold") {
    const entry = { ts, decision, executed: false };
    log(entry);
    return entry;
  }

  const order = await executeDecision(decision, ticker, btcAvailable);
  const entry = { ts, decision, order, executed: true };
  log(entry);
  return entry;
}

async function main() {
  const once = process.argv.includes("--once");
  console.log("Bitget 模拟盘自动交易启动 (统一账户 V3)");
  console.log(`交易对: ${config.symbol}, 间隔: ${config.intervalMinutes} 分钟`);

  if (once) {
    await runOnce();
    return;
  }

  while (true) {
    try {
      await runOnce();
    } catch (error) {
      console.error("本轮出错:", error.message);
      log({
        ts: new Date().toISOString(),
        error: error.message,
        executed: false,
      });
    }
    await sleep(config.intervalMinutes * 60 * 1000);
  }
}

main();
