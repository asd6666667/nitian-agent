import PnLAnalysisPanel from "./PnLAnalysisPanel";
function MetricCard({ label, value, suffix = "", positive }) {
  const color =
    positive === true ? "text-profit" : positive === false ? "text-loss" : "text-ink";
  return (
    <div className="metric-card">
      <span className="text-xs text-ink-faint">{label}</span>
      <span className={`font-mono text-xl font-semibold ${color}`}>
        {value}{suffix}
      </span>
    </div>
  );
}

function DeltaBadge({ value, suffix = "" }) {
  if (value == null) return null;
  const positive = value >= 0;
  return (
    <span className={`text-xs font-mono ${positive ? "text-profit" : "text-loss"}`}>
      {positive ? "+" : ""}{value}{suffix}
    </span>
  );
}

export default function BacktestDashboard({ metrics, equityCurve, trades, comparison, loading, accountSource, initialCapital, accountBasis, simAccount, strategy, onRunBacktest }) {
  if (loading && !metrics) {
    return (
      <div className="panel p-8 text-center text-ink-faint animate-pulse">运行回测中...</div>
    );
  }

  if (!metrics) {
    return (
      <div className="panel p-8 text-center">
        <p className="text-ink-body mb-2">回测报告</p>
        <p className="text-sm text-ink-faint mb-1">尚未运行回测</p>
        <p className="text-xs text-ink-faint mb-4">
          点击「运行回测」将读取<strong className="text-ink-muted"> 逆天 模拟盘真实余额</strong>作为初始本金，在历史 K 线上模拟策略表现
        </p>
        {onRunBacktest && (
          <button type="button" className="btn-primary" onClick={onRunBacktest} disabled={!strategy}>
            运行回测
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {simAccount?.configured && (
        <div className="panel border-bitget/30 p-4">
          <div className="mb-3 text-sm font-semibold text-bitget">真实账户（当前 · 未因回测改变）</div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 text-xs">
            <div>
              <div className="text-ink-faint">账户权益</div>
              <div className="font-mono text-base text-ink">
                ${Number(simAccount.raw?.accountEquity || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
            </div>
            <div>
              <div className="text-ink-faint">USDT 可用</div>
              <div className="font-mono text-base text-ink">
                ${Number(simAccount.usdt?.available || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
            </div>
            <div>
              <div className="text-ink-faint">USDT 计入权益</div>
              <div className="font-mono text-base text-ink-muted">
                ${Number(accountBasis?.usdtEquityUsd ?? metrics.usdtEquityUsd ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
            </div>
            <div>
              <div className="text-ink-faint">BTC 持仓</div>
              <div className="font-mono text-base text-ink">{simAccount.btc?.available || "0"}</div>
            </div>
          </div>
          {Number(simAccount.usdt?.available || 0) > Number(accountBasis?.usdtEquityUsd ?? metrics.usdtEquityUsd ?? 0) + 1 && (
            <p className="mt-2 text-[11px] text-ink-faint">
              USDT「可用」略高于「计入权益」是 Bitget 账户正常情况；回测按权益计价，不会把虚高部分算进模拟。
            </p>
          )}
        </div>
      )}

      <div className="panel border-warn/25 bg-warn/8 p-4">
        <div className="mb-3 text-sm font-semibold text-warn">历史 K 线模拟（假设按策略在过去执行）</div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 text-xs">
          <div>
            <div className="text-ink-faint">模拟起点</div>
            <div className="font-mono text-base text-ink">
              ${Number(metrics.initialCapital).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-ink-faint">= 同步真实账户权益</div>
          </div>
          <div>
            <div className="text-ink-faint">模拟终点</div>
            <div className={`font-mono text-base ${metrics.simulatedPnl >= 0 ? "text-profit" : "text-loss"}`}>
              ${Number(metrics.finalEquity).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-ink-faint">≠ 当前账户余额</div>
          </div>
          <div>
            <div className="text-ink-faint">模拟盈亏</div>
            <div className={`font-mono text-base ${metrics.simulatedPnl >= 0 ? "text-profit" : "text-loss"}`}>
              {metrics.simulatedPnl >= 0 ? "+" : ""}${Number(metrics.simulatedPnl).toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-ink-faint">模拟收益率</div>
            <div className={`font-mono text-base ${metrics.totalReturnPct >= 0 ? "text-profit" : "text-loss"}`}>
              {metrics.totalReturnPct >= 0 ? "+" : ""}{metrics.totalReturnPct}%
            </div>
          </div>
        </div>
      </div>

      {comparison && (
        <div className="panel border-bitget/30 p-4">
          <h3 className="mb-2 text-sm font-semibold text-bitget">策略迭代对比</h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 text-sm">
            <div>
              <div className="text-ink-faint">总收益 Δ</div>
              <DeltaBadge value={comparison.delta.totalReturnPct} suffix="%" />
            </div>
            <div>
              <div className="text-ink-faint">胜率 Δ</div>
              <DeltaBadge value={comparison.delta.winRate} suffix="%" />
            </div>
            <div>
              <div className="text-ink-faint">最大回撤 Δ</div>
              <DeltaBadge value={-comparison.delta.maxDrawdownPct} suffix="%" />
            </div>
            <div>
              <div className="text-ink-faint">夏普 Δ</div>
              <DeltaBadge value={comparison.delta.sharpeRatio} />
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <MetricCard label="胜率" value={metrics.winRate} suffix="%" positive={metrics.winRate >= 50} />
        <MetricCard label="最大回撤" value={metrics.maxDrawdownPct} suffix="%" positive={false} />
        <MetricCard label="夏普比率" value={metrics.sharpeRatio} positive={metrics.sharpeRatio > 1} />
        <MetricCard label="交易次数" value={metrics.totalTrades} />
        {Number(metrics.otherAssetsUsd) > 0 && (
          <MetricCard label="其他资产(ETH等)" value={`$${Number(metrics.otherAssetsUsd).toFixed(2)}`} />
        )}
      </div>

      <PnLAnalysisPanel
        title="回测盈亏分析"
        footnote="* 回测盈亏数据基于历史 K 线模拟，已扣除策略止盈止损逻辑；统计时区 UTC+0"
        emptyMessage="暂无回测数据"
        equityCurve={equityCurve}
        metrics={metrics}
        initialCapital={metrics.initialCapital || initialCapital}
        symbol={strategy?.symbol}
      />

      <div className="panel p-4 max-h-[280px] overflow-y-auto">
        <h3 className="mb-2 text-sm font-semibold">交易明细</h3>
          <table className="w-full text-xs">
            <thead className="text-ink-faint sticky top-0 bg-bitget-panel">
              <tr>
                <th className="py-1 text-left">时间</th>
                <th className="py-1 text-left">方向</th>
                <th className="py-1 text-right">价格</th>
                <th className="py-1 text-right">盈亏</th>
                <th className="py-1 text-left">原因</th>
              </tr>
            </thead>
            <tbody>
              {(trades || []).slice(0, 20).map((t) => (
                <tr key={t.id} className="border-t border-bitget-border/50">
                  <td className="py-1.5 text-ink-muted">
                    {new Date(t.time).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className={`py-1.5 font-medium ${t.side === "buy" ? "text-profit" : "text-loss"}`}>
                    {t.side === "buy" ? "买入" : "卖出"}
                  </td>
                  <td className="py-1.5 text-right font-mono">${t.price?.toFixed(2)}</td>
                  <td className={`py-1.5 text-right font-mono ${t.pnl > 0 ? "text-profit" : t.pnl < 0 ? "text-loss" : ""}`}>
                    {t.pnl != null ? `$${t.pnl.toFixed(2)}` : "—"}
                  </td>
                  <td className="py-1.5 text-ink-faint truncate max-w-[120px]">{t.reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      {metrics.pausedByRisk && (
        <div className="rounded-lg border border-loss/40 bg-loss/10 px-4 py-2 text-sm text-loss">
          ⚠ 回测期间触发最大回撤限制，交易已暂停
        </div>
      )}
    </div>
  );
}
