/**
 * Harness: 用仓库里现成的 backtest.js + indicators.js 对真实 Bitget K 线跑回测。
 * 不修改任何源文件，只 import 调用其导出函数。
 *
 * 用法:
 *   node scripts/run-backtest.mjs
 *
 * 输出:
 *   data/backtest/<symbol>-<strategyType>-<granularity>.json
 *   data/backtest/<symbol>-<strategyType>-<granularity>.trades.csv
 *   data/backtest/README.md
 */
import fs from "node:fs/promises";
import path from "node:path";
import { runBacktest } from "../bitget-agent-demo/backend/services/backtest.js";

const OUT_DIR = path.resolve("data/backtest");

const KLINE_LIMIT = 1000;                 // 单页上限
const PAGES = 2;                          // 拉两页 ~= 2000 根
const GRANULARITY = "1h";
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

// 用仓库 DSL 的两个最有代表性的策略类型 (来自 backtest.js / generateSignals)
const STRATEGIES = [
  {
    id: "trend-ma20-vol1.5",
    type: "trend",
    description: "突破 MA20 + 量比≥1.5 开多; 跌破 MA20 平仓",
    positionPct: 40,
    conditions: { maPeriod: 20, volumeMultiplier: 1.5, breakoutAboveMa: true },
    risk: { takeProfitPct: 4, stopLossPct: 2, maxDrawdownPct: 15 },
  },
  {
    id: "sar-macd-trend",
    type: "sar_macd",
    description: "SAR 多头 + MACD 金叉 + 量能确认开多; 跌破 SAR / 触及近期高点止盈",
    positionPct: 40,
    conditions: { maPeriod: 20, recentHighLookback: 20, takeProfitPartialPct: 50 },
    risk: { takeProfitPct: 5, stopLossPct: 2.5, maxDrawdownPct: 15 },
  },
];

async function fetchCandles(symbol, granularity, limit, endTimeMs) {
  const params = new URLSearchParams({ symbol, granularity, limit: String(limit) });
  if (endTimeMs) params.set("endTime", String(endTimeMs));
  const url = `https://api.bitget.com/api/v2/spot/market/candles?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== "00000") throw new Error(`Bitget err: ${json.msg}`);
  // raw: [ts, open, high, low, close, baseVol, quoteVol, ...]
  return json.data.map((r) => ({
    time: Number(r[0]),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
  }));
}

async function fetchAllCandles(symbol) {
  const all = [];
  let endTime = undefined;
  for (let p = 0; p < PAGES; p++) {
    const page = await fetchCandles(symbol, GRANULARITY, KLINE_LIMIT, endTime);
    if (!page.length) break;
    all.unshift(...page);
    endTime = page[0].time - 1;
    await new Promise((r) => setTimeout(r, 250));
  }
  // 去重 + 升序
  const seen = new Set();
  const sorted = all
    .filter((c) => (seen.has(c.time) ? false : (seen.add(c.time), true)))
    .sort((a, b) => a.time - b.time);
  return sorted;
}

function summarize(candles) {
  const first = candles[0];
  const last = candles.at(-1);
  return {
    bars: candles.length,
    firstTime: new Date(first.time).toISOString(),
    lastTime: new Date(last.time).toISOString(),
    firstPrice: first.close,
    lastPrice: last.close,
    bnhReturnPct: +(((last.close - first.close) / first.close) * 100).toFixed(2),
  };
}

function tradesToCsv(trades) {
  const head = "id,side,time,price,qty,pnl,pnlPct,reason";
  const rows = trades.map((t) =>
    [
      t.id,
      t.side,
      new Date(t.time).toISOString(),
      t.price,
      t.qty,
      t.pnl ?? "",
      t.pnlPct ?? "",
      (t.reason || "").replace(/,/g, " "),
    ].join(",")
  );
  return [head, ...rows].join("\n");
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();
  const index = [];

  for (const symbol of SYMBOLS) {
    process.stdout.write(`\n[${symbol}] fetching candles… `);
    const candles = await fetchAllCandles(symbol);
    const sum = summarize(candles);
    console.log(`${sum.bars} bars  ${sum.firstTime} → ${sum.lastTime}  BNH=${sum.bnhReturnPct}%`);

    for (const strat of STRATEGIES) {
      const stratWithSymbol = { ...strat, symbol };
      const r = runBacktest(stratWithSymbol, candles, 10000);
      const slug = `${symbol.toLowerCase()}-${strat.id}-${GRANULARITY}`;
      const report = {
        meta: {
          generatedAt,
          source: "Bitget public spot klines",
          symbol,
          granularity: GRANULARITY,
          bars: candles.length,
          window: { from: sum.firstTime, to: sum.lastTime },
          buyAndHoldReturnPct: sum.bnhReturnPct,
        },
        strategy: stratWithSymbol,
        metrics: r.metrics,
        signalsCount: r.signals.length,
        tradesCount: r.trades.length,
        trades: r.trades,
        // equityCurve 较大: 只保留每 N 根的采样,避免文件过大
        equityCurveSampled: r.equityCurve.filter((_, i) => i % 10 === 0),
      };

      const jsonPath = path.join(OUT_DIR, `${slug}.json`);
      const csvPath = path.join(OUT_DIR, `${slug}.trades.csv`);
      await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));
      await fs.writeFile(csvPath, tradesToCsv(r.trades));

      console.log(
        `  ${strat.id.padEnd(22)} trades=${String(r.trades.length).padStart(3)} ` +
          `ret=${String(r.metrics.totalReturnPct).padStart(6)}% ` +
          `MDD=${String(r.metrics.maxDrawdownPct).padStart(5)}% ` +
          `WR=${String(r.metrics.winRate).padStart(5)}% ` +
          `Sharpe=${r.metrics.sharpeRatio}`
      );

      index.push({
        symbol,
        strategy: strat.id,
        metrics: r.metrics,
        bnhReturnPct: sum.bnhReturnPct,
        json: `./${path.basename(jsonPath)}`,
        csv: `./${path.basename(csvPath)}`,
      });
    }
  }

  // 总表
  await fs.writeFile(path.join(OUT_DIR, "index.json"), JSON.stringify({ generatedAt, results: index }, null, 2));

  // 人读 README
  const md = renderReadme(generatedAt, index);
  await fs.writeFile(path.join(OUT_DIR, "README.md"), md);
  console.log(`\n✅ wrote ${index.length} reports + index.json + README.md to ${OUT_DIR}`);
}

function renderReadme(generatedAt, rows) {
  const head =
    "| Symbol | Strategy | Trades | Total Return | Buy&Hold | Max DD | Win Rate | Sharpe |\n" +
    "|--------|----------|-------:|-------------:|---------:|-------:|---------:|-------:|";
  const body = rows
    .map(
      (r) =>
        `| ${r.symbol} | \`${r.strategy}\` | ${r.metrics.totalTrades} | ${r.metrics.totalReturnPct}% | ${r.bnhReturnPct}% | ${r.metrics.maxDrawdownPct}% | ${r.metrics.winRate}% | ${r.metrics.sharpeRatio} |`
    )
    .join("\n");

  return `# 逆天 Agent · 回测报告

> 用仓库内 \`bitget-agent-demo/backend/services/backtest.js\` + \`indicators.js\` 在 **真实 Bitget 现货 1h K 线** 上跑出来的结果。
>
> Harness 脚本: [\`../../scripts/run-backtest.mjs\`](../../scripts/run-backtest.mjs)

- 数据源: \`https://api.bitget.com/api/v2/spot/market/candles\` (公开接口, 无需 API Key)
- 区间: 最近约 ${KLINE_LIMIT * PAGES} 根 ${GRANULARITY} K 线 / 每个标的
- 初始资金: 10,000 USDT (per backtest)
- 生成时间: ${generatedAt}

## 汇总

${head}
${body}

## 文件说明

每个策略产出两个文件:

- \`<symbol>-<strategy>-${GRANULARITY}.json\` — 完整结果 (metrics + trades + 采样后的 equity curve + signals 计数)
- \`<symbol>-<strategy>-${GRANULARITY}.trades.csv\` — 仅成交流水, 可直接 Excel 打开

## 复现命令

\`\`\`bash
git clone https://github.com/asd6666667/nitian-agent.git
cd nitian-agent
node scripts/run-backtest.mjs
\`\`\`

无需 \`.env\`, 无需 npm install (脚本仅依赖 Node 20+ 内置 fetch).
`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
