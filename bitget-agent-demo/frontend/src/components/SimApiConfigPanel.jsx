import { useEffect, useState } from "react";
import { api } from "../api";

const SOURCE_LABELS = {
  env: "环境变量 (.env)",
  session: "当前会话",
};

export default function SimApiConfigPanel({ simStatus, onAuthChange, compact = false }) {
  const auth = simStatus?.auth;
  const connected = !!auth?.configured;

  const [expanded, setExpanded] = useState(!connected);
  const [apiKey, setApiKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (connected) setExpanded(false);
  }, [connected]);

  const handleConnect = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.simConnect({ apiKey, secretKey, passphrase });
      setApiKey("");
      setSecretKey("");
      setPassphrase("");
      await onAuthChange?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.simDisconnect();
      setExpanded(true);
      await onAuthChange?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-ink">模拟账户 API</h3>
          <p className="text-xs text-ink-faint">
            Bitget UTA V3 模拟盘 · 执行层统一调用 api.bitget.com · 凭证仅保存在后端内存
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              connected ? "bg-profit/15 text-profit" : "bg-paper-sub/80 text-ink-muted"
            }`}
          >
            {connected ? "已连接" : "未连接"}
          </span>
          <button type="button" className="btn-ghost text-xs" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "收起" : connected ? "切换账户" : "配置"}
          </button>
        </div>
      </div>

      {connected && !expanded && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-bitget/25 bg-bitget/5 px-3 py-2 text-sm">
          <div className="text-ink-body">
            <span className="text-ink-faint">Key </span>
            <span className="font-mono text-bitget">{auth.apiKeyPreview}</span>
            {auth.source && (
              <span className="ml-2 text-xs text-ink-faint">· {SOURCE_LABELS[auth.source] || auth.source}</span>
            )}
            {simStatus?.execution?.hubReady && (
              <span className="ml-2 text-xs text-bitget">· bitget-core</span>
            )}
            {connected && !simStatus?.execution?.hubReady && (
              <span className="ml-2 text-xs text-warn">· bitget-v3</span>
            )}
          </div>
          <button type="button" className="btn-ghost border-loss/40 text-loss text-xs" onClick={handleDisconnect} disabled={loading}>
            {loading ? "退出中…" : "退出登录"}
          </button>
        </div>
      )}

      {expanded && (
        <form onSubmit={handleConnect} className={`mt-3 space-y-3 ${compact ? "" : ""}`}>
          {error && (
            <div className="rounded border border-loss/40 bg-loss/10 px-3 py-2 text-xs text-loss">{error}</div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="API Key" value={apiKey} onChange={setApiKey} placeholder="bg_..." />
            <Field label="Secret Key" value={secretKey} onChange={setSecretKey} placeholder="Secret" secret />
            <Field label="Passphrase" value={passphrase} onChange={setPassphrase} placeholder="Passphrase" secret />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? "连接中…" : "连接模拟账户"}
            </button>
            {connected && (
              <button type="button" className="btn-ghost border-loss/40 text-loss" onClick={handleDisconnect} disabled={loading}>
                退出登录
              </button>
            )}
          </div>
          <p className="text-[11px] text-ink-faint">
            在 Bitget 创建模拟盘 API Key（需开启 paptrading）。也可在 backend/.env 预配置，页面可一键退出后换号。
          </p>
        </form>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, secret }) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block text-ink-faint">{label}</span>
      <input
        type={secret ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-bitget-border bg-bitget-panel px-3 py-2 text-sm outline-none focus:border-bitget/50"
        autoComplete="off"
      />
    </label>
  );
}
