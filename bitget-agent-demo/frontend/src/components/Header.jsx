import AgentIcon from "./AgentIcon";

export default function Header({ hubStatus, strategy }) {
  const online = hubStatus?.status === "ok";
  const bitgetMode = hubStatus?.mode === "bitget_paper_trading";
  const bitget = hubStatus?.bitget;

  return (
    <header className="border-b border-bitget-border bg-bitget-panel/95 shadow-panel sticky top-0 z-50">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between px-4 py-3 lg:px-6">
        <div className="flex items-center gap-3">
          <AgentIcon size="md" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-ink">
              逆天 Agent Hub
              <span className="ml-2 text-xs font-normal text-bitget">AI Trading Demo</span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm">
          {bitget?.configured && (
            <span className={`hidden sm:inline text-xs ${bitget.account ? "text-profit" : "text-warn"}`}>
              逆天 模拟盘 {bitget.account ? "已连接" : "待配置"}
            </span>
          )}
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${online ? "status-dot animate-pulse" : "bg-ink-faint"}`} />
            <span className="text-xs text-ink-muted">
              {bitgetMode ? "Paper 模式" : online ? "Agent Hub" : "离线"}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
