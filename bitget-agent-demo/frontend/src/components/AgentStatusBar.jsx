import { hideModelTerms } from "../utils/agentDisplay";

const BIAS_LABEL = { bullish: "偏多", bearish: "偏空", neutral: "中性" };

function Pill({ ok, label, detail, variant = "default" }) {
  const colors =
    variant === "premium"
      ? ok
        ? "bg-bitget/12 text-bitget"
        : "bg-warn/10 text-warn"
      : ok
        ? "bg-bitget/12 text-bitget"
        : "bg-warn/10 text-warn";
  const dot =
    variant === "premium"
      ? ok
        ? "bg-bitget"
        : "bg-warn"
      : ok
        ? "bg-bitget"
        : "bg-warn";

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${colors}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
      {detail ? <span className="opacity-70">· {detail}</span> : null}
    </span>
  );
}

/** 常驻感知 / 决策·风控·退出 状态（不展示模型名） */
export default function AgentStatusBar({ perception, lastAgent, compact = false }) {
  const perceiveOk = lastAgent?.perceive?.deepseekUsed ?? perception?.deepseekUsed ?? false;
  const decideOk =
    lastAgent?.decide?.deepseekUsed ||
    lastAgent?.risk?.deepseekUsed ||
    lastAgent?.exit?.deepseekUsed ||
    false;

  const bias = lastAgent?.perceive?.bias ?? perception?.composite?.bias;
  const score = lastAgent?.perceive?.score ?? perception?.composite?.score;
  const summary = hideModelTerms(
    lastAgent?.perceive?.summary?.slice(0, compact ? 48 : 120) ||
      perception?.deepseekPerception?.summary?.slice(0, compact ? 48 : 120)
  );

  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 ${
        compact ? "" : "rounded-lg border border-bitget-border/60 bg-paper-sub/50 px-2.5 py-1.5"
      }`}
    >
      <Pill ok={perceiveOk} label="感知" detail={perceiveOk ? "已接入" : "待拉取"} />
      <Pill
        ok={decideOk}
        label="决策·风控·退出"
        detail={decideOk ? "运行中" : "tick 时调用"}
        variant="premium"
      />
      {bias != null && (
        <span className="text-[10px] text-ink-faint">
          {BIAS_LABEL[bias] || bias}
          {score != null ? ` ${Number(score).toFixed(2)}` : ""}
        </span>
      )}
      {!compact && summary && (
        <span className="min-w-0 flex-1 truncate text-[10px] text-ink-faint" title={summary}>
          {summary}
        </span>
      )}
    </div>
  );
}
