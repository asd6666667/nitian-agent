export default function ConnectionBanner({ hubStatus, apiError, onRetry }) {
  const backendDown = !hubStatus || hubStatus.status !== "ok";
  const dataError = apiError && !backendDown;

  if (!backendDown && !dataError) return null;

  return (
    <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
      backendDown ? "border-loss/40 bg-loss/10" : "border-warn/35 bg-warn/10"
    }`}>
      <div className={`font-medium ${backendDown ? "text-loss" : "text-warn"}`}>
        {backendDown ? "后端未连接 · 页面数据无法加载" : "部分数据加载失败"}
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        {backendDown ? (
          <>
            {apiError || "请在后端目录运行："}{" "}
            <code className="text-bitget">cd bitget-agent-demo/backend && npm run dev</code>
          </>
        ) : (
          <>
            {apiError} · 策略与预设仍可用，K 线/账户数据可能暂不可用。请确认代理已开启（Clash 7897）后点击重新连接。
          </>
        )}
      </p>
      {onRetry && (
        <button className="btn-ghost mt-2 text-xs" onClick={onRetry}>
          重新连接
        </button>
      )}
    </div>
  );
}
