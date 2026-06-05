import AgentLoopCard from "./AgentLoopCard";
import { strategyRunId } from "../utils/strategyRun";

export default function RunningStrategiesPanel({
  runningStrategies = [],
  selectedRunId,
  onSelect,
  onRemove,
  onStopAll,
}) {
  if (!runningStrategies.length) return null;

  const selected =
    runningStrategies.find((s) => strategyRunId(s) === selectedRunId) ||
    runningStrategies[0];

  return (
    <div className="mb-3 rounded-lg border border-bitget/25 bg-paper-sub/40 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-bitget">
          并行策略池 · {runningStrategies.length} 个运行中
        </h3>
        {onStopAll && (
          <button type="button" className="btn-ghost border-loss/40 px-2 py-0.5 text-[10px] text-loss" onClick={onStopAll}>
            全部停止
          </button>
        )}
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5 overflow-x-auto pb-1">
        {runningStrategies.map((s) => {
          const runId = strategyRunId(s);
          const active = runId === strategyRunId(selected);
          return (
            <div
              key={runId}
              className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${
                active
                  ? "border-bitget/50 bg-bitget/10 text-bitget"
                  : "border-bitget-border/60 bg-bitget-panel/40 text-ink-muted"
              }`}
            >
              <button type="button" className="text-left" onClick={() => onSelect?.(s)}>
                {s.name || s.symbol?.replace("USDT", "") || runId}
                <span className="ml-1 opacity-60">{s.symbol?.replace("USDT", "")}</span>
              </button>
              {onRemove && (
                <button
                  type="button"
                  title="停止此策略"
                  className="ml-0.5 rounded px-0.5 text-ink-faint hover:bg-loss/10 hover:text-loss"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`停止策略「${s.name || s.symbol}」？`)) onRemove(runId);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
      {selected && (
        <div className="mb-2 rounded-lg border border-bitget-border/50 bg-paper-sub/50 px-2.5 py-2 text-[11px] text-ink-muted">
          <div className="font-medium text-ink-body">{selected.name || selected.symbol}</div>
          <div className="mt-0.5 line-clamp-2">{selected.summary || "策略运行中…"}</div>
        </div>
      )}
      <AgentLoopCard agent={selected?.lastAgent} running />
    </div>
  );
}
