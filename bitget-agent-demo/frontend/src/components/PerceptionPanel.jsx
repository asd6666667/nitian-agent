const SKILL_LABELS = {
  "technical-analysis": "技术分析",
  "sentiment-analyst": "情绪分析",
  "market-intel": "市场情报",
  "news-briefing": "新闻简报",
  "macro-analyst": "宏观分析",
};

const BIAS_LABEL = { bullish: "偏多", bearish: "偏空", neutral: "中性" };
const BIAS_COLOR = { bullish: "text-profit", bearish: "text-loss", neutral: "text-ink-body" };

function formatSkillTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function PerceptionPanel({ perception, bitgetAccount, simStatus, hubStatus, refreshing = false }) {
  const bitget = hubStatus?.bitget;
  const { skills = {}, composite = { bias: "neutral", score: 0, signals: [] }, timestamp } = perception || {};

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">感知 Skill · Agent Hub</h2>
          <p className="text-xs text-ink-faint">
            5 大官方 Skill · 每 10 秒自动刷新
            {timestamp && <span className="ml-2 text-ink-faint">更新 {formatSkillTime(timestamp)}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {refreshing && (
            <span className="flex items-center gap-1 text-xs text-bitget">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-bitget" />
              刷新中
            </span>
          )}
          <div className={`text-sm font-medium ${BIAS_COLOR[composite?.bias] || "text-ink-body"}`}>
            综合 {BIAS_LABEL[composite?.bias] || "—"} ({composite?.score ?? 0})
          </div>
        </div>
      </div>

      {simStatus?.configured && (
        <div className="mb-3 rounded-lg border border-profit/30 bg-profit/5 px-3 py-2 text-xs">
          <span className="text-profit font-medium">demo-bot 模拟 API</span>
          <span className="mx-2 text-ink-faint">|</span>
          UTA V3 · 感知 Skill 联动策略自动执行；手动/强制买卖开平仓不受拦截
          {bitgetAccount?.usdt?.available != null && (
            <span className="ml-2 text-ink-muted">USDT {Number(bitgetAccount.usdt.available).toFixed(2)}</span>
          )}
          {bitgetAccount?.usdtAvailable != null && (
            <span className="ml-2 text-ink-muted">USDT {Number(bitgetAccount.usdtAvailable).toFixed(2)}</span>
          )}
        </div>
      )}

      <div className="space-y-2">
        <SkillRow
          skill="technical-analysis"
          summary={skills.technicalAnalysis?.summary || "加载中…"}
          detail={skills.technicalAnalysis ? `RSI ${skills.technicalAnalysis.rsi ?? "—"} · ${skills.technicalAnalysis.trend}` : null}
          updatedAt={skills.technicalAnalysis?.updatedAt}
          ok={skills.technicalAnalysis?.ok !== false}
        />
        <SkillRow
          skill="sentiment-analyst"
          summary={skills.sentimentAnalyst?.summary || "加载中…"}
          detail={
            skills.sentimentAnalyst && (
              <>
                F&G <span className="text-bitget">{skills.sentimentAnalyst.fearGreed}</span>
                {skills.sentimentAnalyst.fundingRate != null && (
                  <span className="ml-2">费率 {skills.sentimentAnalyst.fundingRate}%</span>
                )}
                {skills.sentimentAnalyst.openInterest != null && (
                  <span className="ml-2">OI {skills.sentimentAnalyst.openInterest}</span>
                )}
              </>
            )
          }
          updatedAt={skills.sentimentAnalyst?.updatedAt}
          ok={skills.sentimentAnalyst?.ok !== false}
        />
        <SkillRow
          skill="market-intel"
          summary={skills.marketIntel?.summary || "加载中…"}
          detail={
            skills.marketIntel?.defiTvlUsd
              ? `DeFi TVL $${(skills.marketIntel.defiTvlUsd / 1e9).toFixed(0)}B`
              : null
          }
          updatedAt={skills.marketIntel?.updatedAt}
          ok={skills.marketIntel?.ok !== false}
        />
        <SkillRow
          skill="news-briefing"
          summary={skills.newsBriefing?.summary || "加载中…"}
          detail={
            skills.newsBriefing?.headlines?.length > 1 && (
              <span className="line-clamp-1 opacity-70">+{skills.newsBriefing.headlines.length - 1} 条更多</span>
            )
          }
          updatedAt={skills.newsBriefing?.updatedAt}
          ok={skills.newsBriefing?.ok !== false}
        />
        <SkillRow
          skill="macro-analyst"
          summary={skills.macroAnalyst?.summary || "加载中…"}
          detail={skills.macroAnalyst?.dxy ? `DXY ${skills.macroAnalyst.dxy.toFixed(2)}` : null}
          updatedAt={skills.macroAnalyst?.updatedAt}
          ok={skills.macroAnalyst?.ok !== false}
        />
      </div>

      {composite?.signals?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {composite.signals.map((s, i) => (
            <span key={i} className="rounded bg-bitget-panel px-2 py-0.5 text-[10px] text-ink-muted">
              {s.signal}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SkillRow({ skill, summary, detail, updatedAt, ok = true }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${ok ? "bg-paper-sub/60" : "bg-loss/5 border border-loss/20"}`}>
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded bg-bitget/10 px-1.5 py-0.5 text-[10px] text-bitget">
          {SKILL_LABELS[skill] || skill}
        </span>
        <span className="flex-1 truncate text-xs text-ink-body">{summary}</span>
        {updatedAt && (
          <span className="shrink-0 text-[10px] text-ink-faint">{formatSkillTime(updatedAt)}</span>
        )}
      </div>
      {detail && <div className="mt-1 text-[11px] text-ink-faint">{detail}</div>}
    </div>
  );
}

export default PerceptionPanel;
