export default function MarketPanel({ market, hubStatus }) {
  if (!market) {
    return (
      <div className="panel p-4 animate-pulse">
        <div className="h-4 w-32 rounded bg-bitget-border mb-4" />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 rounded bg-bitget-border/50" />
          ))}
        </div>
      </div>
    );
  }

  const sourceLabel =
    market.source === "bitget_api"
      ? "Bitget Spot K线"
      : market.source === "bitget_public"
        ? "Bitget 公开"
        : market.source || "Bitget";

  const items = [
    { label: "最新价", value: `$${market.price?.toLocaleString()}`, highlight: true },
    { label: "MA", value: market.ma20 ?? market.ma ? `$${Number(market.ma20 ?? market.ma).toLocaleString()}` : "—" },
    { label: "成交量", value: market.volume?.toLocaleString() },
    { label: "量比", value: market.volumeRatio ? `${market.volumeRatio}x` : "—" },
    { label: "波动率", value: market.volatility ? `${market.volatility}%` : "—" },
    { label: "数据源", value: sourceLabel },
  ];

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">感知层 · Bitget 行情</h2>
        <div className="flex gap-2">
          {market.bitgetPaper && (
            <span className="rounded bg-profit/10 px-2 py-0.5 text-xs text-profit">模拟盘</span>
          )}
          <span className="rounded bg-bitget/10 px-2 py-0.5 text-xs text-bitget">
            {market.symbol}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {items.map((item) => (
          <div key={item.label} className="rounded-lg bg-paper-sub/70 px-3 py-2">
            <div className="text-xs text-ink-faint">{item.label}</div>
            <div className={`font-mono text-sm ${item.highlight ? "text-bitget font-semibold" : "text-ink-soft"}`}>
              {item.value}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 text-xs text-ink-faint">
        Agent Hub v{hubStatus?.version || "1.0"} · {hubStatus?.mode || "simulation"}
      </div>
    </div>
  );
}
