/**

 * 感知 Skill 聚合 — FRED + Finnhub + Bitget 三源管道，五 Skill 融合后喂决策层

 */

import { isBitgetConfigured } from "./bitgetClient.js";

import { runAllSkills, SKILL_REGISTRY } from "./skillHub.js";

import { isAgentHubReady } from "./agentHubBridge.js";

import { runPerceptionPipeline } from "./perceptionPipeline.js";



let cache = { key: "", data: null, ts: 0 };

const MIN_INTERVAL_MS = 8000;



export { SKILL_REGISTRY };

export { buildSignals } from "./perceptionPipeline.js";



export async function gatherPerception(symbol = "BTCUSDT", { force = false } = {}) {

  const key = symbol;

  if (!force && cache.data && cache.key === key && Date.now() - cache.ts < MIN_INTERVAL_MS) {

    return { ...cache.data, cached: true };

  }



  const pipeline = await runPerceptionPipeline(symbol);

  const result = {

    ...pipeline,

    cached: false,

  };



  cache = { key, data: result, ts: Date.now() };

  return result;

}


