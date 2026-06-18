# 逆天 Agent · 回测报告

> 用仓库内 `bitget-agent-demo/backend/services/backtest.js` + `indicators.js` 在 **真实 Bitget 现货 1h K 线** 上跑出来的结果。
>
> Harness 脚本: [`../../scripts/run-backtest.mjs`](../../scripts/run-backtest.mjs)

- 数据源: `https://api.bitget.com/api/v2/spot/market/candles` (公开接口, 无需 API Key)
- 区间: 最近约 2000 根 1h K 线 / 每个标的
- 初始资金: 10,000 USDT (per backtest)
- 生成时间: 2026-06-18T11:05:32.394Z

## 汇总

| Symbol | Strategy | Trades | Total Return | Buy&Hold | Max DD | Win Rate | Sharpe |
|--------|----------|-------:|-------------:|---------:|-------:|---------:|-------:|
| BTCUSDT | `trend-ma20-vol1.5` | 40 | -3.27% | -19.75% | 4.25% | 25% | -0.57 |
| BTCUSDT | `sar-macd-trend` | 106 | -4.03% | -19.75% | 4.79% | 50.9% | -0.76 |
| ETHUSDT | `trend-ma20-vol1.5` | 44 | -6.31% | -23.75% | 7.33% | 22.7% | -0.81 |
| ETHUSDT | `sar-macd-trend` | 78 | -2.22% | -23.75% | 4.29% | 41% | -0.29 |
| SOLUSDT | `trend-ma20-vol1.5` | 46 | -0.87% | -18.96% | 4.18% | 34.8% | -0.09 |
| SOLUSDT | `sar-macd-trend` | 80 | -1.59% | -18.96% | 4.4% | 42.5% | -0.19 |

## 文件说明

每个策略产出两个文件:

- `<symbol>-<strategy>-1h.json` — 完整结果 (metrics + trades + 采样后的 equity curve + signals 计数)
- `<symbol>-<strategy>-1h.trades.csv` — 仅成交流水, 可直接 Excel 打开

## 复现命令

```bash
git clone https://github.com/asd6666667/nitian-agent.git
cd nitian-agent
node scripts/run-backtest.mjs
```

无需 `.env`, 无需 npm install (脚本仅依赖 Node 20+ 内置 fetch).
