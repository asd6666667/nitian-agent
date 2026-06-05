const TYPE_LABELS = {
  trend: "趋势跟踪",
  grid: "网格交易",
  arbitrage: "套利",
};

function Row({ label, value, tight = false }) {
  if (value == null || value === "") return null;
  return (
    <div className={`flex justify-between gap-2 ${tight ? "py-0.5" : "py-1"}`}>
      <span className="shrink-0 text-ink-faint">{label}</span>
      <span className="text-right font-mono text-ink-soft">{value}</span>
    </div>
  );
}

function ConditionRows({ strategy, tight = false }) {
  const c = strategy.conditions || {};

  if (strategy.type === "grid") {
    return (
      <>
        <Row tight={tight} label="网格间距" value={`${c.gridSpacingPct ?? "—"}%`} />
        <Row tight={tight} label="网格层数" value={c.gridLevels ?? "—"} />
      </>
    );
  }
  if (strategy.type === "arbitrage") {
    return (
      <>
        <Row tight={tight} label="价差阈值" value={`≥ ${c.arbitrageSpreadPct ?? "—"}%`} />
        <Row tight={tight} label="触发逻辑" value="现货 vs 模拟永续价差" />
      </>
    );
  }
  return (
    <>
      <Row tight={tight} label="均线周期" value={`${c.maPeriod ?? 20} 日`} />
      <Row tight={tight} label="成交量条件" value={`> ${c.volumeMultiplier ?? 1.5}x 均量`} />
      <Row tight={tight} label="入场信号" value={c.breakoutAboveMa !== false ? "突破均线上方" : "跌破均线下方"} />
    </>
  );
}

export default function StrategyCard({ strategy, compact = false, dense = false }) {
  if (!strategy) return null;

  const typeLabel = TYPE_LABELS[strategy.type] || strategy.type;

  if (compact) {
    return (
      <div className="mt-2 rounded border border-bitget/20 bg-paper-sub/70 p-2 text-xs">
        <div className="font-medium text-bitget">{strategy.name || "自定义策略"}</div>
        <div className="mt-0.5 text-ink-muted line-clamp-2">{strategy.summary}</div>
      </div>
    );
  }

  if (dense) {
    return (
      <div className="rounded border border-bitget/25 bg-paper-sub/60 p-2 text-[11px] leading-snug">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{strategy.name || "自定义策略"}</div>
            <div className="truncate text-ink-faint">{strategy.summary}</div>
          </div>
          <span className="shrink-0 rounded bg-bitget/15 px-1.5 py-0.5 text-[10px] text-bitget">{typeLabel}</span>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-bitget-border/40 pt-1.5">
          <Row tight label="交易对" value={strategy.symbol} />
          <Row tight label="仓位" value={`${strategy.positionPct ?? "—"}%`} />
          <ConditionRows strategy={strategy} tight />
          <Row tight label="止盈" value={`${strategy.risk?.takeProfitPct ?? "—"}%`} />
          <Row tight label="止损" value={`${strategy.risk?.stopLossPct ?? "—"}%`} />
          <Row tight label="最大回撤" value={`${strategy.risk?.maxDrawdownPct ?? "—"}%`} />
        </div>

        {strategy.rawInstruction && (
          <p className="mt-1.5 line-clamp-1 border-t border-bitget-border/30 pt-1.5 text-[10px] text-ink-faint">
            {strategy.rawInstruction}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-bitget/30 bg-paper-sub/60 p-3 text-xs">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-ink">{strategy.name || "自定义策略"}</div>
          <div className="mt-0.5 text-ink-faint">{strategy.summary}</div>
        </div>
        <span className="shrink-0 rounded bg-bitget/15 px-2 py-0.5 text-bitget">{typeLabel}</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded border border-bitget-border/60 bg-bitget-panel/40 p-2">
          <div className="mb-1 font-medium text-ink-muted">基础参数</div>
          <Row label="交易对" value={strategy.symbol} />
          <Row label="仓位" value={`${strategy.positionPct ?? "—"}%`} />
          {strategy.confidence != null && (
            <Row label="解析置信度" value={`${(strategy.confidence * 100).toFixed(0)}%`} />
          )}
        </div>

        <div className="rounded border border-bitget-border/60 bg-bitget-panel/40 p-2">
          <div className="mb-1 font-medium text-ink-muted">入场条件</div>
          <ConditionRows strategy={strategy} />
        </div>

        <div className="rounded border border-bitget-border/60 bg-bitget-panel/40 p-2 sm:col-span-2">
          <div className="mb-1 font-medium text-ink-muted">风控</div>
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-3">
            <Row label="止盈" value={`${strategy.risk?.takeProfitPct ?? "—"}%`} />
            <Row label="止损" value={`${strategy.risk?.stopLossPct ?? "—"}%`} />
            <Row label="最大回撤暂停" value={`${strategy.risk?.maxDrawdownPct ?? "—"}%`} />
          </div>
        </div>
      </div>

      {strategy.rawInstruction && (
        <div className="mt-2 rounded border border-bitget-border/40 bg-paper-sub/50 px-2 py-1.5">
          <div className="mb-0.5 text-ink-faint">原始指令</div>
          <p className="leading-relaxed text-ink-body">{strategy.rawInstruction}</p>
        </div>
      )}
    </div>
  );
}
