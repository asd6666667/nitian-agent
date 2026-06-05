import { useState } from "react";
import { futuresSideLabel, futuresSideClass, formatFuturesPrice, formatLiquidationPrice } from "../utils/simActivity";

const TABS = [
  { id: "spot", label: "现货持仓" },
  { id: "futures", label: "合约持仓" },
];

function fmtUsd(v) {
  const n = Number(v);
  if (!n) return "$0.00";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export default function AccountHoldingsPanel({
  spotAssets = [],
  futuresPositions = [],
  pendingOrders = [],
  compact = false,
  defaultTab = "spot",
}) {
  const [tab, setTab] = useState(defaultTab);

  const spotNonUsdt = spotAssets.filter(
    (a) => a.coin !== "USDT" && (Number(a.available) > 0 || Number(a.frozen) > 0)
  );
  const spotRows = tab === "spot" ? spotAssets : [];
  const futuresRows = futuresPositions;

  const spotCount = spotAssets.filter((a) => Number(a.available) > 0 || Number(a.frozen) > 0).length;
  const futuresCount = futuresPositions.length;

  return (
    <div className={compact ? "" : "panel p-4"}>
      {!compact && (
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-ink-soft">持仓明细</h4>
          <span className="text-xs text-ink-faint">
            现货 {spotCount} · 合约 {futuresCount}
          </span>
        </div>
      )}

      <div className={`mb-3 flex gap-1 rounded-lg border border-bitget-border bg-paper-sub/50 p-1 ${compact ? "text-xs" : ""}`}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-md px-2 py-1.5 transition ${
              tab === t.id
                ? "bg-bitget/20 font-semibold text-bitget"
                : "text-ink-muted hover:text-ink-soft"
            }`}
          >
            {t.label}
            <span className="ml-1 opacity-60">
              ({t.id === "spot" ? spotCount : futuresCount})
            </span>
          </button>
        ))}
      </div>

      {tab === "spot" && (
        <div className="overflow-x-auto rounded-lg border border-bitget-border">
          {spotRows.length === 0 ? (
            <div className="p-4 text-center text-xs text-ink-faint">暂无现货资产</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-paper-sub/70 text-ink-faint">
                <tr>
                  <th className="px-3 py-2 text-left">币种</th>
                  <th className="px-3 py-2 text-right">可用</th>
                  <th className="px-3 py-2 text-right">冻结</th>
                  <th className="px-3 py-2 text-right">USD 估值</th>
                </tr>
              </thead>
              <tbody>
                {spotRows.map((a) => (
                  <tr key={a.coin} className="border-t border-bitget-border/50">
                    <td className="px-3 py-2 font-medium">{a.coin}</td>
                    <td className="px-3 py-2 text-right font-mono">{a.available}</td>
                    <td className="px-3 py-2 text-right font-mono text-ink-faint">{a.frozen || "0"}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtUsd(a.usdValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {spotNonUsdt.length > 0 && compact && (
            <div className="border-t border-bitget-border/50 px-3 py-2 text-[10px] text-ink-faint">
              非 USDT 现货：{spotNonUsdt.map((a) => `${a.coin} ${a.available}`).join(" · ")}
            </div>
          )}
          {pendingOrders.length > 0 && compact && (
            <div className="border-t border-bitget-border/50 px-3 py-2 text-[10px] text-warn">
              挂单中（未计入持仓）：
              {pendingOrders.map((o) => {
                const base = (o.symbol || "").replace("USDT", "") || "?";
                return ` ${o.side?.toUpperCase()} ${base} ${o.qty}@${o.price}`;
              }).join(" ·")}
            </div>
          )}
        </div>
      )}

      {tab === "futures" && (
        <div className="overflow-x-auto rounded-lg border border-bitget-border">
          {futuresRows.length === 0 ? (
            <div className="p-4 text-center text-xs text-ink-faint">暂无合约持仓</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-paper-sub/70 text-ink-faint">
                <tr>
                  <th className="px-3 py-2 text-left">交易对</th>
                  <th className="px-3 py-2 text-left">方向</th>
                  <th className="px-3 py-2 text-right">数量</th>
                  <th className="px-3 py-2 text-right">开仓价</th>
                  <th className="px-3 py-2 text-right">现价</th>
                  <th className="px-3 py-2 text-right">强平价</th>
                  <th className="px-3 py-2 text-right">杠杆</th>
                  <th className="px-3 py-2 text-right">未实现盈亏</th>
                </tr>
              </thead>
              <tbody>
                {futuresRows.map((p, i) => (
                  <tr key={p.symbol + i} className="border-t border-bitget-border/50">
                    <td className="px-3 py-2 font-medium">{p.symbol}</td>
                    <td className={`px-3 py-2 ${futuresSideClass(p)}`}>
                      {futuresSideLabel(p)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{p.size}</td>
                    <td className="px-3 py-2 text-right font-mono text-ink-body">
                      {formatFuturesPrice(p.openPrice ?? p.avgPrice)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-bitget">
                      {formatFuturesPrice(p.markPrice)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-warn">
                      {formatLiquidationPrice(p.liquidationPrice)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-ink-faint">{p.leverage}x</td>
                    <td className={`px-3 py-2 text-right font-mono ${p.unrealisedPnl >= 0 ? "text-profit" : "text-loss"}`}>
                      {fmtUsd(p.unrealisedPnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
