import { MAIN_INDICATORS, SUB_INDICATORS } from "../../utils/chartIndicators";

export default function IndicatorModal({ open, main, sub, onMainChange, onSubChange, onClose }) {
  if (!open) return null;

  const toggleMain = (id) => {
    onMainChange((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      if (!Object.values(next).some(Boolean)) next[id] = true;
      return next;
    });
  };

  const toggleSub = (id) => {
    onSubChange(id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/20 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-2xl border border-bitget-border bg-bitget-panel shadow-float sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-bitget-border/60 px-4 py-3 text-center text-base font-semibold text-ink">
          指标
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-3">
          <div className="mb-1 text-sm font-medium text-ink-body">主图</div>
          <div className="mb-4 grid grid-cols-4 gap-2">
            {MAIN_INDICATORS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => toggleMain(id)}
                className={`rounded-lg py-2.5 text-sm font-medium transition ${
                  main[id]
                    ? "bg-bitget/20 text-bitget ring-1 ring-bitget/40"
                    : "bg-paper-sub/70 text-ink-muted hover:text-ink-soft"
                }`}
              >
                {id === "SUPER" ? "SUPER" : id}
              </button>
            ))}
          </div>
          <div className="mb-1 text-sm font-medium text-ink-body">副图</div>
          <div className="grid grid-cols-4 gap-2">
            {SUB_INDICATORS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => toggleSub(id)}
                className={`rounded-lg py-2.5 text-sm font-medium transition ${
                  sub === id
                    ? "bg-bitget/20 text-bitget ring-1 ring-bitget/40"
                    : "bg-paper-sub/70 text-ink-muted hover:text-ink-soft"
                }`}
              >
                {id === "StochRSI" ? "Stoch RSI" : id}
              </button>
            ))}
          </div>
        </div>
        <div className="border-t border-bitget-border/60 px-4 py-3">
          <button
            type="button"
            className="w-full rounded-lg bg-paper-sub/90 py-2.5 text-sm text-ink-body"
            onClick={onClose}
          >
            指标设置
          </button>
        </div>
      </div>
    </div>
  );
}
