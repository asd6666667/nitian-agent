const BASE = import.meta.env.VITE_API_URL || "";

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json", ...options.headers },
      ...options,
    });
  } catch {
    throw new Error("无法连接后端，请确认 backend 已启动：cd bitget-agent-demo/backend && npm run dev");
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        res.ok
          ? "后端返回无效 JSON"
          : `后端异常 (${res.status})，请确认 backend 已启动：cd bitget-agent-demo/backend && npm run dev`
      );
    }
  } else if (!res.ok) {
    throw new Error(
      `后端无响应 (${res.status})，请确认 backend 已启动：cd bitget-agent-demo/backend && npm run dev`
    );
  }

  if (!res.ok) throw new Error(data?.error || "请求失败");
  return data ?? {};
}

export const api = {
  hubHealth: () => request("/api/hub/health"),
  hubCapabilities: () => request("/api/hub/capabilities"),
  hubTools: (module) => request(`/api/hub/tools${module ? `?module=${module}` : ""}`),
  hubCallTool: (toolName, args) =>
    request(`/api/hub/tools/${toolName}`, { method: "POST", body: JSON.stringify(args || {}) }),
  hubMarket: (symbol) => request(`/api/hub/market/${symbol || "BTCUSDT"}`),
  hubSentiment: () => request("/api/hub/sentiment"),
  hubPerception: (symbol, force) =>
    request(`/api/hub/perception/${symbol || "BTCUSDT"}${force ? "?force=1" : ""}`),
  bitgetAccount: () => request("/api/bitget/account"),
  simStatus: () => request("/api/sim/status"),
  simConnect: (body) => request("/api/sim/connect", { method: "POST", body: JSON.stringify(body) }),
  simDisconnect: () => request("/api/sim/disconnect", { method: "POST", body: "{}" }),
  simPnLAnalysis: (days, symbol) =>
    request(`/api/sim/pnl-analysis?days=${days || 30}&symbol=${encodeURIComponent(symbol || "BTCUSDT")}`),
  simAuth: () => request("/api/sim/auth"),
  simAccount: () => request("/api/sim/account"),
  simOrders: (symbol) => request(`/api/sim/orders/${symbol || "BTCUSDT"}`),
  simAllOrders: (symbols) =>
    request(`/api/sim/orders?all=1${symbols?.length ? `&symbols=${encodeURIComponent(symbols.join(","))}` : ""}`),
  simLogs: (limit) => request(`/api/sim/logs?limit=${limit || 50}`),
  simHistoryOrders: (symbols, limit) => {
    const q = new URLSearchParams({ limit: String(limit || 20) });
    if (symbols?.length) q.set("symbols", symbols.join(","));
    return request(`/api/sim/history-orders?${q}`);
  },
  simTick: (strategy) => request("/api/sim/tick", { method: "POST", body: JSON.stringify({ strategy }) }),
  parseStrategy: (body) => request("/api/strategy/parse", { method: "POST", body: JSON.stringify(body) }),
  chatMessage: (body) => request("/api/chat/message", { method: "POST", body: JSON.stringify(body) }),
  streamAutonomousRound: async (body, onEvent, signal) => {
    const BASE = import.meta.env.VITE_API_URL || "";
    const res = await fetch(`${BASE}/api/chat/autonomous-round/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const text = await res.text();
      let err = text;
      try {
        err = JSON.parse(text)?.error || text;
      } catch {
        /* ignore */
      }
      throw new Error(err || `请求失败 (${res.status})`);
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("流式响应不可用");
    const decoder = new TextDecoder();
    let buffer = "";
    let finalPayload = null;
    let completePayload = null;

    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => null);
        throw new DOMException("用户取消", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        if (!part.trim()) continue;
        const line = part.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        try {
          const payload = JSON.parse(line.slice(6));
          if (payload.phase === "ping") continue;
          onEvent?.(payload);
          if (payload.phase === "complete") completePayload = payload;
          if (payload.phase === "done") finalPayload = payload;
          if (payload.phase === "error") throw new Error(payload.error || "执行失败");
        } catch (e) {
          if (e instanceof SyntaxError) {
            console.warn("[streamAutonomousRound] SSE JSON 解析失败，跳过片段");
            continue;
          }
          throw e;
        }
      }
    }
    return completePayload || finalPayload;
  },
  applyStrategySymbol: (strategy, symbol) =>
    request("/api/strategy/apply-symbol", {
      method: "POST",
      body: JSON.stringify({ strategy, symbol }),
    }),
  simCancel: (body) => request("/api/sim/cancel", { method: "POST", body: JSON.stringify(body) }),
  getPresets: () => request("/api/strategy/presets"),
  runBacktest: (body) => request("/api/backtest/run", { method: "POST", body: JSON.stringify(body) }),
  getPaperSession: (id) => request(`/api/paper/${id}`),
  createPaperSession: (sessionId, symbol, strategy) =>
    request("/api/paper/session", {
      method: "POST",
      body: JSON.stringify({ sessionId, symbol, strategy }),
    }),
  tickPaper: (id, strategy) =>
    request(`/api/paper/${id}/tick`, { method: "POST", body: JSON.stringify({ strategy }) }),
  tickAllPaper: (id, strategies) =>
    request(`/api/paper/${id}/tick-all`, { method: "POST", body: JSON.stringify({ strategies }) }),
  addPaperStrategy: (id, strategy) =>
    request(`/api/paper/${id}/strategies`, { method: "POST", body: JSON.stringify({ strategy }) }),
  removePaperStrategy: (id, runId) =>
    request(`/api/paper/${id}/strategies/${encodeURIComponent(runId)}`, { method: "DELETE" }),
  resumePaper: (id) => request(`/api/paper/${id}/resume`, { method: "POST", body: JSON.stringify({}) }),
  getMarket: (symbol, opts = {}) => {
    const sym = symbol || "BTCUSDT";
    const q = new URLSearchParams({
      granularity: opts.granularity || "1H",
      limit: String(opts.limit || 200),
      category: opts.category || "USDT-FUTURES",
    });
    if (opts.maPeriod) q.set("maPeriod", String(opts.maPeriod));
    return request(`/api/market/${sym}?${q}`);
  },
  getMarketSymbols: () => request("/api/market/symbols"),

  // ── 自主 Agent 调度器 API ──
  agentStart: (body) => request("/api/agent/start", { method: "POST", body: JSON.stringify(body || {}) }),
  agentStop: (sessionId) => request(`/api/agent/stop/${encodeURIComponent(sessionId)}`, { method: "POST", body: "{}" }),
  agentStopAll: () => request("/api/agent/stop-all", { method: "POST", body: "{}" }),
  agentStatus: () => request("/api/agent/status"),
  agentTrace: (sessionId) => request(`/api/agent/trace/${encodeURIComponent(sessionId)}`),
  agentUpdateSession: (sessionId, body) =>
    request(`/api/agent/session/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  agentMemory: (regime) => request(`/api/agent/memory${regime ? `?regime=${encodeURIComponent(regime)}` : ""}`),
  agentResetMemory: () => request("/api/agent/memory/reset", { method: "POST", body: "{}" }),
};
