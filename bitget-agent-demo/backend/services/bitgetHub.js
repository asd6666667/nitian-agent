/**
 * Bitget Agent Hub 集成层
 * 感知 Skill + Bitget Paper Trading
 */
import { gatherPerception, SKILL_REGISTRY } from "./perceptionSkills.js";
import { getMarketSnapshot, getSentimentSnapshot } from "./marketData.js";
import { getConnectionStatus, getAssets, isBitgetConfigured } from "./bitgetClient.js";

export const AGENT_HUB_VERSION = "1.1.0-bitget";

export async function hubGetMarketMetrics(symbol = "BTCUSDT") {
  const [market, perception] = await Promise.all([
    getMarketSnapshot(symbol),
    gatherPerception(symbol).catch(() => null),
  ]);
  return {
    hub: "bitget-agent-hub",
    version: AGENT_HUB_VERSION,
    module: "perception",
    data: {
      symbol: market.symbol,
      price: market.price,
      indicators: {
        ma20: market.ma20,
        volume: market.volume,
        volumeRatio: market.volumeRatio,
        volatility: market.volatility,
        rsi: perception?.skills?.technicalAnalysis?.rsi,
        trend: perception?.skills?.technicalAnalysis?.trend,
      },
      candles: market.candles,
      source: market.source,
      bitgetPaper: market.bitgetPaper,
      perception: perception
        ? {
            composite: perception.composite,
            skills: Object.fromEntries(
              Object.entries(perception.skills).map(([k, v]) => [k, { summary: v.summary, skill: v.skill }])
            ),
          }
        : null,
      timestamp: market.timestamp,
    },
  };
}

export async function hubGetSentiment() {
  const sentiment = await getSentimentSnapshot();
  return {
    hub: "bitget-agent-hub",
    version: AGENT_HUB_VERSION,
    module: "sentiment",
    data: sentiment,
  };
}

export async function hubGetPerception(symbol = "BTCUSDT", opts = {}) {
  const perception = await gatherPerception(symbol, opts);
  return {
    hub: "bitget-agent-hub",
    version: AGENT_HUB_VERSION,
    module: "perception_skills",
    skills: SKILL_REGISTRY.map((s) => s.id),
    refreshIntervalSec: 10,
    data: perception,
  };
}

export async function hubHealthCheck() {
  const { isDeepseekConfigured, getDeepseekLiteModel, getDeepseekPremiumModel } = await import(
    "./deepseekClient.js"
  );
  const bitget = await Promise.race([
    getConnectionStatus().catch(() => ({
      configured: isBitgetConfigured(),
      paperTrading: true,
      market: false,
      account: false,
      error: "connection check failed",
    })),
    new Promise((resolve) =>
      setTimeout(
        () =>
          resolve({
            configured: isBitgetConfigured(),
            paperTrading: true,
            market: false,
            account: false,
            error: "checking…",
          }),
        3000
      )
    ),
  ]);
  return {
    status: "ok",
    hub: "bitget-agent-hub",
    version: AGENT_HUB_VERSION,
    mode: bitget.configured && bitget.account ? "bitget_paper_trading" : "simulation",
    bitget,
    skills: [
      "technical-analysis",
      "sentiment-analyst",
      "market-intel",
      "news-briefing",
      "macro-analyst",
    ],
    layers: ["perception", "decision", "execution", "risk", "review"],
    deepseek: {
      configured: isDeepseekConfigured(),
      liteModel: getDeepseekLiteModel(),
      premiumModel: getDeepseekPremiumModel(),
      liteUses: ["perception", "chat", "strategy-parse"],
      premiumUses: ["decision", "risk", "exit"],
    },
  };
}

export async function hubGetAccount() {
  if (!isBitgetConfigured()) {
    return { configured: false, message: "请配置 BITGET_API_KEY 等环境变量" };
  }
  const assets = await getAssets();
  const usdt = assets?.assets?.find((a) => a.coin === "USDT");
  const btc = assets?.assets?.find((a) => a.coin === "BTC");
  return {
    configured: true,
    paperTrading: true,
    usdtAvailable: usdt?.available ?? "0",
    btcAvailable: btc?.available ?? "0",
    raw: assets,
  };
}
