import { useState } from "react";

const EXAMPLE =
  "SAR+MACD 双信号：BTC 在 SAR 之上且 MACD 多头、量能 MA5>MA10 时开多，止损跌破 SAR，近高止盈 50%，单笔仓位 10%";

function AddPresetModal({ open, onClose, onSubmit, loading, error }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const text = description.trim();
    if (!text) return;
    await onSubmit({ name: name.trim(), description: text });
    setName("");
    setDescription("");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 p-4"
      onClick={onClose}
    >
      <div
        className="panel w-full max-w-lg border-bitget/30 p-4 shadow-float"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">添加自定义策略</h3>
          <button type="button" className="btn-ghost text-xs" onClick={onClose}>
            关闭
          </button>
        </div>
        <p className="mb-3 text-xs text-ink-faint">
          用自然语言描述策略，系统会自动解析参数并保存到「我的策略」列表。
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-ink-faint">策略名称（可选）</label>
            <input
              className="w-full rounded-lg border border-bitget-border bg-paper-sub/70 px-3 py-2 text-sm text-ink-soft outline-none focus:border-bitget/50"
              placeholder="如：我的 BTC 趋势策略"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink-faint">策略描述</label>
            <textarea
              className="min-h-[120px] w-full resize-y rounded-lg border border-bitget-border bg-paper-sub/70 px-3 py-2 text-sm text-ink-soft outline-none focus:border-bitget/50"
              placeholder={EXAMPLE}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={loading}
              required
            />
          </div>
          {error && (
            <div className="rounded border border-loss/40 bg-loss/10 px-3 py-2 text-xs text-loss">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost text-sm" onClick={onClose} disabled={loading}>
              取消
            </button>
            <button type="submit" className="btn-primary text-sm" disabled={loading || !description.trim()}>
              {loading ? "解析中…" : "保存并加载"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PresetBar({
  presets = [],
  customPresets = [],
  activeId,
  onSelect,
  onAdd,
  onDelete,
  loading,
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState(null);

  const renderPreset = (p) => {
    const selected = activeId && p.id === activeId;
    return (
      <div key={p.id} className="relative group">
        <button
          disabled={loading}
          onClick={() => onSelect(p)}
          className={`rounded-lg border px-4 py-2 text-left text-sm transition disabled:opacity-50 ${
            selected
              ? "border-bitget bg-bitget/10 ring-1 ring-bitget/40"
              : "border-bitget-border bg-paper-sub/60 hover:border-bitget/60 hover:bg-bitget/5"
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-ink-soft">{p.name}</span>
            {p.isCustom && (
              <span className="rounded bg-bitget/12 px-1.5 py-0.5 text-[10px] text-bitget">
                我的
              </span>
            )}
          </div>
          <div className="mt-0.5 max-w-[280px] text-xs text-ink-faint line-clamp-2">{p.summary}</div>
        </button>
        {p.isCustom && onDelete && (
          <button
            type="button"
            title="删除"
            disabled={loading}
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm(`删除策略「${p.name}」？`))
                onDelete(p.id, { symbol: p.symbol, type: p.type });
            }}
            className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full border border-bitget-border bg-bitget-panel text-[10px] text-ink-muted hover:border-loss/50 hover:text-loss group-hover:flex"
          >
            ×
          </button>
        )}
      </div>
    );
  };

  const handleAdd = async ({ name, description }) => {
    setAdding(true);
    setAddError(null);
    try {
      await onAdd({ name, description });
      setModalOpen(false);
    } catch (e) {
      setAddError(e.message || "添加失败");
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <div className="panel mb-4 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-medium uppercase tracking-wider text-ink-faint">
            预设策略 · 支持全 USDT 现货对
          </div>
          <button
            type="button"
            disabled={loading || adding}
            onClick={() => {
              setAddError(null);
              setModalOpen(true);
            }}
            className="rounded-lg border border-dashed border-bitget/40 px-3 py-1.5 text-xs text-bitget transition hover:border-bitget hover:bg-bitget/5 disabled:opacity-50"
          >
            + 添加策略
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {presets.map(renderPreset)}
          {customPresets.map(renderPreset)}
        </div>

        {customPresets.length > 0 && (
          <p className="mt-2 text-[10px] text-ink-faint">
            「我的」策略保存在本浏览器（对话创建的策略会自动出现在这里），悬停可删除
          </p>
        )}
      </div>

      <AddPresetModal
        open={modalOpen}
        onClose={() => !adding && setModalOpen(false)}
        onSubmit={handleAdd}
        loading={adding}
        error={addError}
      />
    </>
  );
}
