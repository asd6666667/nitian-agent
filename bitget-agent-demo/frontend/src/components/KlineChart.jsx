import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { TRADABLE_SYMBOLS } from "../utils/symbols";
import IndicatorModal from "./kline/IndicatorModal";
import {
  MAIN_INDICATORS,
  SUB_INDICATORS,
  MA_COLORS,
  BULL,
  BEAR,
  computeAllIndicators,
  lastVal,
} from "../utils/chartIndicators";

const GRANULARITIES = [
  { id: "1m", label: "1分" },
  { id: "15m", label: "15分" },
  { id: "1H", label: "1小时" },
  { id: "4H", label: "4小时" },
  { id: "1D", label: "日线" },
];

const IND_STORAGE = "bitget_kline_indicators";

function loadIndPrefs() {
  try {
    const raw = localStorage.getItem(IND_STORAGE);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  const main = Object.fromEntries(MAIN_INDICATORS.map((k) => [k, k === "MA"]));
  return { main, sub: "VOL" };
}

function saveIndPrefs(main, sub) {
  localStorage.setItem(IND_STORAGE, JSON.stringify({ main, sub }));
}

function formatTime(ts, gran, full = false) {
  const d = new Date(ts);
  const md = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (full || gran === "1m" || gran === "15m") return `${md} ${hm}`;
  if (gran === "1D") return md;
  return `${md} ${hm}`;
}

function formatPrice(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000) return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

function formatVol(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(2)}万`;
  return n.toFixed(2);
}

function polylineFromSeries(series, xAt, yScale, startIdx = 0) {
  return series
    .map((v, i) => (i >= startIdx && v != null ? `${xAt(i)},${yScale(v)}` : null))
    .filter(Boolean)
    .join(" ");
}

function BitgetChartSvg({
  candles,
  indicators,
  mainActive,
  subActive,
  livePrice,
  width,
  height,
  granularity,
  hoverIndex,
  onHover,
}) {
  const pad = { top: 8, right: 72, bottom: 22, left: 4 };
  const priceAxisX = width - pad.right;
  const subH = subActive && subActive !== "VOL" ? height * 0.14 : 0;
  const volH = height * 0.16;
  const priceH = height - pad.top - pad.bottom - volH - subH;

  const n = candles.length;
  const chartW = width - pad.left - pad.right;
  const slot = chartW / Math.max(n, 1);
  const bodyW = Math.max(2, Math.min(10, slot * 0.72));

  const { priceMin, priceMax, maxVol, subMin, subMax } = useMemo(() => {
    let pMin = Infinity;
    let pMax = -Infinity;
    let mVol = 0;
    for (const c of candles) {
      pMin = Math.min(pMin, c.low);
      pMax = Math.max(pMax, c.high);
    }
    if (mainActive.MA) {
      for (const s of [indicators.ma5, indicators.ma10, indicators.ma20]) {
        for (const v of s) {
          if (v != null) {
            pMin = Math.min(pMin, v);
            pMax = Math.max(pMax, v);
          }
        }
      }
    }
    if (mainActive.BOLL) {
      for (const s of [indicators.boll.upper, indicators.boll.lower]) {
        for (const v of s) {
          if (v != null) {
            pMin = Math.min(pMin, v);
            pMax = Math.max(pMax, v);
          }
        }
      }
    }
    if (livePrice != null) {
      pMin = Math.min(pMin, livePrice);
      pMax = Math.max(pMax, livePrice);
    }
    for (const c of candles) mVol = Math.max(mVol, c.volume || 0);

    let sMin = Infinity;
    let sMax = -Infinity;
    const subSeries = getSubSeries(indicators, subActive);
    for (const v of subSeries) {
      if (v != null && Number.isFinite(v)) {
        sMin = Math.min(sMin, v);
        sMax = Math.max(sMax, v);
      }
    }
    if (subActive === "MACD") {
      for (const v of [...indicators.macd.dif, ...indicators.macd.dea, ...indicators.macd.hist]) {
        if (v != null) {
          sMin = Math.min(sMin, v);
          sMax = Math.max(sMax, v);
        }
      }
    }
    if (subActive === "KDJ") {
      for (const v of [...indicators.kdj.k, ...indicators.kdj.d, ...indicators.kdj.j]) {
        if (v != null) {
          sMin = Math.min(sMin, v);
          sMax = Math.max(sMax, v);
        }
      }
    }
    if (subActive === "DMI") {
      for (const v of [...indicators.dmi.plus, ...indicators.dmi.minus, ...indicators.dmi.adx]) {
        if (v != null) {
          sMin = Math.min(sMin, v);
          sMax = Math.max(sMax, v);
        }
      }
    }

    const padP = (pMax - pMin) * 0.04 || pMax * 0.002;
    return {
      priceMin: pMin - padP,
      priceMax: pMax + padP,
      maxVol: mVol || 1,
      subMin: Number.isFinite(sMin) ? sMin * 1.05 : -1,
      subMax: Number.isFinite(sMax) ? sMax * 1.05 : 1,
    };
  }, [candles, indicators, mainActive, subActive, livePrice]);

  const xAt = (i) => pad.left + slot * i + slot / 2;
  const yPrice = (v) => pad.top + priceH - ((v - priceMin) / (priceMax - priceMin)) * priceH;
  const yVol = (v) => pad.top + priceH + volH - (v / maxVol) * volH;
  const ySub = (v) => {
    const range = subMax - subMin || 1;
    return pad.top + priceH + volH + subH - ((v - subMin) / range) * subH;
  };

  const visibleStart = 0;
  const displayPrice = livePrice ?? candles.at(-1)?.close;
  const priceY = displayPrice != null ? yPrice(displayPrice) : null;
  const latest = candles.at(-1);
  const priceChg = latest && displayPrice != null ? ((displayPrice - latest.open) / latest.open) * 100 : 0;
  const priceUp = priceChg >= 0;

  const localHigh = Math.max(...candles.slice(-30).map((c) => c.high));
  const localLow = Math.min(...candles.slice(-30).map((c) => c.low));

  const indexFromX = (clientX, rect) => {
    const x = clientX - rect.left;
    const i = Math.floor((x - pad.left) / slot);
    return Math.max(0, Math.min(n - 1, i));
  };

  const mainOverlays = [];
  if (mainActive.MA) {
    mainOverlays.push(
      { key: "ma5", series: indicators.ma5, color: MA_COLORS[0], label: "MA5" },
      { key: "ma10", series: indicators.ma10, color: MA_COLORS[1], label: "MA10" },
      { key: "ma20", series: indicators.ma20, color: MA_COLORS[2], label: "MA20" }
    );
  }
  if (mainActive.EMA) {
    mainOverlays.push(
      { key: "ema12", series: indicators.ema12, color: MA_COLORS[3], label: "EMA12" },
      { key: "ema26", series: indicators.ema26, color: MA_COLORS[4], label: "EMA26" }
    );
  }
  if (mainActive.BOLL) {
    mainOverlays.push(
      { key: "bollU", series: indicators.boll.upper, color: "#9A8B78", label: "BOLL上" },
      { key: "bollM", series: indicators.boll.mid, color: "#7A6F5F", label: "BOLL中" },
      { key: "bollL", series: indicators.boll.lower, color: "#9A8B78", label: "BOLL下" }
    );
  }
  if (mainActive.SAR) mainOverlays.push({ key: "sar", series: indicators.sar, color: "#8B6914", label: "SAR", dots: true });
  if (mainActive.AVL) mainOverlays.push({ key: "avl", series: indicators.avl, color: "#2B6B6B", label: "AVL" });
  if (mainActive.RESIST) mainOverlays.push({ key: "resist", series: indicators.resist, color: "#A83232", label: "RESIST", dash: true });
  if (mainActive.SUPER) mainOverlays.push({ key: "super", series: indicators.super, color: "#3A8F8F", label: "SUPER" });
  if (mainActive.VWAP) mainOverlays.push({ key: "vwap", series: indicators.vwap, color: "#6B5E4F", label: "VWAP" });

  return (
    <svg
      width={width}
      height={height}
      className="select-none touch-none bg-bitget-panel"
      onMouseMove={(e) => onHover(indexFromX(e.clientX, e.currentTarget.getBoundingClientRect()))}
      onMouseLeave={() => onHover(null)}
      onTouchMove={(e) => {
        const t = e.touches[0];
        if (t) onHover(indexFromX(t.clientX, e.currentTarget.getBoundingClientRect()));
      }}
    >
      {/* 右侧价格轴背景 */}
      <rect
        x={priceAxisX}
        y={pad.top}
        width={pad.right}
        height={priceH + volH + subH}
        fill="#EDE6D8"
        opacity={0.95}
      />

      {[0, 0.25, 0.5, 0.75, 1].map((r) => {
        const v = priceMin + (priceMax - priceMin) * r;
        const y = yPrice(v);
        return (
          <g key={r}>
            <line x1={pad.left} x2={priceAxisX} y1={y} y2={y} stroke="#D4C7B0" strokeDasharray="3 3" />
            <text x={width - 8} y={y + 4} textAnchor="end" fill="#7A6F5F" fontSize={10} fontFamily="monospace">
              {formatPrice(v)}
            </text>
          </g>
        );
      })}

      {candles.map((c, i) => {
        const x = xAt(i);
        const up = c.close >= c.open;
        const color = up ? BULL : BEAR;
        const yHigh = yPrice(c.high);
        const yLow = yPrice(c.low);
        const yOpen = yPrice(c.open);
        const yClose = yPrice(c.close);
        const top = Math.min(yOpen, yClose);
        const h = Math.max(Math.abs(yClose - yOpen), 1);
        const dim = hoverIndex != null && hoverIndex !== i;
        return (
          <g key={c.time} opacity={dim ? 0.35 : 1}>
            <line x1={x} x2={x} y1={yHigh} y2={yLow} stroke={color} strokeWidth={1} />
            <rect x={x - bodyW / 2} y={top} width={bodyW} height={h} fill={color} />
            <rect
              x={x - bodyW / 2}
              y={yVol(c.volume || 0)}
              width={bodyW}
              height={pad.top + priceH + volH - yVol(c.volume || 0)}
              fill={color}
              opacity={0.55}
            />
          </g>
        );
      })}

      {mainOverlays.map((o) =>
        o.dots ? (
          o.series.map((v, i) =>
            v != null && i >= visibleStart ? (
              <circle key={`${o.key}-${i}`} cx={xAt(i)} cy={yPrice(v)} r={2} fill={o.color} />
            ) : null
          )
        ) : (
          <polyline
            key={o.key}
            points={polylineFromSeries(o.series, xAt, yPrice, visibleStart)}
            fill="none"
            stroke={o.color}
            strokeWidth={1.2}
            strokeDasharray={o.dash ? "4 3" : undefined}
          />
        )
      )}

      {subActive === "VOL" && (
        <>
          <polyline
            points={polylineFromSeries(indicators.volMa5, xAt, yVol, visibleStart)}
            fill="none"
            stroke={MA_COLORS[0]}
            strokeWidth={1}
          />
          <polyline
            points={polylineFromSeries(indicators.volMa10, xAt, yVol, visibleStart)}
            fill="none"
            stroke={MA_COLORS[1]}
            strokeWidth={1}
          />
        </>
      )}

      {subActive && subActive !== "VOL" && subH > 0 && renderSubIndicator({
        subActive,
        indicators,
        xAt,
        ySub,
        visibleStart,
        pad,
        priceH,
        volH,
        width,
      })}

      {hoverIndex != null && hoverIndex < n && (
        <line
          x1={xAt(hoverIndex)}
          x2={xAt(hoverIndex)}
          y1={pad.top}
          y2={pad.top + priceH + volH + subH}
          stroke="#D4C7B0"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      )}

      {priceY != null && displayPrice != null && (
        <>
          <line
            x1={pad.left}
            x2={priceAxisX}
            y1={priceY}
            y2={priceY}
            stroke={priceUp ? BULL : BEAR}
            strokeDasharray="4 4"
            opacity={0.85}
          />
          <rect
            x={priceAxisX + 2}
            y={priceY - 11}
            width={pad.right - 6}
            height={22}
            rx={3}
            fill={priceUp ? BULL : BEAR}
          />
          <text
            x={priceAxisX + pad.right / 2 - 1}
            y={priceY + 4}
            textAnchor="middle"
            fill="#fff"
            fontSize={10}
            fontWeight="600"
            fontFamily="monospace"
          >
            {formatPrice(displayPrice)}
          </text>
        </>
      )}

      {/* 区间高低点标注 — 右侧 */}
      <text x={width - 8} y={yPrice(localHigh) + 3} textAnchor="end" fill={BULL} fontSize={9} fontFamily="monospace">
        {formatPrice(localHigh)}
      </text>
      <text x={width - 8} y={yPrice(localLow) + 3} textAnchor="end" fill={BEAR} fontSize={9} fontFamily="monospace">
        {formatPrice(localLow)}
      </text>

      {[0, Math.floor(n / 2), n - 1].filter((i) => i >= 0).map((i) => (
        <text key={i} x={xAt(i)} y={height - 4} textAnchor="middle" fill="#9A8B78" fontSize={9}>
          {formatTime(candles[i].time, granularity)}
        </text>
      ))}
    </svg>
  );
}

function getSubSeries(indicators, sub) {
  switch (sub) {
    case "RSI": return indicators.rsi;
    case "ROC": return indicators.roc;
    case "CCI": return indicators.cci;
    case "WR": return indicators.wr;
    case "OBV": return indicators.obv;
    case "StochRSI": return indicators.stochRsi;
    case "MFI": return indicators.mfi;
    case "DMA": return indicators.dma;
    case "MTM": return indicators.mtm;
    case "EMV": return indicators.emv;
    default: return [];
  }
}

function renderSubIndicator({ subActive, indicators, xAt, ySub, visibleStart }) {
  const lines = [];
  if (subActive === "MACD") {
    lines.push(
      { series: indicators.macd.dif, color: MA_COLORS[0] },
      { series: indicators.macd.dea, color: MA_COLORS[1] },
      { series: indicators.macd.hist, color: "#546E7A", bars: true }
    );
  } else if (subActive === "KDJ") {
    lines.push(
      { series: indicators.kdj.k, color: MA_COLORS[0] },
      { series: indicators.kdj.d, color: MA_COLORS[1] },
      { series: indicators.kdj.j, color: MA_COLORS[2] }
    );
  } else if (subActive === "DMI") {
    lines.push(
      { series: indicators.dmi.plus, color: BULL },
      { series: indicators.dmi.minus, color: BEAR },
      { series: indicators.dmi.adx, color: MA_COLORS[2] }
    );
  } else {
    lines.push({ series: getSubSeries(indicators, subActive), color: MA_COLORS[0] });
  }

  return lines.map((l, idx) =>
    l.bars ? (
      l.series.map((v, i) =>
        v != null && i >= visibleStart ? (
          <rect
            key={`${subActive}-bar-${i}`}
            x={xAt(i) - 2}
            y={v >= 0 ? ySub(v) : ySub(0)}
            width={4}
            height={Math.abs(ySub(v) - ySub(0)) || 1}
            fill={v >= 0 ? BULL : BEAR}
            opacity={0.7}
          />
        ) : null
      )
    ) : (
      <polyline
        key={`${subActive}-${idx}`}
        points={polylineFromSeries(l.series, xAt, ySub, visibleStart)}
        fill="none"
        stroke={l.color}
        strokeWidth={1}
      />
    )
  );
}

export default function KlineChart({
  candles = [],
  symbol = "BTCUSDT",
  source,
  granularity = "1H",
  category = "USDT-FUTURES",
  symbols = TRADABLE_SYMBOLS,
  loading = false,
  livePrice,
  ticker24h,
  onSymbolChange,
  onGranularityChange,
}) {
  const prefs = loadIndPrefs();
  const [mainActive, setMainActive] = useState(prefs.main);
  const [subActive, setSubActive] = useState(prefs.sub);
  const [modalOpen, setModalOpen] = useState(false);
  const [hoverIndex, setHoverIndex] = useState(null);
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const setContainerNode = useCallback((node) => {
    containerRef.current = node;
    if (node) {
      const w = node.getBoundingClientRect().width;
      if (w > 0) setContainerWidth(w);
    }
  }, []);

  const hasCandles = candles.length > 0;

  useEffect(() => {
    if (!hasCandles) return;
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setContainerWidth(w);
    };

    measure();
    const raf = requestAnimationFrame(measure);

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [hasCandles, symbol, granularity]);

  useEffect(() => {
    saveIndPrefs(mainActive, subActive);
  }, [mainActive, subActive]);

  useEffect(() => {
    setHoverIndex(null);
  }, [symbol, granularity]);

  const allData = useMemo(() => candles.slice(-200), [candles]);

  const BAR_PX = 7;
  const RIGHT_PAD = 72;
  const chartWidth = Math.max(containerWidth, 320);
  const maxBars = Math.max(40, Math.floor((chartWidth - RIGHT_PAD - 8) / BAR_PX));
  const displayData = useMemo(() => {
    if (!allData.length) return [];
    return allData.slice(-Math.min(allData.length, maxBars));
  }, [allData, maxBars]);

  const indicators = useMemo(() => computeAllIndicators(displayData), [displayData]);

  const symbolOptions = useMemo(() => {
    const list = symbols?.length ? symbols : TRADABLE_SYMBOLS;
    if (symbol && !list.includes(symbol)) return [symbol, ...list];
    return list;
  }, [symbols, symbol]);

  const displayPrice = livePrice ?? ticker24h?.last ?? displayData.at(-1)?.close;
  const chg24 = ticker24h?.change24h ?? 0;
  const up = chg24 >= 0;

  const maLegend = [
    { label: "MA(5)", val: lastVal(indicators.ma5), color: MA_COLORS[0] },
    { label: "MA(10)", val: lastVal(indicators.ma10), color: MA_COLORS[1] },
    { label: "MA(20)", val: lastVal(indicators.ma20), color: MA_COLORS[2] },
  ];

  const volLegend = [
    { label: "MA(5)", val: lastVal(indicators.volMa5) },
    { label: "MA(10)", val: lastVal(indicators.volMa10) },
  ];

  const chartHeight = subActive && subActive !== "VOL" ? 440 : 400;

  const quickMain = (id) => {
    setMainActive((prev) => {
      const next = Object.fromEntries(MAIN_INDICATORS.map((k) => [k, k === id]));
      return next;
    });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-bitget-border/80 bg-bitget-panel shadow-panel">
      {/* 顶部行情 — Bitget 风格 */}
      <div className="border-b border-bitget-border/50 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-ink">{symbol.replace("USDT", "/USDT")}</span>
              <span className="rounded bg-bitget/15 px-1.5 py-0.5 text-[10px] text-bitget">
                {category === "USDT-FUTURES" ? "永续" : "现货"}
              </span>
            </div>
            <div className={`mt-1 font-mono text-3xl font-bold ${up ? "text-profit" : "text-loss"}`}>
              {formatPrice(displayPrice)}
            </div>
            <div className={`text-xs font-mono ${up ? "text-profit" : "text-loss"}`}>
              {up ? "+" : ""}{Number(chg24).toFixed(2)}%
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-right text-xs">
            <div>
              <div className="text-ink-faint">24h 高</div>
              <div className="font-mono text-ink-soft">{formatPrice(ticker24h?.high24h ?? displayData.at(-1)?.high)}</div>
            </div>
            <div>
              <div className="text-ink-faint">24h 低</div>
              <div className="font-mono text-ink-soft">{formatPrice(ticker24h?.low24h ?? displayData.at(-1)?.low)}</div>
            </div>
            <div>
              <div className="text-ink-faint">24h 量({symbol.replace("USDT", "")})</div>
              <div className="font-mono text-ink-soft">{formatVol(ticker24h?.baseVolume24h)}</div>
            </div>
            <div>
              <div className="text-ink-faint">24h 额(USDT)</div>
              <div className="font-mono text-ink-soft">{formatVol(ticker24h?.quoteVolume24h)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* 周期切换 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-bitget-border/40 px-3 py-2">
        <select
          value={symbol}
          onChange={(e) => onSymbolChange?.(e.target.value)}
          className="rounded border border-bitget-border bg-paper-sub px-2 py-1 text-xs text-ink-body outline-none"
        >
          {symbolOptions.map((s) => (
            <option key={s} value={s}>{s.replace("USDT", "/USDT")}</option>
          ))}
        </select>
        <div className="flex gap-0.5">
          {GRANULARITIES.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => onGranularityChange?.(g.id)}
              className={`px-3 py-1 text-xs transition ${
                granularity === g.id
                  ? "font-semibold text-ink underline decoration-bitget decoration-2 underline-offset-4"
                  : "text-ink-faint hover:text-ink-body"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
        {source && (
          <span className="ml-auto text-[10px] text-ink-faint" title={source}>
            Bitget API · {source}
          </span>
        )}
      </div>

      {/* MA / VOL 数值行 */}
      {mainActive.MA && (
        <div className="flex flex-wrap gap-4 px-3 py-1.5 text-[11px] font-mono">
          {maLegend.map((m) => (
            <span key={m.label} style={{ color: m.color }}>
              {m.label}: {formatPrice(m.val)}
            </span>
          ))}
        </div>
      )}
      {subActive === "VOL" && (
        <div className="flex flex-wrap gap-4 px-3 pb-1 text-[11px] font-mono text-ink-muted">
          <span className="text-ink-faint">VOL</span>
          {volLegend.map((v) => (
            <span key={v.label}>{v.label}: {formatVol(v.val)}</span>
          ))}
        </div>
      )}

      {loading && !candles.length ? (
        <div className="flex h-[420px] items-center justify-center text-ink-faint animate-pulse">
          从 Bitget 加载 K 线…
        </div>
      ) : !candles.length ? (
        <div className="flex h-[420px] items-center justify-center text-ink-faint">
          暂无 K 线 · 请确认后端已启动且网络可访问 api.bitget.com
        </div>
      ) : (
        <div ref={setContainerNode} className="relative w-full min-h-[400px]">
          {displayData.length > 0 ? (
            <BitgetChartSvg
              candles={displayData}
              indicators={indicators}
              mainActive={mainActive}
              subActive={subActive}
              livePrice={displayPrice}
              width={chartWidth}
              height={chartHeight}
              granularity={granularity}
              hoverIndex={hoverIndex}
              onHover={setHoverIndex}
            />
          ) : (
            <div className="flex h-[400px] items-center justify-center text-ink-faint text-sm">
              暂无 K 线数据
            </div>
          )}
        </div>
      )}

      {/* 底部指标快捷栏 — 同 Bitget App */}
      <div className="flex items-center gap-1 overflow-x-auto border-t border-bitget-border/40 px-2 py-2">
        {MAIN_INDICATORS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => quickMain(id)}
            className={`shrink-0 px-2.5 py-1 text-xs ${
              mainActive[id] ? "font-semibold text-bitget" : "text-ink-faint hover:text-ink-body"
            }`}
          >
            {id}
          </button>
        ))}
        <div className="mx-1 h-4 w-px bg-bitget-border/60" />
        {SUB_INDICATORS.slice(0, 7).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setSubActive(id)}
            className={`shrink-0 px-2.5 py-1 text-xs ${
              subActive === id ? "font-semibold text-bitget" : "text-ink-faint hover:text-ink-body"
            }`}
          >
            {id === "StochRSI" ? "Stoch" : id}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="ml-auto shrink-0 rounded-lg bg-paper-sub/90 px-3 py-1 text-xs text-ink-body"
        >
          指标 ▾
        </button>
      </div>

      <IndicatorModal
        open={modalOpen}
        main={mainActive}
        sub={subActive}
        onMainChange={setMainActive}
        onSubChange={setSubActive}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
