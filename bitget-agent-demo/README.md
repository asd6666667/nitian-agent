# Bitget Agent Hub · AI Trading Agent Demo

> Bitget Hackathon 赛道一 — 全链路 AI 交易 Agent 演示（模拟交易，无真实资金）

[![Node](https://img.shields.io/badge/Node-%3E%3D18-green)]()
[![React](https://img.shields.io/badge/React-18-blue)]()
[![License](https://img.shields.io/badge/License-MIT-lightgrey)]()

## 项目介绍

本项目是一个可直接部署的 **Bitget Agent Hub 交易 Agent Demo**，展示从自然语言策略描述到回测、模拟交易、风控预警的完整闭环：

```
感知层 → 决策层 → 执行层 → 风控层 → 复盘层
```

- **感知层**：接入 Bitget Agent Hub 模拟数据模块（优先 Bitget 公开 API，离线时本地模拟 K 线）
- **决策层**：自然语言解析为结构化策略（趋势 / 网格 / 套利）
- **执行层**：模拟订单撮合、持仓更新、实时日志
- **风控层**：止盈、止损、仓位控制、最大回撤自动暂停
- **复盘层**：收益曲线、胜率、夏普比率、交易明细、策略迭代对比

## 功能演示

| 功能 | 说明 |
|------|------|
| 自然语言策略 | 「当BTC突破20日均线且成交量放大1.5倍时…」自动解析参数 |
| 策略迭代 | 对话修改参数，自动重新回测并对比前后表现 |
| 预设策略 | 趋势跟踪 / 网格交易 / 套利策略，一键加载 |
| K 线信号 | 买卖点 + MA 均线叠加 |
| 回测仪表盘 | 核心指标、收益/回撤曲线、交易分布 |
| 模拟交易 | 实时 tick、订单列表、风控预警 |
| 导入/导出 | JSON 策略配置保存与分享 |

## 技术架构

```
bitget-agent-demo/
├── backend/                 # Node.js + Express API
│   ├── server.js            # 路由入口
│   └── services/
│       ├── bitgetHub.js     # Agent Hub 集成层
│       ├── marketData.js    # 感知层 · 行情数据
│       ├── intentParser.js  # 决策层 · NL 解析
│       ├── backtest.js      # 复盘层 · 回测引擎
│       └── paperTrading.js  # 执行层 + 风控层
└── frontend/                # React + Vite + Tailwind + Recharts
    └── src/components/      # 对话、K线、仪表盘、模拟面板
```

### 与 Bitget Agent Hub 的集成点

| 端点 | 模块 | 说明 |
|------|------|------|
| `GET /api/hub/health` | Hub 健康检查 | Bitget 连接状态 + 5 感知 Skill |
| `GET /api/hub/market/:symbol` | 感知层 | Bitget K 线 + RSI/趋势 + 综合评分 |
| `GET /api/hub/perception/:symbol` | **感知 Skill** | 5 大 Skill 聚合（见下表） |
| `GET /api/hub/sentiment` | 情绪指数 | F&G + 资金费率 + OI + L/S |
| `GET /api/bitget/account` | **Bitget Paper** | UTA V3 模拟账户余额 |
| `POST /api/strategy/parse` | 决策层 | NL → 结构化策略 |
| `POST /api/backtest/run` | 复盘层 | 回测 + 策略对比 |
| `POST /api/paper/:id/tick` | 执行层 | 本地模拟 **或 Bitget Paper 真实下单** |

#### 已集成的 5 大感知 Skill

| Skill | 数据来源 | Demo 输出 |
|-------|---------|-----------|
| `technical-analysis` | Bitget K 线 | RSI、MA5/MA20、趋势、突破信号 |
| `sentiment-analyst` | Bitget 衍生品 + F&G | 恐惧贪婪、资金费率、OI、L/S 比 |
| `market-intel` | CoinGecko | 总市值、BTC 占比、24h 变化 |
| `news-briefing` | RSS 聚合 | Cointelegraph / CoinDesk 头条 |
| `macro-analyst` | Yahoo Finance | 美国 10 年期国债收益率 |

#### Bitget Paper Trading 配置

复制 `backend/.env.example` → `backend/.env`，填入 Demo API Key（与 Cursor MCP `bitget` 相同）：

```env
BITGET_API_KEY=bg_xxx
BITGET_SECRET_KEY=xxx
BITGET_PASSPHRASE=xxx
HTTP_PROXY=http://127.0.0.1:7897   # 国内需代理
```

配置后：
- 执行层自动走 **UTA V3 Paper Trading**（`paptrading: 1`）
- 感知层优先拉取 **Bitget 真实 K 线 / 衍生品数据**
- 未配置时降级为本地模拟，不影响 Demo 演示

与 [Bitget Agent Hub](https://github.com/Bitget-AI/agent_hub) 的关系：

- 后端内置 **`bitget-core`**（与 `bitget-mcp-server` / `bgc` CLI **同源 58+ 工具**），加载全模块：`spot · futures · account · margin · copytrading · convert · earn · p2p · broker`
- **Skill Hub**（`bitget-skill-hub` npm）五类感知 Skill：技术 / 情绪 / 情报 / 新闻 / 宏观 — K 线与衍生品数据优先走 `bitget-core` 市场工具
- Agent 链路：感知 → 决策（统一感知门禁）→ 风控 → **bitget-core 执行** → 退出
- API：`GET /api/hub/capabilities` · `GET /api/hub/tools` · `POST /api/hub/tools/:toolName`
- 无需在 Web 应用中单独启动 MCP；配置 Demo Key 后 Agent Hub 自动就绪

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 本地运行

```bash
cd bitget-agent-demo
npm run install:all
npm run dev
```

- 前端：http://localhost:5173
- 后端 API：http://localhost:3001

### 生产构建

```bash
npm run build        # 构建前端
npm start            # 启动后端（托管 frontend/dist 静态文件）
```

## 部署

### 方案 A：Render（推荐 · 单服务）

1. 推送代码到 GitHub
2. Render → New Web Service → 连接仓库
3. 使用根目录 `render.yaml` 或手动配置：
   - **Build Command**: `npm run install:all && npm run build`
   - **Start Command**: `npm start`
   - **Environment**: `NODE_VERSION=20`

### 方案 B：Vercel 前端 + Render 后端

**Vercel（前端）**
- Root Directory: `frontend`
- Build: `npm run build`
- 环境变量: `VITE_API_URL=https://your-backend.onrender.com`

**Render（后端）**
- Root Directory: `backend`
- Start: `npm start`

### 环境变量

复制 `.env.example` 为 `backend/.env`：

```env
PORT=3001
# 可选：如需通过代理访问 Bitget API
# HTTP_PROXY=http://127.0.0.1:7897
# HTTPS_PROXY=http://127.0.0.1:7897
```

> ⚠️ 切勿将 API Key 提交到 Git。Demo 使用公开行情 + 本地模拟，无需密钥。

## 使用示例

### 1. 加载预设策略

打开页面 → 点击「趋势跟踪 · BTC 突破」→ 自动回测

### 2. 自然语言创建策略

在策略对话中输入：

```
当BTC突破20日均线且成交量放大1.5倍时，买入50%仓位，设置3%止盈和2%止损，回撤超过5%时暂停交易
```

### 3. 迭代优化

```
把止盈改成5%，仓位改成30%
```

系统自动重新回测，并展示 **策略迭代对比**（收益、胜率、回撤、夏普 Δ）。

### 4. 模拟交易

加载策略 → 切换到「模拟交易」→ 点击「启动模拟」→ 观察订单与风控日志

### 5. 导出/分享

点击「导出策略」保存 JSON → 分享给他人 → 对方「导入策略」即可复现

## API 参考

```bash
# Hub 健康检查
curl http://localhost:3001/api/hub/health

# 解析策略
curl -X POST http://localhost:3001/api/strategy/parse \
  -H "Content-Type: application/json" \
  -d '{"message":"BTC突破20日均线买入50%"}'

# 运行回测
curl -X POST http://localhost:3001/api/backtest/run \
  -H "Content-Type: application/json" \
  -d '{"strategy":{"type":"trend","symbol":"BTCUSDT","positionPct":50,"conditions":{"maPeriod":20,"volumeMultiplier":1.5},"risk":{"takeProfitPct":3,"stopLossPct":2,"maxDrawdownPct":5}}}'
```

## 免责声明

本项目仅供 Hackathon 演示与 educational 用途。**所有交易均为模拟，不涉及真实资金。** 不构成任何投资建议。

## License

MIT
