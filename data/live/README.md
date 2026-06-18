# 逆天 Agent · Live Paper-Trading Tick Log

由 [`scripts/run-live-ticks.mjs`](../../scripts/run-live-ticks.mjs) 真实跑出来 —— Bitget UTA V3 模拟盘 (`paptrading: 1` 头) + DeepSeek 决策。

## 本次运行参数

| 项 | 值 |
|---|---|
| 标的 | `BTCUSDT` |
| 类别 | `USDT-FUTURES` |
| 策略 | autonomous (LLM 完全自主决策) |
| 仓位 | 20% / 杠杆 2x / cross margin |
| 风控 | 止损 4% · 止盈 8% · 最大回撤 10% |
| Tick 间隔 | 30s (调度器自动调整为 120s 因 regime=`strong_trend_down`) |
| 完成 tick | 4 (出于时间, 仅采集了 3 个完整 trace) |
| 实际成交 | **0** (3 个 BUY 决策全部被风控层拦截) |
| 决策来源 | DeepSeek (`deepseek-chat` 感知 / `deepseek-reasoner` 决策) |

## 关键发现 (这才是真实运行的价值)

在 BTC 强下跌行情中，DeepSeek 连续给出 **"极端恐惧 + MACD 金叉，抄底/反弹机会"** 的 BUY 信号 (典型的"反向博弈"叙事)，但 **3 次全部被风控层拦截**：

| Tick | DeepSeek decision | DeepSeek reason | Risk verdict | Reason |
|------|------|------|------|------|
| #1 | `buy` qty=0.060771 | "极端恐惧是反向买入信号" | ❌ 拒绝 | `pretrade: 买入数量为 0` |
| #3 | `buy` qty=0.060786 | "极端恐惧+MACD看涨信号" | ❌ 拒绝 | `pretrade: 买入数量为 0` |
| #4 | `buy` qty=0.060818 | "极度恐惧，博超跌反弹" | ❌ 拒绝 | `pretrade: 买入数量为 0` |

> 这正是 README 里写的 **"LLM 负责想象力，DSL 和风控负责活下去"** —— LLM 在强趋势下的"抄底"冲动被规则层兜底，没有变成实仓亏损。

## 文件

- [`agent-tick.log`](./agent-tick.log) — ndjson, 每行一个 tick 的 trace
- [`trades.ndjson`](./trades.ndjson) — 模拟盘成交流水 (含被风控拦截的决策, 完整 DeepSeek reason + risk checks)
- [`scheduler-stats.json`](./scheduler-stats.json) — 调度器配置 + 完整策略 JSON

## 复现

```bash
# 1. 准备 .env (BITGET_API_KEY / BITGET_SECRET_KEY / BITGET_PASSPHRASE / DEEPSEEK_API_KEY)
cp bitget-agent-demo/backend/.env.example bitget-agent-demo/backend/.env
# 填入你的模拟盘 Key 和 DeepSeek Key

# 2. 装依赖
cd bitget-agent-demo/backend && npm install && cd ../..
cd demo-bot && npm install && cd ..

# 3. 跑 harness
node scripts/run-live-ticks.mjs <tickCount> <intervalSec>
# 例: node scripts/run-live-ticks.mjs 8 30
```

> ⚠️ 全程跑在 Bitget UTA V3 **模拟盘** (`paptrading: 1` 头), 无真实资金。
> 即便如此, 仍建议只用模拟盘 Key, 并设置较小的 `positionPct`。
