/**
 * 自主 Agent 调度器
 * 
 * 让 agent 自动循环运行（感知 → 思考 → 决策 → 执行）
 * 无需用户手动触发 tick
 * 
 * 每个 symbol+strategy 为一个 session，各自独立调度
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, "../../agent-scheduler-state.json");

// ── 调度器状态 ──
const state = {
  enabled: false,
  sessions: new Map(),      // sessionId → { symbol, strategy, interval, timer, lastTick, status, config }
  globalConfig: {
    defaultIntervalMs: 300_000,  // 5 分钟
    minIntervalMs: 30_000,        // 最少 30 秒
    maxIntervalMs: 3_600_000,     // 最多 1 小时
    adaptiveInterval: true,       // 根据市场波动自动调整
  },
  stats: {
    totalTicks: 0,
    totalExecutions: 0,
    startedAt: null,
    lastTickAt: null,
  },
};

function saveStateFile() {
  try {
    const serializable = {
      enabled: state.enabled,
      globalConfig: state.globalConfig,
      stats: state.stats,
      sessions: Array.from(state.sessions.entries()).map(([id, s]) => ({
        id,
        symbol: s.symbol,
        strategy: s.strategy ? {
          name: s.name,
          type: s.type,
          symbol: s.symbol,
          summary: s.summary,
          positionPct: s.positionPct,
        } : null,
        interval: s.interval,
        lastTick: s.lastTick,
        status: s.status,
        tickCount: s.tickCount,
        config: s.config,
      })),
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(serializable, null, 2), "utf-8");
  } catch (e) {
    console.warn("[agentScheduler] 保存状态失败:", e.message);
  }
}

function loadStateFile() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      state.enabled = raw.enabled || false;
      state.stats = raw.stats || state.stats;
      state.globalConfig = { ...state.globalConfig, ...raw.globalConfig };
      // sessions 需要重新创建 timer，不在这里恢复 timer
      return raw.sessions || [];
    }
  } catch (e) {
    console.warn("[agentScheduler] 加载状态失败:", e.message);
  }
  return [];
}

// ── 核心 tick 逻辑（懒加载避免循环依赖） ──
async function autonomousTick(sessionId) {
  const session = state.sessions.get(sessionId);
  if (!session || !state.enabled) return;

  // 如果 session 被暂停、已完成、出错，跳过
  if (session.status !== "running") return;

  const symbol = session.symbol;
  const strategy = session.strategy;

  // 添加每 tick 总超时（30 秒）
  const TICK_TIMEOUT_MS = 30000;
  let tickTimedOut = false;
  const tickTimer = setTimeout(() => {
    tickTimedOut = true;
    console.warn(`[agentScheduler] Session ${sessionId} tick 超时（${TICK_TIMEOUT_MS}ms）`);
  }, TICK_TIMEOUT_MS);

  try {
    // 懒加载需要的模块
    const { gatherPerception } = await import("./perceptionSkills.js");
    const { fuseAgentDecision, evaluateAgentExit, applyExitToDecision, evaluateAgentRisk, buildAgentTrace } =
      await import("./tradingAgent.js");
    const { getAssets, findAsset } = await import("../../../demo-bot/bitget-v3.js");
    const { fetchPositionContext, isFuturesStrategy, buildTradeRecord } = await import(
      "./agentTradeExecution.js"
    );
    const { fetchBitgetSpotPrice, fetchBitgetFuturesPrice } = await import("./bitgetLivePrice.js");
    const { resolveLivePositionState, enrichDecisionQty } = await import("./strategyExecution.js");
    const { executeSimDecision, appendSimTradeLog } =
      await import("./simulationApi.js");
    const { recordTrade, getPerformanceSummary } = await import("./agentPerformanceMemory.js");

    if (tickTimedOut) { clearTimeout(tickTimer); return; }

    // ── Step 1: 获取市场数据 ──
    const useFuturesVenue = strategy && isFuturesStrategy(strategy);
    const [assets, live] = await Promise.all([
      getAssets(),
      useFuturesVenue ? fetchBitgetFuturesPrice(symbol) : fetchBitgetSpotPrice(symbol),
    ]);

    if (tickTimedOut) { clearTimeout(tickTimer); return; }

    const baseCoin = symbol.replace(/USDT$/i, "");
    const baseAsset = findAsset(assets, baseCoin);
    const usdt = findAsset(assets, "USDT");
    const baseAvailable = baseAsset?.available ?? "0";
    const usdtAvailable = usdt?.available ?? "0";
    const lastPrice = live.lastPrice;
    const posCtx = await fetchPositionContext(symbol, strategy);
    const livePos = resolveLivePositionState({
      symbol, strategy, posCtx, baseAvailable, lastPrice,
      sessionEntryPrice: Number(session.entryPrice || 0),
    });

    if (tickTimedOut) { clearTimeout(tickTimer); return; }

    const hasStrategyPosition = livePos.hasStrategyPosition;
    const hasWalletAsset = livePos.hasWalletAsset;

    // ── Step 2: 感知（有 8s 缓存，不会每次真实请求） ──
    const perception = await gatherPerception(symbol, { force: true });

    if (tickTimedOut) { clearTimeout(tickTimer); return; }

    // ── Step 3: 独立决策（无 strategySignal → v2 独立路径） ──
    const fused = await fuseAgentDecision(null, perception, strategy, {
      strategyHasPosition: hasStrategyPosition,
      walletHasAsset: hasWalletAsset,
      entryPrice: session.entryPrice || null,
      pnlPct: null,
      usdtAvailable,
    });

    let decision = { ...fused.decision };

    // ── Step 4 & 6: 退出 + 风控 并行执行（互相独立） ──
    const [exitEval, agentRisk] = await Promise.all([
      evaluateAgentExit({
        hasBase: hasStrategyPosition,
        entryPrice: session.entryPrice || 0,
        lastPrice,
        strategy,
        strategySignal: null,
        perception,
      }),
      evaluateAgentRisk({
        decision,
        strategy,
        accountState: { usdtAvailable, baseAvailable, lastPrice, hasBase: hasWalletAsset },
        sessionState: session.runtime || {},
        perception,
        config: { maxDailyTrades: 50 },
      }),
    ]);

    if (tickTimedOut) { clearTimeout(tickTimer); return; }

    const exitOverlay = applyExitToDecision(decision, exitEval, fused);
    decision = exitOverlay.decision;
    if (exitOverlay.exitApplied) {
      fused.decision = exitOverlay.decision;
      fused.agentReason = exitOverlay.fused?.agentReason || fused.agentReason;
    }

    // ── Step 5: 计算仓位大小 ──
    decision = enrichDecisionQty(decision, strategy, {
      usdtAvailable,
      baseAvailable: posCtx.longSize || posCtx.shortSize || Number(baseAvailable),
      lastPrice,
      posCtx,
    });

    if (tickTimedOut) { clearTimeout(tickTimer); return; }

    // ── Step 7: 执行 ──
    let order = null;
    let orderError = null;
    let executed = false;
    const ts = new Date().toISOString();

    if (agentRisk.ok && decision.action !== "hold") {
      try {
        order = await executeSimDecision(decision, symbol, { strict: true, strategy });
        executed = !!order?.orderId;
        if (!order?.orderId) {
          orderError = "交易所未返回 orderId";
        }
        if (executed) {
          state.stats.totalExecutions += 1;

          const useFut = order?.category === "USDT-FUTURES";
          const tradeLabel = order?.tradeLabel ||
            (decision.action === "buy"
              ? useFut ? "合约开多" : "现货买入"
              : useFut ? "合约平多" : "现货卖出");

          // 写入交易日志文件（trades.jsonl）
          appendSimTradeLog({
            ts,
            symbol,
            strategyType: strategy?.type || "autonomous",
            strategyName: strategy?.name,
            decision,
            order: order || null,
            orderError,
            executed: true,
            source: "trading-agent-scheduler",
            tradeType: order?.tradeType || null,
            tradeLabel,
            category: order?.category || "USDT-FUTURES",
            posSide: order?.posSide || null,
            qty: order?.qty || decision.qty,
            price: order?.price || lastPrice,
            agent: null,
          });

          // 记录入场/出场
          if (decision.action === "buy") {
            session.entryPrice = order.price || lastPrice;
            session.entryTime = Date.now();
          }
          if (decision.action === "sell") {
            const pnlPct = session.entryPrice
              ? ((lastPrice - session.entryPrice) / session.entryPrice) * 100
              : null;
            const duration = session.entryTime
              ? (Date.now() - session.entryTime) / 1000 / 60
              : null;
            recordTrade({
              strategyType: strategy?.type || "autonomous",
              strategyName: strategy?.name || "自主策略",
              symbol,
              entryPrice: session.entryPrice,
              exitPrice: order.price || lastPrice,
              pnlPct,
              regime: fused?.regimeAssessment || perception?.deepseekPerception?.regime || "unknown",
              duration,
              exitReason: exitEval?.source || "decision",
            });
            session.entryPrice = null;
            session.entryTime = null;
          }
        }
      } catch (e) {
        orderError = e.message;
      }
    }
    
    // 有实际交易或风控拦截才写日志
    if (executed || orderError || (!agentRisk.ok && decision.action !== "hold")) {
      appendSimTradeLog({
        ts,
        symbol,
        strategyType: strategy?.type || "autonomous",
        strategyName: strategy?.name,
        decision,
        order: order || null,
        orderError,
        executed,
        source: "trading-agent-scheduler",
        risk: agentRisk,
        tradeLabel: executed ? order?.tradeLabel || (decision.action === "buy" ? "买入" : "卖出") : null,
        category: order?.category || "USDT-FUTURES",
        qty: order?.qty || decision.qty,
        price: order?.price || lastPrice,
      });
    }

    const agentTrace = buildAgentTrace({
      perception,
      strategySignal: null,
      fused,
      risk: agentRisk,
      exit: exitEval,
      executed,
      order,
      orderError,
    });

    // ── 更新 session 统计 ──
    session.lastTick = Date.now();
    session.tickCount = (session.tickCount || 0) + 1;
    session.agentTrace = agentTrace;
    state.stats.totalTicks += 1;
    state.stats.lastTickAt = new Date().toISOString();
    clearTimeout(tickTimer);
    saveStateFile();

    // ── 自适应调整间隔 ──
    if (state.globalConfig.adaptiveInterval && perception?.deepseekPerception) {
      adjustSessionInterval(session, perception);
    }

  } catch (e) {
    clearTimeout(tickTimer);
    console.error(`[agentScheduler] Session ${sessionId} tick 失败:`, e.message);
    session.lastError = { time: new Date().toISOString(), error: e.message };
    session.lastTick = Date.now();

    // 即使 tick 失败也生成一个 trace，让前端能看到实际状态
    try {
      const { buildAgentTrace } = await import("./tradingAgent.js").catch(() => null);
      if (buildAgentTrace) {
        session.agentTrace = buildAgentTrace({
          perception: null,
          strategySignal: null,
          fused: { decision: { action: "hold", reason: `tick 失败: ${e.message}` }, agentReason: `执行出错: ${e.message}` },
          risk: { ok: false, reason: `执行出错: ${e.message}` },
          exit: { hasPosition: false, reason: "—" },
          executed: false,
          order: null,
          orderError: e.message,
        });
      }
    } catch { /* ignore */ }

    // 连续失败时指数退避（最多 30 分钟）
    session.consecutiveErrors = (session.consecutiveErrors || 0) + 1;
    if (session.consecutiveErrors > 3) {
      const backoffMs = Math.min(60000 * Math.pow(2, session.consecutiveErrors - 3), 1800000);
      session.interval = backoffMs;
      console.log(`[agentScheduler] ${session.symbol} 连续 ${session.consecutiveErrors} 次失败，退避至 ${(backoffMs/1000).toFixed(0)}s`);
    }

    saveStateFile();
  }
}

/** 根据市场波动自适应调整运行间隔 */
function adjustSessionInterval(session, perception) {
  const cfg = state.globalConfig;
  if (!cfg.adaptiveInterval) return;

  const regime = perception.deepseekPerception?.regime;
  const score = Math.abs(Number(perception.composite?.score ?? 0));

  let targetInterval = cfg.defaultIntervalMs;

  if (regime === "high_volatility" || regime === "breakout_setup") {
    targetInterval = 60_000;    // 1 分钟
  } else if (regime === "strong_trend_up" || regime === "strong_trend_down") {
    targetInterval = 120_000;   // 2 分钟
  } else if (regime === "ranging" || regime === "low_volatility") {
    targetInterval = 600_000;   // 10 分钟
  } else if (score > 0.6) {
    targetInterval = 120_000;   // 强烈信号
  }

  targetInterval = Math.max(cfg.minIntervalMs, Math.min(cfg.maxIntervalMs, targetInterval));

  if (targetInterval !== session.interval) {
    session.interval = targetInterval;
    // 重新设置 timer
    if (session.timer) {
      clearTimeout(session.timer);
    }
    session.timer = setTimeout(() => autonomousTick(session.id), session.interval);
    console.log(`[agentScheduler] ${session.symbol} 间隔调整为 ${(targetInterval / 1000).toFixed(0)}s (regime=${regime})`);
  }
}

// ── 公共 API ──

/**
 * 启动一个自主 session
 */
export function startAutonomousSession({ symbol, strategy, intervalMs, config } = {}) {
  const sym = (symbol || "BTCUSDT").toUpperCase();
  const sessionId = `${sym}_${Date.now()}`;

  if (state.sessions.has(sessionId)) {
    return { ok: false, error: "Session 已存在", sessionId };
  }

  // 如果没有传入策略，创建默认自主策略
  const defaultStrategy = strategy || {
    id: `auto_${sym}_${Date.now()}`,
    name: `Auto ${sym.replace("USDT", "")}`,
    type: "autonomous",
    symbol: sym,
    summary: "完全自主交易（DeepSeek 决策）",
    category: "USDT-FUTURES",
    usePerception: true,
    leverage: sym.includes("BTC") ? 3 : 2,
    marginMode: "crossed",
    positionPct: 30,
    risk: {
      stopLossPct: 5,
      takeProfitPct: 10,
      maxDrawdownPct: 15,
    },
  };

  const session = {
    id: sessionId,
    symbol: sym,
    strategy: defaultStrategy,
    name: defaultStrategy.name,
    type: defaultStrategy.type,
    summary: defaultStrategy.summary,
    interval: intervalMs || state.globalConfig.defaultIntervalMs,
    lastTick: null,
    status: "running",
    tickCount: 0,
    entryPrice: null,
    tickStart: null,
    timer: null,
    config: config || {},
    agentTrace: null,
    lastError: null,
    runtime: {},
  };

  state.sessions.set(sessionId, session);

  // 立即执行第一轮
  session.tickStart = Date.now();

  // 自动开始循环
  const loop = async () => {
    if (!state.enabled || session.status !== "running") return;
    await autonomousTick(sessionId);
    if (state.enabled && session.status === "running") {
      session.timer = setTimeout(loop, session.interval);
    }
  };

  state.enabled = true;
  if (!state.stats.startedAt) {
    state.stats.startedAt = new Date().toISOString();
  }

  // 启动循环
  session.timer = setTimeout(loop, 100); // 100ms 后跑第一轮
  saveStateFile();

  // 返回时移除 timer 避免循环引用
  const { timer: _, ...safeSession } = session;
  return { ok: true, sessionId, session: safeSession };
}

/**
 * 停止指定 session
 */
export function stopSession(sessionId) {
  const session = state.sessions.get(sessionId);
  if (!session) return { ok: false, error: "Session 不存在" };

  session.status = "stopped";
  if (session.timer) {
    clearTimeout(session.timer);
    session.timer = null;
  }
  saveStateFile();

  // 如果没有运行中的 session，关闭调度器
  const hasRunning = Array.from(state.sessions.values()).some((s) => s.status === "running");
  if (!hasRunning) {
    state.enabled = false;
  }

  return { ok: true };
}

/**
 * 停止所有 sessions
 */
export function stopAllSessions() {
  state.enabled = false;
  for (const [id, session] of state.sessions) {
    session.status = "stopped";
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }
  }
  saveStateFile();
  return { ok: true, stoppedCount: state.sessions.size };
}

/**
 * 获取全部状态
 */
export function getSchedulerStatus() {
  const sessions = Array.from(state.sessions.entries()).map(([id, s]) => ({
    id,
    symbol: s.symbol,
    name: s.name,
    type: s.type,
    status: s.status,
    tickCount: s.tickCount || 0,
    interval: s.interval,
    lastTick: s.lastTick,
    lastError: s.lastError,
    entryPrice: s.entryPrice,
  }));

  const runningCount = sessions.filter((s) => s.status === "running").length;

  return {
    enabled: state.enabled,
    runningCount,
    totalSessions: sessions.length,
    sessions,
    globalConfig: state.globalConfig,
    stats: state.stats,
  };
}

/**
 * 获取指定 session 的最新 agent trace
 */
export function getSessionTrace(sessionId) {
  const session = state.sessions.get(sessionId);
  return session?.agentTrace || null;
}

/**
 * 修改 session 配置
 */
export function updateSessionConfig(sessionId, changes) {
  const session = state.sessions.get(sessionId);
  if (!session) return { ok: false, error: "Session 不存在" };

  if (changes.intervalMs != null) {
    session.interval = Math.max(
      state.globalConfig.minIntervalMs,
      Math.min(state.globalConfig.maxIntervalMs, changes.intervalMs)
    );
  }
  if (changes.status) {
    session.status = changes.status;
    if (changes.status === "running") {
      state.enabled = true;
      // 重新启动 timer
      if (!session.timer) {
        const loop = async () => {
          if (!state.enabled || session.status !== "running") return;
          await autonomousTick(sessionId);
          if (state.enabled && session.status === "running") {
            session.timer = setTimeout(loop, session.interval);
          }
        };
        session.timer = setTimeout(loop, 100);
      }
    } else if (changes.status === "stopped" && session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }
  }

  saveStateFile();
  return { ok: true, session };
}

// ── 初始化时恢复状态 ──
const savedSessions = loadStateFile();

// 进程退出时清理
process.on("SIGINT", () => {
  stopAllSessions();
});
process.on("SIGTERM", () => {
  stopAllSessions();
});
