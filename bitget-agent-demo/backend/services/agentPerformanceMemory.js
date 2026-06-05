/**
 * 策略性能记忆模块
 * 记录每次策略执行的结果，供后续策略生成时参考
 * 让 agent 记住什么策略在什么市场条件下表现好/差
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_FILE = path.join(__dirname, "../../agent-memory.json");

/** 默认性能记忆结构 */
function defaultMemory() {
  return {
    strategies: {},       // strategyType → { trades, winRate, avgReturn, ... }
    recentTrades: [],     // 最近交易记录（最多 50 条）
    regimeHistory: [],    // 市场状态记录
    updatedAt: null,
    totalTrades: 0,
    totalWins: 0,
  };
}

function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const raw = fs.readFileSync(MEMORY_FILE, "utf-8");
      return { ...defaultMemory(), ...JSON.parse(raw) };
    }
  } catch (e) {
    console.warn("[agentMemory] 加载失败，重置:", e.message);
  }
  return defaultMemory();
}

function saveMemory(memory) {
  memory.updatedAt = new Date().toISOString();
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2), "utf-8");
  } catch (e) {
    console.warn("[agentMemory] 保存失败:", e.message);
  }
}

/**
 * 记录一次策略执行结果
 * @param {Object} trade - { strategyType, strategyName, symbol, entryPrice, exitPrice, pnlPct, regime, duration, exitReason }
 */
export function recordTrade(trade) {
  const memory = loadMemory();
  const type = trade.strategyType || "unknown";

  // 更新策略统计
  if (!memory.strategies[type]) {
    memory.strategies[type] = {
      type,
      trades: 0,
      wins: 0,
      losses: 0,
      totalReturnPct: 0,
      avgReturnPct: 0,
      avgDuration: null,
      winRate: 0,
      maxDrawdown: 0,
      bestRegime: null,
      worstRegime: null,
      bestReturn: -Infinity,
      worstReturn: Infinity,
      lastUsed: null,
      performanceByRegime: {},
    };
  }

  const stat = memory.strategies[type];
  stat.trades += 1;
  stat.lastUsed = new Date().toISOString();

  const pnl = Number(trade.pnlPct) || 0;
  stat.totalReturnPct += pnl;
  stat.avgReturnPct = +(stat.totalReturnPct / stat.trades).toFixed(2);

  if (pnl > 0) {
    stat.wins += 1;
    stat.bestReturn = Math.max(stat.bestReturn, pnl);
  } else if (pnl < 0) {
    stat.losses += 1;
    stat.worstReturn = Math.min(stat.worstReturn, pnl);
    stat.maxDrawdown = Math.min(stat.maxDrawdown, pnl);
  }
  stat.winRate = +(stat.wins / stat.trades * 100).toFixed(1);

  // 按市场状态记录
  const regime = trade.regime || "unknown";
  if (!stat.performanceByRegime[regime]) {
    stat.performanceByRegime[regime] = { trades: 0, wins: 0, totalReturn: 0 };
  }
  const regimeStat = stat.performanceByRegime[regime];
  regimeStat.trades += 1;
  regimeStat.totalReturn += pnl;
  if (pnl > 0) regimeStat.wins += 1;
  regimeStat.avgReturn = +(regimeStat.totalReturn / regimeStat.trades).toFixed(2);
  regimeStat.winRate = +(regimeStat.wins / regimeStat.trades * 100).toFixed(1);

  // 判断最佳/最差市场状态
  const allRegimes = Object.entries(stat.performanceByRegime);
  stat.bestRegime = allRegimes
    .filter(([, r]) => r.trades >= 2)
    .sort(([, a], [, b]) => b.avgReturn - a.avgReturn)[0]?.[0] || null;
  stat.worstRegime = allRegimes
    .filter(([, r]) => r.trades >= 2)
    .sort(([, a], [, b]) => a.avgReturn - b.avgReturn)[0]?.[0] || null;

  // 更新全局统计
  memory.totalTrades += 1;
  if (pnl > 0) memory.totalWins += 1;

  // 记录最近交易
  memory.recentTrades.unshift({
    time: new Date().toISOString(),
    strategyType: type,
    strategyName: trade.strategyName,
    symbol: trade.symbol,
    pnlPct: +pnl.toFixed(2),
    regime: regime,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    duration: trade.duration,
    exitReason: trade.exitReason,
  });
  if (memory.recentTrades.length > 50) {
    memory.recentTrades = memory.recentTrades.slice(0, 50);
  }

  saveMemory(memory);
  return memory;
}

/**
 * 记录市场状态快照
 */
export function recordRegime(symbol, regime) {
  const memory = loadMemory();
  memory.regimeHistory.unshift({
    time: new Date().toISOString(),
    symbol,
    regime,
  });
  if (memory.regimeHistory.length > 100) {
    memory.regimeHistory = memory.regimeHistory.slice(0, 100);
  }
  saveMemory(memory);
}

/**
 * 获取当前市场状态下的最佳策略建议
 * @param {string} currentRegime - 当前市场状态
 * @returns {Array} 按推荐度排序的策略列表
 */
export function getBestStrategiesForRegime(currentRegime) {
  const memory = loadMemory();
  const results = [];

  for (const [type, stat] of Object.entries(memory.strategies)) {
    const regimePerf = stat.performanceByRegime?.[currentRegime];
    if (regimePerf && regimePerf.trades >= 1) {
      results.push({
        type,
        trades: regimePerf.trades,
        winRate: regimePerf.winRate,
        avgReturn: regimePerf.avgReturn,
        overallWinRate: stat.winRate,
        overallReturn: stat.avgReturnPct,
      });
    }
  }

  // 按在该市场状态下的平均收益排序
  return results.sort((a, b) => b.avgReturn - a.avgReturn);
}

/**
 * 获取性能摘要（给 LLM 生成策略时当上下文）
 * @param {string} currentRegime
 * @returns {string} 格式化的性能摘要文本
 */
export function getPerformanceSummary(currentRegime) {
  const memory = loadMemory();
  if (memory.totalTrades === 0) return "暂无历史交易记录。";

  const lines = [];
  lines.push(`历史交易: ${memory.totalTrades} 笔, 胜率 ${memory.totalTrades > 0 ? +(memory.totalWins / memory.totalTrades * 100).toFixed(1) : 0}%`);

  // 所有策略概览
  for (const [type, stat] of Object.entries(memory.strategies).sort(([, a], [, b]) => b.trades - a.trades)) {
    const regimeTag = currentRegime && stat.performanceByRegime?.[currentRegime]
      ? `[当前 ${currentRegime}: ${stat.performanceByRegime[currentRegime].trades}笔 ${stat.performanceByRegime[currentRegime].winRate}%胜率]`
      : "";
    lines.push(`- ${type}: ${stat.trades}笔 ${stat.winRate}%胜率 均收益${stat.avgReturnPct}% ${regimeTag}`);
  }

  // 当前市场状态的最佳策略
  if (currentRegime) {
    const best = getBestStrategiesForRegime(currentRegime);
    if (best.length > 0) {
      const top = best[0];
      lines.push(`当前 "${currentRegime}" 市况推荐: ${top.type} (${top.trades}笔 ${top.winRate}%胜率 均${top.avgReturn}%)`);
    }
  }

  // 最近 3 笔交易
  if (memory.recentTrades.length > 0) {
    lines.push("最近交易:");
    for (const t of memory.recentTrades.slice(0, 3)) {
      lines.push(`  ${t.time.slice(5, 16)} ${t.strategyType} ${t.symbol}: ${t.pnlPct >= 0 ? "+" : ""}${t.pnlPct}% (${t.regime})`);
    }
  }

  return lines.join("\n");
}

/**
 * 重置记忆（调试用）
 */
export function resetMemory() {
  saveMemory(defaultMemory());
  return defaultMemory();
}

export function getMemory() {
  return loadMemory();
}
