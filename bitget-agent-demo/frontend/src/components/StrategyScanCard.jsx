import AgentStatusBar from "./AgentStatusBar";
import { hideModelTerms } from "../utils/agentDisplay";
import XianIcon from "./XianIcon";

const TYPE_LABELS = {
  trend: "趋势跟踪",
  breakout_trend: "突破趋势",
  sar_macd: "SAR+MACD",
  grid: "网格交易",
  arbitrage: "套利",
};

const BIAS_ICON = { bullish: "trend-up", bearish: "trend-down", neutral: "neutral" };
const BIAS_LABEL = { bullish: "偏多", bearish: "偏空", neutral: "中性" };

function SignalRow({ dim, status, signal, icon }) {
  return (
    <div className="text-[13px] leading-relaxed text-ink-body">
      <span className="text-ink-faint">• {dim}：</span>
      {status}
      {signal && (
        <>
          {" "}
          <span className="text-ink-faint">· 信号：</span>
          {icon && <XianIcon name={icon} size={13} className="mx-0.5 -mt-0.5 inline-block align-middle" />}
          {signal}
        </>
      )}
    </div>
  );
}

export function SignalScanCard({ symbol, market, perception }) {
  const base = (symbol || market?.symbol || perception?.symbol || "BTCUSDT").replace("USDT", "");
  const price = market?.price;
  const ta = perception?.skills?.technicalAnalysis;
  const sent = perception?.skills?.sentimentAnalyst;
  const intel = perception?.skills?.marketIntel;
  const news = perception?.skills?.newsBriefing;
  const macro = perception?.skills?.macroAnalyst;
  const composite = perception?.composite || {};
  const signals = composite.signals || [];

  const bias = composite.bias || "neutral";
  const score = composite.score ?? 0;
  const scoreDisplay = `${(score * 100).toFixed(0)}`;

  return (
    <div className="mt-1 overflow-hidden rounded-xl border border-bitget-border/80 bg-bitget-panel/90">
      <div className="border-b border-bitget-border/60 px-3 py-2.5">
        <div className="font-semibold text-ink">
          {base} 信号扫描
        </div>
        {price != null && (
          <div className="mt-0.5 text-xs text-ink-faint">
            现价 ${Number(price).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
        )}
      </div>

      <div className="space-y-2 px-3 py-2.5">
        {perception?.deepseekPerception?.summary && (
          <div className="rounded-lg border border-bitget/25 bg-bitget/8 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold text-bitget">感知摘要</span>
              {perception.deepseekUsed && (
                <span className="rounded-full bg-bitget/12 px-1.5 py-0.5 text-[10px] text-bitget">
                  已接入
                </span>
              )}
              {composite.bias && (
                <span className="text-[10px] text-ink-faint">
                  {BIAS_LABEL[composite.bias] || composite.bias}
                  {score != null ? ` · ${scoreDisplay}` : ""}
                </span>
              )}
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-body">
              {hideModelTerms(perception.deepseekPerception.summary)}
            </p>
          </div>
        )}
        <div className="text-sm font-semibold text-ink-soft">综合信号评分</div>
        <SignalRow
          dim="综合偏向"
          status={`${BIAS_LABEL[bias] || "中性"} (${scoreDisplay})`}
          signal={BIAS_LABEL[bias]}
          icon={BIAS_ICON[bias]}
        />
        {signals.length > 0 && (
          <SignalRow
            dim="触发信号"
            status={signals.map((s) => s.signal).join(" · ")}
            signal={`${signals.length} 项`}
            icon="bolt"
          />
        )}
        {ta && (
          <SignalRow
            dim="价格结构"
            status={ta.summary || ta.trend || "—"}
            signal={ta.trend === "bearish" ? "偏空" : ta.trend === "bullish" ? "偏多" : "观望"}
            icon={ta.trend === "bearish" ? "trend-down" : ta.trend === "bullish" ? "trend-up" : "neutral"}
          />
        )}
        {ta?.sar && (
          <SignalRow
            dim="SAR"
            status={`SAR ${ta.sar.value} · 收盘 ${Number(ta.price || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
            signal={ta.sar.priceAboveSar ? "价在 SAR 上" : "价在 SAR 下"}
            icon={ta.sar.bullish ? "trend-up" : "trend-down"}
          />
        )}
        {ta?.macd && (
          <SignalRow
            dim="MACD"
            status={`DIF ${ta.macd.dif} · DEA ${ta.macd.dea} · 柱 ${ta.macd.hist}`}
            signal={ta.macd.bullish ? "多头" : ta.macd.bearish ? "空头" : "中性"}
            icon={ta.macd.bullish ? "trend-up" : ta.macd.bearish ? "trend-down" : "neutral"}
          />
        )}
        {ta?.volumeConfirmed != null && (
          <SignalRow
            dim="量能"
            status={ta.volumeConfirmed ? "MA(5) > MA(10)" : "MA(5) ≤ MA(10)"}
            signal={ta.volumeConfirmed ? "放量确认" : "量能偏弱"}
            icon={ta.volumeConfirmed ? "trend-up" : "neutral"}
          />
        )}
        {sent && (
          <>
            <SignalRow
              dim="恐惧贪婪"
              status={`F&G ${sent.fearGreed ?? "—"}`}
              signal={Number(sent.fearGreed) > 55 ? "贪婪" : Number(sent.fearGreed) < 45 ? "恐惧" : "中性"}
              icon={Number(sent.fearGreed) > 55 ? "warning" : Number(sent.fearGreed) < 45 ? "trend-down" : "neutral"}
            />
            {sent.fundingRate != null && (
              <SignalRow
                dim="资金费率"
                status={`${sent.fundingRate}%`}
                signal={Number(sent.fundingRate) > 0.01 ? "多头拥挤" : "正常"}
                icon={Number(sent.fundingRate) > 0.01 ? "warning" : "neutral"}
              />
            )}
            {sent.openInterest != null && (
              <SignalRow dim="持仓量 OI" status={String(sent.openInterest)} signal="—" icon="neutral" />
            )}
          </>
        )}
        {intel?.summary && (
          <SignalRow dim="市场情报" status={intel.summary} signal="—" icon="news" />
        )}
        {news?.headlines?.length > 0 && (
          <SignalRow
            dim="新闻简报"
            status={news.headlines.slice(0, 2).map((h) => h.title).join(" · ")}
            signal={`${news.headlines.length} 条`}
            icon="list"
          />
        )}
        {macro?.summary && (
          <SignalRow dim="宏观环境" status={macro.summary} signal={macro.bias || "—"} icon="globe" />
        )}
      </div>
    </div>
  );
}

export function StrategyCheckCard({ check, title = "策略条件校验" }) {
  if (!check?.checks?.length) return null;
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-bitget-border/80 bg-bitget-panel/90">
      <div className="border-b border-bitget-border/60 px-3 py-2.5">
        <div className="font-semibold text-ink">{title}</div>
        <div className="mt-0.5 text-xs text-ink-faint">{check.summary}</div>
      </div>
      <div className="space-y-2 px-3 py-2.5">
        {check.checks.map((item) => (
          <SignalRow
            key={item.id}
            dim={item.label}
            status={item.detail}
            signal={item.pass ? "满足" : "未满足"}
            icon={item.pass ? "check" : "cross"}
          />
        ))}
      </div>
      <div className="border-t border-bitget-border/40 px-3 py-2 text-[11px] text-ink-faint">
        {check.entryReady
          ? "入场条件已满足，策略池将按规则执行。"
          : "条件未齐，当前 tick 保持观望。"}
      </div>
    </div>
  );
}

/** @deprecated use StrategyCheckCard */
export function SarMacdCheckCard({ check }) {
  return <StrategyCheckCard check={check} title="SAR+MACD 条件校验" />;
}

export function AutonomousThoughtCard({ thought, confidence }) {
  if (!thought) return null;
  return (
    <div className="mt-2 rounded-xl border border-bitget/25 bg-bitget/8 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-bitget">自主思考</span>
        {confidence != null && (
          <span className="text-[10px] text-ink-faint">置信 {(confidence * 100).toFixed(0)}%</span>
        )}
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-body">{hideModelTerms(thought)}</p>
    </div>
  );
}

export function StrategyUpdateCard({ strategy, perception, lastAgent, autonomousThought }) {
  if (!strategy) return null;
  const typeLabel = TYPE_LABELS[strategy.type] || strategy.type;
  const rows = strategy.paramRows?.length ? strategy.paramRows : buildFallbackParamRows(strategy);
  const thought = autonomousThought || strategy.autonomousThought;

  return (
    <div className="mt-1 overflow-hidden rounded-xl border border-bitget-border/80 bg-bitget-panel/90">
      <div className="border-b border-bitget-border/60 px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="font-semibold text-ink">{strategy.name || "自定义策略"}</div>
          <div className="flex shrink-0 gap-1">
            {strategy.generatedBy === "autonomous" && (
              <span className="rounded-full bg-bitget/12 px-2 py-0.5 text-[10px] text-bitget">
                自主生成
              </span>
            )}
            <span className="rounded-full bg-bitget/15 px-2 py-0.5 text-[10px] text-bitget">
              {typeLabel}
            </span>
          </div>
        </div>
        <div className="mt-1 text-xs text-ink-faint">{strategy.summary}</div>
        <div className="mt-2">
          <AgentStatusBar perception={perception} lastAgent={lastAgent} compact />
        </div>
      </div>

      {thought && <div className="px-3 pt-2"><AutonomousThoughtCard thought={thought} confidence={strategy.autonomousConfidence} /></div>}

      <div className="space-y-2 px-3 py-2.5">
        <div className="text-sm font-semibold text-ink-soft">策略参数</div>
        {rows.map((row) => (
          <SignalRow
            key={row.dim}
            dim={row.dim}
            status={row.status}
            signal={row.signal}
            icon={row.icon || row.emoji}
          />
        ))}
      </div>

      <div className="border-t border-bitget-border/40 px-3 py-2.5 text-[13px] leading-relaxed text-ink-body">
        {strategy.generatedBy === "autonomous"
          ? "Agent 已自主分析市场并写入策略参数。"
          : "策略已解析并写入参数。已连接模拟 API 时将自动加入策略池运行。"}
      </div>
    </div>
  );
}

/** 旧策略无 paramRows 时的兜底展示 */
function buildFallbackParamRows(strategy) {
  const c = strategy.conditions || {};
  const r = strategy.risk || {};
  const isFut = strategy.category !== "spot";
  const venue = isFut ? "USDT 永续" : "现货";
  const entryDesc =
    strategy.type === "sar_macd"
      ? "SAR 之上 + MACD 多头 + 量能 MA5>MA10"
      : strategy.type === "breakout_trend"
        ? `${c.trendMaPeriod ?? 200}MA 过滤 · ${c.breakoutLookback ?? 20}K 高低突破 · 量>${c.volumeMultiplier ?? 1.5}x`
        : `突破 ${c.maPeriod ?? 20} 日均线 · 量比 > ${c.volumeMultiplier ?? 1.5}x`;
  const riskDesc =
    strategy.type === "breakout_trend"
      ? `单笔风险 ${r.riskPerTradePct ?? strategy.positionPct ?? 1}% · 盈亏比 ${r.rewardRiskRatio ?? 2}:1`
      : `止盈 ${r.takeProfitPct ?? "—"}% · 止损 ${r.stopLossPct ?? "—"}%`;

  const rows = [
    {
      dim: strategy.type === "breakout_trend" ? "交易对 / 周期" : "交易对 / 仓位",
      status: `${strategy.symbol} · ${venue}`,
      signal:
        strategy.type === "breakout_trend"
          ? `风险 ${r.riskPerTradePct ?? strategy.positionPct ?? 1}% · ${strategy.candleGranularity || "1H"}`
          : `仓位 ${strategy.positionPct ?? "—"}%`,
      icon: "gear",
    },
  ];
  if (isFut) {
    rows.push({
      dim: "杠杆倍数",
      status: `${strategy.leverage ?? 5}x · ${strategy.marginMode === "isolated" ? "逐仓" : "全仓"} · USDT 永续`,
      signal: "合约默认",
      icon: "bolt",
    });
  }
  rows.push(
    { dim: "入场条件", status: entryDesc, signal: "已写入", icon: "check" },
    {
      dim: "风控",
      status: riskDesc,
      signal: `回撤暂停 ${r.maxDrawdownPct ?? "—"}%`,
      icon: "shield",
    }
  );
  if (strategy.usePerception !== false) {
    rows.push({
      dim: "感知 Skill",
      status: "已启用 · 偏空拦截买入 · 手动卖出不拦截",
      signal: "联动执行层",
      icon: "brain",
    });
  }
  return rows;
}
