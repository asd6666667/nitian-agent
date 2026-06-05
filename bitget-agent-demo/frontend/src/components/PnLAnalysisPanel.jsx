import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

const TABS = [
  { id: "daily", label: "每日盈亏" },
  { id: "cumulative", label: "累计盈亏" },
  { id: "rate", label: "累计盈亏率" },
  { id: "asset", label: "资产走势" },
];

const RANGES = [
  { id: 7, label: "7天" },
  { id: 30, label: "30天" },
  { id: 90, label: "90天" },
  { id: 180, label: "180天" },
];

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function fmtDate(ts, style = "md") {
  const d = new Date(ts);
  if (style === "md") return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (style === "ym") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function fmtMoney(v, digits = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v >= 0 ? "" : "-";
  return `${sign}$${Math.abs(v).toFixed(digits)}`;
}

function fmtPct(v) {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function filterByRange(points, days) {
  if (!points.length) return [];
  const end = points.at(-1).time;
  const start = end - days * 86400000;
  return points.filter((p) => p.time >= start);
}

function aggregateDaily(equityCurve, initialCapital) {
  const byDay = new Map();

  for (const p of equityCurve) {
    const key = new Date(p.time).toDateString();
    byDay.set(key, { time: p.time, equity: p.equity, price: p.price });
  }

  const sorted = [...byDay.entries()].sort((a, b) => a[1].time - b[1].time);
  const daily = [];
  for (let i = 0; i < sorted.length; i++) {
    const [, cur] = sorted[i];
    const prev = i > 0 ? sorted[i - 1][1].equity : initialCapital;
    daily.push({
      time: cur.time,
      dateKey: sorted[i][0],
      pnl: cur.equity - prev,
      equity: cur.equity,
      price: cur.price,
    });
  }
  return daily;
}

function buildSeries(equityCurve, initialCapital, days) {
  const sliced = filterByRange(equityCurve, days);
  if (!sliced.length) return { daily: [], chart: [], basePrice: null };

  const basePrice = sliced[0].price;
  const daily = aggregateDaily(sliced, initialCapital);

  const chart = sliced.map((p) => ({
    time: p.time,
    label: fmtDate(p.time),
    cumulativePnl: +(p.equity - initialCapital).toFixed(2),
    returnPct: initialCapital > 0
      ? +(((p.equity - initialCapital) / initialCapital) * 100).toFixed(3)
      : 0,
    btcReturnPct: basePrice ? +(((p.price - basePrice) / basePrice) * 100).toFixed(3) : 0,
    equity: +p.equity.toFixed(2),
    realizedPnl: +(p.equity - initialCapital).toFixed(2),
    unrealizedPnl: 0,
  }));

  return { daily, chart, basePrice };
}

function CalendarView({ daily, monthOffset = 0, onMonthOffsetChange }) {
  const ref = daily.at(-1)?.time || Date.now();
  const refDate = new Date(ref);
  refDate.setMonth(refDate.getMonth() + monthOffset);
  const y = refDate.getFullYear();
  const m = refDate.getMonth();
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayKey = new Date().toDateString();

  const pnlMap = new Map(daily.map((d) => [new Date(d.time).toDateString(), d.pnl]));

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push({ empty: true, key: `e${i}` });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(y, m, d);
    const key = date.toDateString();
    const pnl = pnlMap.get(key);
    cells.push({
      day: d,
      key,
      pnl,
      hasData: pnlMap.has(key),
      isToday: key === todayKey,
    });
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-sm">
        <button
          type="button"
          className="btn-ghost px-2 py-0.5 text-xs"
          onClick={() => onMonthOffsetChange?.(monthOffset - 1)}
        >
          ‹
        </button>
        <span className="font-medium text-ink-soft">{y}-{String(m + 1).padStart(2, "0")}</span>
        <button
          type="button"
          className="btn-ghost px-2 py-0.5 text-xs"
          onClick={() => onMonthOffsetChange?.(monthOffset + 1)}
          disabled={monthOffset >= 0}
        >
          ›
        </button>
      </div>
      <div className="max-h-[280px] overflow-y-auto overscroll-contain">
        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-1 text-ink-faint">{w}</div>
          ))}
          {cells.map((c) => {
            if (c.empty) return <div key={c.key} />;
            const pos = c.pnl > 0;
            const neg = c.pnl < 0;
            return (
              <div
                key={c.key}
                className={`rounded-lg py-2 ${
                  c.isToday
                    ? "ring-1 ring-bitget/50"
                    : ""
                } ${
                  neg ? "bg-loss/15" : pos ? "bg-profit/10" : c.hasData ? "bg-paper-sub/70" : "bg-paper-sub/50"
                }`}
              >
                <div className={c.isToday ? "text-bitget font-medium" : "text-ink-muted"}>
                  {c.isToday ? "今天" : c.day}
                </div>
                {c.hasData && (
                  <div className={`mt-0.5 font-mono text-[10px] ${neg ? "text-loss" : pos ? "text-profit" : "text-ink-faint"}`}>
                    {c.pnl >= 0 ? "+" : ""}{c.pnl.toFixed(2)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ items }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
      {items.map((item) => (
        <div key={item.label}>
          <div className="flex items-center gap-1.5 text-xs text-ink-faint">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: item.color || "#6B7280" }} />
            {item.label}
          </div>
          <div className={`mt-1 font-mono text-lg font-semibold ${
            item.value > 0 ? "text-profit" : item.value < 0 ? "text-loss" : "text-ink-soft"
          }`}>
            {item.display}
          </div>
        </div>
      ))}
    </div>
  );
}

function PnLLineChart({ data, lines, height = 220, yFormatter }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#D4C7B0" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: "#9A8B78", fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis tick={{ fill: "#9A8B78", fontSize: 10 }} width={48} tickFormatter={yFormatter} />
        <Tooltip
          contentStyle={{ background: "#FAF6ED", border: "1px solid #D4C7B0", borderRadius: 8, fontSize: 12, color: "#3D3428" }}
        />
        <ReferenceLine y={0} stroke="#D4C7B0" strokeDasharray="4 4" />
        {lines.map((l) => (
          <Line
            key={l.key}
            type="monotone"
            dataKey={l.key}
            stroke={l.color}
            dot={false}
            isAnimationActive={false}
            strokeWidth={2}
            name={l.name}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export default function PnLAnalysisPanel({
  equityCurve = [],
  assetEquityCurve,
  metrics,
  initialCapital = 10000,
  assetInitialCapital,
  currentEquity,
  assetCurrentEquity,
  symbol = "BTC",
  title = "盈亏分析",
  footnote,
  emptyMessage = "暂无盈亏数据",
  unrealisedPnl = 0,
  mode = "spot",
}) {
  const [tab, setTab] = useState("daily");
  const [range, setRange] = useState(7);
  const [dailyMode, setDailyMode] = useState("calendar");
  const [monthOffset, setMonthOffset] = useState(0);

  const isFutures = mode === "futures";
  const capital = metrics?.initialCapital ?? initialCapital;
  const assetCapital = assetInitialCapital ?? initialCapital;

  const liveCurve = useMemo(() => {
    if (!equityCurve.length) return equityCurve;
    if (currentEquity == null) return equityCurve;
    const now = Date.now();
    const next = [...equityCurve];
    const last = next.at(-1);
    if (last && now - last.time < 86400000) {
      next[next.length - 1] = { ...last, time: now, equity: currentEquity };
    } else {
      next.push({ time: now, equity: currentEquity, price: last?.price ?? null });
    }
    return next;
  }, [equityCurve, currentEquity]);

  const liveAssetCurve = useMemo(() => {
    const base = assetEquityCurve?.length ? assetEquityCurve : isFutures ? [] : liveCurve;
    if (!base.length) return base;
    if (assetCurrentEquity == null) return base;
    const now = Date.now();
    const next = [...base];
    const last = next.at(-1);
    if (last && now - last.time < 86400000) {
      next[next.length - 1] = { ...last, time: now, equity: assetCurrentEquity };
    } else {
      next.push({ time: now, equity: assetCurrentEquity, price: last?.price ?? null });
    }
    return next;
  }, [assetEquityCurve, assetCurrentEquity, isFutures, liveCurve]);

  const { daily, chart } = useMemo(
    () => buildSeries(liveCurve, capital, range),
    [liveCurve, capital, range]
  );

  const { chart: assetChart } = useMemo(
    () => buildSeries(liveAssetCurve, assetCapital, range),
    [liveAssetCurve, assetCapital, range]
  );

  const latest = chart.at(-1);
  const totalPnl = latest?.cumulativePnl ?? 0;
  const totalRate = latest?.returnPct ?? 0;
  const btcRate = latest?.btcReturnPct ?? 0;
  const realizedPnl = metrics?.realizedPnl;
  const realized = realizedPnl ?? (totalPnl - unrealisedPnl);

  const dailyChartData = daily.map((d) => ({
    label: fmtDate(d.time),
    pnl: +d.pnl.toFixed(2),
  }));

  const chartDisplay = useMemo(() => {
    if (!unrealisedPnl || !chart.length) return chart;
    return chart.map((c, i) => {
      if (i !== chart.length - 1) {
        return { ...c, unrealizedPnl: 0, realizedPnl: c.cumulativePnl };
      }
      return {
        ...c,
        unrealizedPnl: +unrealisedPnl.toFixed(2),
        realizedPnl: +(c.cumulativePnl - unrealisedPnl).toFixed(2),
      };
    });
  }, [chart, unrealisedPnl]);

  const latestAsset = assetChart.at(-1);

  if (!liveCurve.length && !liveAssetCurve.length) {
    return (
      <div className="panel p-8 text-center text-sm text-ink-faint">{emptyMessage}</div>
    );
  }

  const defaultFootnote =
    footnote ??
    "* 数据来自 Bitget UTA V3 财务流水与实时账户权益；每 8 秒自动刷新";

  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-bitget-border px-4 pt-4">
        <h3 className="mb-3 text-base font-semibold">{title}</h3>
        <div className="flex gap-4 overflow-x-auto text-sm">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`shrink-0 pb-2 transition ${
                tab === t.id
                  ? "border-b-2 border-bitget font-semibold text-ink"
                  : "text-ink-faint hover:text-ink-body"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-bitget-border px-4 py-3">
        {RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRange(r.id)}
            className={`rounded-full px-3 py-1 text-xs transition ${
              range === r.id
                ? "bg-bitget/20 text-bitget"
                : "bg-bitget-panel text-ink-muted hover:text-ink-soft"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="p-4">
        {tab === "daily" && (
          <>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-ink-body">每日盈亏</span>
              <div className="flex rounded-lg border border-bitget-border overflow-hidden text-xs">
                <button
                  type="button"
                  onClick={() => setDailyMode("calendar")}
                  className={`px-2.5 py-1 ${dailyMode === "calendar" ? "bg-bitget/20 text-bitget" : "text-ink-faint"}`}
                >
                  日历
                </button>
                <button
                  type="button"
                  onClick={() => setDailyMode("chart")}
                  className={`px-2.5 py-1 ${dailyMode === "chart" ? "bg-bitget/20 text-bitget" : "text-ink-faint"}`}
                >
                  图表
                </button>
              </div>
            </div>
            {dailyMode === "calendar" ? (
              <CalendarView daily={daily} monthOffset={monthOffset} onMonthOffsetChange={setMonthOffset} />
            ) : (
              <PnLLineChart
                data={dailyChartData}
                lines={[{ key: "pnl", color: "#2B6B6B", name: "每日盈亏" }]}
                yFormatter={(v) => `$${v}`}
              />
            )}
          </>
        )}

        {tab === "cumulative" && (
          <>
            <div className="mb-1 text-xs text-ink-faint">{latest ? fmtDate(latest.time) : ""}</div>
            <SummaryRow
              items={[
                { label: "总盈亏", value: totalPnl, display: fmtMoney(totalPnl), color: "#2B6B6B" },
                { label: "已实现盈亏", value: realized, display: fmtMoney(realized), color: "#8B6914" },
                { label: "未实现盈亏", value: unrealisedPnl, display: fmtMoney(unrealisedPnl), color: "#9A8B78" },
              ]}
            />
            <PnLLineChart
              data={chartDisplay}
              lines={[
                { key: "cumulativePnl", color: "#2B6B6B", name: "总盈亏" },
                { key: "realizedPnl", color: "#8B6914", name: "已实现盈亏" },
                ...(unrealisedPnl !== 0
                  ? [{ key: "unrealizedPnl", color: "#9A8B78", name: "未实现盈亏" }]
                  : []),
              ]}
              yFormatter={(v) => `$${v}`}
            />
          </>
        )}

        {tab === "rate" && (
          <>
            <div className="mb-1 text-xs text-ink-faint">{latest ? fmtDate(latest.time) : ""}</div>
            <SummaryRow
              items={[
                { label: "累计盈亏率", value: totalRate, display: fmtPct(totalRate), color: "#2B6B6B" },
                { label: `${symbol.replace("USDT", "")} 累计涨跌幅`, value: btcRate, display: fmtPct(btcRate), color: "#3A8F8F" },
              ]}
            />
            <PnLLineChart
              data={chart}
              lines={[
                { key: "returnPct", color: "#2B6B6B", name: "累计盈亏率" },
                { key: "btcReturnPct", color: "#3A8F8F", name: "基准涨跌幅" },
              ]}
              yFormatter={(v) => `${v}%`}
            />
          </>
        )}

        {tab === "asset" && (
          <>
            <div className="mb-1 text-xs text-ink-faint">{latestAsset ? fmtDate(latestAsset.time) : latest ? fmtDate(latest.time) : ""}</div>
            <SummaryRow
              items={[
                {
                  label: isFutures ? "当前合约权益" : "当前资产",
                  value: latestAsset?.equity,
                  display: fmtMoney(latestAsset?.equity ?? latest?.equity),
                  color: "#2B6B6B",
                },
                {
                  label: isFutures ? "期初合约权益" : "初始本金",
                  value: assetCapital,
                  display: fmtMoney(assetCapital),
                  color: "#9A8B78",
                },
              ]}
            />
            <PnLLineChart
              data={liveAssetCurve.length ? assetChart : chart}
              lines={[{ key: "equity", color: "#2B6B6B", name: isFutures ? "合约权益" : "资产走势" }]}
              yFormatter={(v) => `$${v}`}
            />
          </>
        )}

        <p className="mt-4 text-[10px] leading-relaxed text-ink-faint">
          {defaultFootnote}
        </p>
      </div>
    </div>
  );
}
