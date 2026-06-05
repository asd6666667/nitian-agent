import { hideModelTerms, agentStepFlags } from "../utils/agentDisplay";
import XianIcon from "./XianIcon";

const BIAS_LABEL = { bullish: "偏多", bearish: "偏空", neutral: "中性" };

const ACTION_LABEL = { buy: "买入", sell: "卖出", hold: "观望", hold_position: "持仓" };

const EXIT_SOURCE = {
  strategy: "策略出场",
  take_profit: "止盈",
  stop_loss: "止损",
  monitor: "持仓监控",
};

function Step({ num, title, children, active, done, skipped, pulsing, variant }) {
  const isLit = active || done;
  const border =
    variant === "warn"
      ? "border-warn/35 bg-warn/8"
      : variant === "danger"
        ? "border-loss/40 bg-loss/5"
        : skipped
          ? "border-bitget-border/60 bg-paper-sub/30"
          : isLit
            ? done && !active
              ? "border-bitget/30 bg-bitget/8"
              : "border-bitget/40 bg-bitget/5"
            : "border-bitget-border/60 bg-paper-sub/40";

  const badge = done && !pulsing ? "✓" : skipped ? "—" : num;

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 transition-colors duration-300 ${border} ${
        pulsing ? "animate-pulse" : ""
      }`}
    >
      <div className="mb-1 flex items-center gap-2">
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
            done ? "bg-bitget/30 text-bitget" : skipped ? "bg-bitget-border/30 text-ink-faint" : isLit ? "bg-bitget/30 text-bitget" : "bg-bitget-border/40 text-ink-faint"
          }`}
        >
          {badge}
        </span>
        <span className="text-xs font-medium text-ink-body">{title}</span>
      </div>
      <div className="pl-7 text-xs text-ink-muted">{children}</div>
    </div>
  );
}

function formatTickTime(ts) {
  if (!ts) return null;
  return new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function AgentLoopCard({ agent, running, updatedAt = null }) {
  if (!agent && !running) return null;

  if (!agent) {
    return (
      <div className="mb-3 rounded-lg border border-bitget-border/80 bg-paper-sub/50 px-3 py-2.5">
        <div className="flex items-center gap-2 text-xs text-ink-faint">
          <span className="h-2 w-2 animate-pulse rounded-full bg-bitget/60" />
          智能体等待首轮感知…
        </div>
      </div>
    );
  }

  const { perceive, decide, risk, execute, exit } = agent;
  const bias = BIAS_LABEL[perceive?.bias] || perceive?.bias || "—";
  const executed = execute?.executed;
  const riskPassed = risk?.passed !== false;

  const flags = agentStepFlags(agent);
  const tickLabel = formatTickTime(updatedAt);

  return (
    <div
      key={updatedAt || "agent-loop"}
      className="mb-0 rounded-lg border border-bitget/25 bg-gradient-to-br from-bitget/5 to-transparent p-3"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-bitget">
          <XianIcon name="robot" size={14} />
          Agent 链路
          {running && (
            <span className="ml-1 inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-bitget" />
          )}
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {tickLabel && (
            <span className="text-[10px] text-ink-faint">更新 {tickLabel}</span>
          )}
          {risk?.paused && (
            <span className="rounded-full bg-loss/15 px-2 py-0.5 text-[10px] text-loss">风控暂停</span>
          )}
          {executed && (
            <span className="rounded-full bg-profit/15 px-2 py-0.5 text-[10px] text-profit">已执行</span>
          )}
          {exit?.closed && (
            <span className="rounded-full bg-warn/12 px-2 py-0.5 text-[10px] text-warn">已退出</span>
          )}
        </div>
      </div>
      <div className="grid gap-2 lg:grid-cols-5 md:grid-cols-2">
        <Step num="1" title="感知" done={flags.perceiveDone} pulsing={running && !flags.perceiveDone}>
          <div className="text-ink-body">{hideModelTerms(perceive?.summary) || "—"}</div>
          <div className="mt-0.5 text-[10px] text-ink-faint">
            {bias} · {perceive?.signalCount ?? 0} 信号
            {perceive?.deepseekUsed && (
              <span className="ml-1 text-bitget/90">· 感知已接入</span>
            )}
          </div>
        </Step>
        <Step
          num="2"
          title="决策"
          done={flags.decideDone}
          active={decide?.finalAction === "buy" || decide?.finalAction === "sell"}
          pulsing={running && flags.perceiveDone && !flags.decideDone}
        >
          <div>
            策略 {ACTION_LABEL[decide?.strategyAction] || decide?.strategyAction || "—"}
            {" → "}
            最终{" "}
            {ACTION_LABEL[decide?.displayAction] ||
              (exit?.hasPosition && decide?.finalAction === "hold"
                ? "持仓"
                : ACTION_LABEL[decide?.finalAction] || decide?.finalAction || "—")}
          </div>
          <div className="mt-0.5 line-clamp-2 text-ink-body">{hideModelTerms(decide?.finalReason) || "—"}</div>
          {decide?.evaluation && (
            <div className="mt-0.5 text-[10px] text-bitget/90">{decide.evaluation}</div>
          )}
          {decide?.checks?.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {decide.checks.map((c) => (
                <div key={c.id} className={`text-[10px] ${c.pass ? "text-ink-faint" : "text-warn"}`}>
                  {c.pass ? "✓" : "×"} {c.label}
                </div>
              ))}
            </div>
          )}
          {decide?.autonomousThought && (
            <div className="mt-1 rounded border border-bitget/20 bg-bitget/5 px-2 py-1.5 text-[11px] leading-relaxed text-ink-body">
              <span className="font-medium text-bitget">自主思考 · </span>
              {hideModelTerms(decide.autonomousThought)}
            </div>
          )}
          {decide?.agentReason && (
            <div className="mt-0.5 text-[10px] text-bitget/80">{hideModelTerms(decide.agentReason)}</div>
          )}
          {decide?.deepseekUsed != null && (
            <div className={`mt-0.5 text-[10px] ${decide.deepseekUsed ? "text-bitget" : "text-warn"}`}>
              {decide.deepseekUsed
                ? `智能决策`
                : `决策未生效${decide.qwenError || decide.deepseekError ? ` · ${hideModelTerms(decide.qwenError || decide.deepseekError)}` : ""}`}
            </div>
          )}
        </Step>
        <Step
          num="3"
          title="执行"
          done={flags.executeDone}
          skipped={flags.executeSkipped}
          active={executed}
          pulsing={running && flags.decideDone && !flags.executeDone && !flags.executeSkipped}
          variant={execute?.error ? "danger" : execute?.blockedByRisk ? "warn" : undefined}
        >
          {executed ? (
            <>
              <div className="text-profit">订单已提交</div>
              <div className="mt-0.5 text-[10px] text-ink-faint">
                {execute.tradeLabel || execute.tradeType || "市价单"}
                {execute.apiPath ? ` · ${execute.apiPath}` : execute.source ? ` · ${execute.source}` : ""}
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-ink-faint">orderId {execute.orderId}</div>
            </>
          ) : execute?.blockedByRisk ? (
            <div className="text-warn">风控拦截，未下单</div>
          ) : execute?.error ? (
            <div className="text-loss">{execute.error}</div>
          ) : (
            <div>
              {exit?.hasPosition
                ? "持仓监控，本轮无新订单"
                : decide?.finalAction === "hold"
                  ? "本轮观望，无订单"
                  : "条件未满足，未下单"}
              {flags.executeSkipped && (
                <div className="mt-0.5 text-[10px] text-ink-faint">未触发开单，本步跳过</div>
              )}
            </div>
          )}
        </Step>
        <Step
          num="4"
          title="风控"
          done={flags.riskDone}
          skipped={flags.riskSkipped}
          active={flags.riskFailed}
          pulsing={running && flags.riskInvolved && !flags.riskDone && !flags.riskFailed}
          variant={risk?.paused ? "danger" : !riskPassed ? "warn" : undefined}
        >
          <div className={riskPassed ? "text-ink-body" : "text-warn"}>{hideModelTerms(risk?.reason) || "—"}</div>
          {flags.riskSkipped && (
            <div className="mt-0.5 text-[10px] text-ink-faint">未开单，风控预检跳过</div>
          )}
          {risk?.drawdownPct != null && risk?.drawdownPct > 0 && (
            <div className="mt-0.5 text-[10px] text-ink-faint">
              回撤 {Number(risk.drawdownPct).toFixed(2)}%
              {risk?.paused ? " · 已暂停新开仓" : ""}
            </div>
          )}
          {(risk?.checks || []).filter(c => c.id !== "pretrade").map((c) => (
            <div key={c.id} className={`mt-0.5 text-[10px] ${c.pass ? "text-ink-faint" : "text-warn"}`}>
              {c.pass ? "✓" : "✗"} {c.detail}
            </div>
          ))}
          {risk?.deepseekUsed != null && (
            <div className={`mt-0.5 text-[10px] ${risk.deepseekUsed ? "text-bitget" : "text-warn"}`}>
              {risk.deepseekUsed
                ? `智能风控${risk.deepseekConfidence != null ? ` · ${(risk.deepseekConfidence * 100).toFixed(0)}%` : ""}`
                : `风控未调用${risk.deepseekError ? ` · ${hideModelTerms(risk.deepseekError)}` : ""}`}
            </div>
          )}
        </Step>
        <Step
          num="5"
          title="退出"
          done={flags.exitDone}
          skipped={flags.exitSkipped}
          active={flags.exitMonitoring || exit?.triggered || exit?.closed}
          pulsing={running && flags.exitMonitoring}
          variant={exit?.source === "stop_loss" ? "danger" : exit?.triggered ? "warn" : undefined}
        >
          {exit?.hasPosition ? (
            <>
              <div className="text-ink-body">{hideModelTerms(exit?.reason) || "—"}</div>
              <div className="mt-0.5 text-[10px] text-ink-faint">
                {EXIT_SOURCE[exit?.source] || exit?.source || "—"}
                {exit?.pnlPct != null &&
                  ` · 盈亏 ${exit.pnlPct >= 0 ? "+" : ""}${Number(exit.pnlPct).toFixed(2)}%`}
                {exit?.closed && " · 已平仓"}
              </div>
              {exit?.deepseekUsed && (
                <div className="mt-0.5 text-[10px] text-bitget">
                  智能退出
                  {exit.deepseekConfidence != null ? ` · ${(exit.deepseekConfidence * 100).toFixed(0)}%` : ""}
                </div>
              )}
            </>
          ) : (
            <div>
              空仓 · 等待本策略开单后监控
              {flags.exitSkipped && (
                <div className="mt-0.5 text-[10px] text-ink-faint">未开单，退出监控未启动</div>
              )}
            </div>
          )}
        </Step>
      </div>
    </div>
  );
}
