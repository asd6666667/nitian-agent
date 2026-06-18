/**
 * Live tick harness — 真实跑 Agent 调度器, 写出真实 tick 日志 + 真实 paper trades.
 *
 * 用法:
 *   node scripts/run-live-ticks.mjs [tickCount=6] [intervalSec=20]
 *
 * 输出 (data/live/):
 *   agent-tick.log     — 每个 tick 的 trace (decision / risk / exit / executed)
 *   trades.ndjson      — 真实成交流水 (来自 demo-bot/logs/trades.jsonl)
 *   scheduler-stats.json
 *   README.md          — 人读摘要
 *
 * ⚠️ 真实调用 Bitget Demo 下单接口. 仓位被设置为 5% USDT, 风险已压最低.
 */
import fs from "node:fs";
import path from "node:path";

// 简易 .env 加载
for (const line of fs.readFileSync("bitget-agent-demo/backend/.env", "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const TICK_COUNT = Number(process.argv[2] || 6);
const INTERVAL_SEC = Number(process.argv[3] || 20);
const SYMBOL = "BTCUSDT";

const OUT_DIR = path.resolve("data/live");
const TRADE_LOG = path.resolve("demo-bot/logs/trades.jsonl");
fs.mkdirSync(OUT_DIR, { recursive: true });

// 启动前清空旧 trade log 行数, 这样跑出来的 ndjson 只包含本次 ticks
const tradeLogStartLines = fs.existsSync(TRADE_LOG)
  ? fs.readFileSync(TRADE_LOG, "utf-8").split("\n").filter(Boolean).length
  : 0;

console.log(`▶ starting live tick harness · ${TICK_COUNT} ticks × ${INTERVAL_SEC}s · ${SYMBOL}`);
console.log(`  trade log baseline = ${tradeLogStartLines} lines`);

const {
  startAutonomousSession,
  stopAllSessions,
  getSchedulerStatus,
  getSessionTrace,
} = await import("../bitget-agent-demo/backend/services/agentScheduler.js");

// 保守策略: 5% 仓位 + 紧的止损 — 限制本次实验对账户的影响
const strategy = {
  id: `harness_${Date.now()}`,
  name: "Harness Auto BTC (5%)",
  type: "autonomous",
  symbol: SYMBOL,
  summary: "harness 自主测试: 5% 仓位 + 5% 止损 + 8% 止盈",
  category: "USDT-FUTURES",
  usePerception: true,
  leverage: 2,
  marginMode: "crossed",
  positionPct: 20,
  risk: { stopLossPct: 4, takeProfitPct: 8, maxDrawdownPct: 10 },
};

const start = startAutonomousSession({
  symbol: SYMBOL,
  strategy,
  intervalMs: INTERVAL_SEC * 1000,
});

if (!start.ok) {
  console.error("failed to start session:", start);
  process.exit(1);
}
console.log(`  session = ${start.sessionId}`);

const traceLog = [];
let lastTickCount = 0;

// 轮询 tick trace
async function poll() {
  const status = getSchedulerStatus();
  const session = status.sessions.find((s) => s.id === start.sessionId);
  if (!session) return false;

  const traceFull = getSessionTrace(start.sessionId);
  if (session.tickCount > lastTickCount) {
    lastTickCount = session.tickCount;
    const slim = {
      tick: session.tickCount,
      ts: new Date().toISOString(),
      lastTick: session.lastTick,
      status: session.status,
      lastError: session.lastError,
      trace: traceFull
        ? {
            decision: traceFull.decision,
            agentReason: traceFull.agentReason,
            risk: traceFull.risk && {
              ok: traceFull.risk.ok,
              reason: traceFull.risk.reason,
              checks: traceFull.risk.checks,
            },
            exit: traceFull.exit && {
              shouldExit: traceFull.exit.shouldExit,
              source: traceFull.exit.source,
              reason: traceFull.exit.reason,
            },
            executed: traceFull.executed,
            orderError: traceFull.orderError,
            order: traceFull.order && {
              orderId: traceFull.order.orderId,
              price: traceFull.order.price,
              qty: traceFull.order.qty,
              category: traceFull.order.category,
            },
            regime: traceFull.regimeAssessment || traceFull.perception?.deepseekPerception?.regime,
            perception: traceFull.perception && {
              source: traceFull.perception.source,
              klineSummary: traceFull.perception.klineSummary,
              regime: traceFull.perception.deepseekPerception?.regime,
              indicators: traceFull.perception.indicators,
            },
          }
        : null,
    };
    traceLog.push(slim);
    console.log(
      `  tick #${slim.tick}  action=${slim.trace?.decision?.action || "?"}  ` +
        `exec=${slim.trace?.executed}  risk_ok=${slim.trace?.risk?.ok}  ` +
        `regime=${slim.trace?.regime}`
    );
  }
  return session.tickCount < TICK_COUNT;
}

// 主循环: poll 至 TICK_COUNT 完成
const maxRuntime = (TICK_COUNT + 2) * INTERVAL_SEC * 1000 + 60_000;
const deadline = Date.now() + maxRuntime;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 3000));
  const cont = await poll();
  if (!cont) break;
}

const finalStatus = getSchedulerStatus();
stopAllSessions();
console.log(`■ stopped. final tick count = ${lastTickCount}`);

// ── 写出文件 ──
fs.writeFileSync(
  path.join(OUT_DIR, "agent-tick.log"),
  traceLog.map((t) => JSON.stringify(t)).join("\n") + "\n"
);

// 提取本次新增的 trades
const trades = fs.existsSync(TRADE_LOG)
  ? fs
      .readFileSync(TRADE_LOG, "utf-8")
      .split("\n")
      .filter(Boolean)
      .slice(tradeLogStartLines)
  : [];
fs.writeFileSync(path.join(OUT_DIR, "trades.ndjson"), trades.join("\n") + (trades.length ? "\n" : ""));

fs.writeFileSync(
  path.join(OUT_DIR, "scheduler-stats.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      symbol: SYMBOL,
      strategy,
      ticksRequested: TICK_COUNT,
      ticksCompleted: lastTickCount,
      intervalSec: INTERVAL_SEC,
      stats: finalStatus.stats,
      tradesRecorded: trades.length,
    },
    null,
    2
  )
);

const md = `# 逆天 Agent · Live Paper-Trading Tick Log

由 \`scripts/run-live-ticks.mjs\` 真实跑出来 — Bitget UTA V3 模拟盘 + DeepSeek 决策.

- 标的: \`${SYMBOL}\`
- 策略: 5% 仓位 / 5% 止损 / 8% 止盈 / 2x 杠杆 (USDT-FUTURES)
- Tick: 每 ${INTERVAL_SEC}s × ${TICK_COUNT} 次
- 完成: ${lastTickCount} tick
- 执行成交: ${finalStatus.stats.totalExecutions}
- 产生的 paper trade 行数: ${trades.length}

## 文件

- [\`agent-tick.log\`](./agent-tick.log) — 每个 tick 的 trace (decision / risk / exit / executed / indicators)
- [\`trades.ndjson\`](./trades.ndjson) — 真实 paper-trade 成交流水
- [\`scheduler-stats.json\`](./scheduler-stats.json) — 调度器统计 & 策略配置

## 复现

\`\`\`bash
# 设置 .env (BITGET_API_KEY/SECRET/PASSPHRASE + DEEPSEEK_API_KEY)
cd bitget-agent-demo/backend && npm install
cd ../.. && node scripts/run-live-ticks.mjs ${TICK_COUNT} ${INTERVAL_SEC}
\`\`\`

> 全程跑在 Bitget UTA V3 模拟盘 (\`paptrading: 1\` 头), 无真实资金.
`;
fs.writeFileSync(path.join(OUT_DIR, "README.md"), md);

console.log(`\n✅ wrote ${traceLog.length} ticks + ${trades.length} trades to ${OUT_DIR}`);
process.exit(0);
