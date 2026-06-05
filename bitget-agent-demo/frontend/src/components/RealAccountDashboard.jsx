import { useEffect, useState, useCallback } from "react";

import { api } from "../api";

import PnLAnalysisPanel from "./PnLAnalysisPanel";

import { formatLogAction, formatLogReason, logActionClass, futuresSideLabel, futuresSideClass, formatFuturesPrice, formatLiquidationPrice } from "../utils/simActivity";



const ACCOUNT_TABS = [

  { id: "spot", label: "现货" },

  { id: "futures", label: "合约" },

];



function Stat({ label, value, sub, highlight }) {

  return (

    <div className="rounded-lg bg-paper-sub/70 p-3">

      <div className="text-xs text-ink-faint">{label}</div>

      <div className={`font-mono text-base ${highlight ? "text-bitget" : "text-ink"}`}>{value}</div>

      {sub && <div className="mt-0.5 text-[10px] text-ink-faint">{sub}</div>}

    </div>

  );

}



function sumSpotUsd(account) {

  const assets = account?.spotAssets || account?.raw?.assets || [];

  const total = assets.reduce((s, a) => s + Number(a.usdValue ?? 0), 0);

  if (total > 0) return total;

  return Number(account?.accountEquity || 0) - Number(account?.unrealisedPnl || 0);

}



export default function RealAccountDashboard({ simStatus, strategy, simAccount: simAccountProp, syncToken = 0, onRefresh }) {

  const [account, setAccount] = useState(simAccountProp);

  const [logs, setLogs] = useState([]);

  const [orders, setOrders] = useState([]);

  const [pnlData, setPnlData] = useState(null);

  const [accountTab, setAccountTab] = useState("spot");

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState(null);



  const symbol = strategy?.symbol || "BTCUSDT";



  const load = useCallback(async (quiet = false) => {

    if (!simStatus?.configured) return;

    if (!quiet) setLoading(true);

    setError(null);

    try {

      const [acctRes, logRes, orderRes, pnlRes] = await Promise.allSettled([

        api.simAccount(),

        api.simLogs(50),

        api.simAllOrders([
          symbol,
          ...runningStrategies.map((s) => s.symbol),
        ].filter(Boolean)),

        api.simPnLAnalysis(180, symbol),

      ]);

      if (acctRes.status === "fulfilled") {

        setAccount(acctRes.value);

        onRefresh?.(acctRes.value);

      } else if (!quiet) {

        setError(acctRes.reason?.message || "账户加载失败");

      }

      if (logRes.status === "fulfilled") setLogs(logRes.value.logs || []);

      if (orderRes.status === "fulfilled") setOrders(orderRes.value.orders || []);

      if (pnlRes.status === "fulfilled" && pnlRes.value.configured) setPnlData(pnlRes.value);

    } catch (e) {

      if (!quiet) setError(e.message);

    } finally {

      if (!quiet) setLoading(false);

    }

  }, [simStatus?.configured, symbol, onRefresh]);



  useEffect(() => {

    if (simAccountProp?.configured) setAccount(simAccountProp);

  }, [simAccountProp]);



  useEffect(() => {

    if (simStatus?.configured) load();

  }, [simStatus?.configured, symbol, load]);



  useEffect(() => {

    if (!simStatus?.configured || !syncToken) return;

    load(true);

  }, [syncToken, simStatus?.configured, load]);



  useEffect(() => {

    if (!simStatus?.configured) return;

    const t = setInterval(() => load(true), 8000);

    return () => clearInterval(t);

  }, [simStatus?.configured, load]);



  if (!simStatus?.configured) {

    return (

      <div className="panel p-8 text-center text-ink-muted">

        <p className="mb-2">模拟 API 未连接</p>

        <p className="text-sm">请在 <code className="text-bitget">demo-bot/.env</code> 配置 Bitget Demo Key 并重启后端</p>

      </div>

    );

  }



  const assets = account?.raw?.assets || [];

  const accountEquity = Number(account?.accountEquity || account?.raw?.accountEquity || 0);

  const executedLogs = logs.filter((l) => l.executed);

  const buyCount = executedLogs.filter((l) => {
    const a = formatLogAction(l);
    return a === "买入" || a === "开多";
  }).length;

  const sellCount = executedLogs.filter((l) => {
    const a = formatLogAction(l);
    return a === "卖出" || a === "开空" || a === "平仓";
  }).length;



  const activeCategory = accountTab === "spot" ? pnlData?.spot : pnlData?.futures;

  const unrealisedTotal = Number(account?.unrealisedPnl || account?.raw?.unrealisedPnl || account?.raw?.usdtUnrealisedPnl || 0);

  const spotEquityLive = sumSpotUsd(account);

  const spotEquity = pnlData?.account?.spotEquity ?? pnlData?.spot?.equity ?? spotEquityLive;

  const futuresHasActivity = pnlData?.futures?.hasActivity ?? false;

  const futuresPositionsList =
    pnlData?.futures?.positions || account?.futuresPositions || [];

  const futuresUnrealised = futuresPositionsList.reduce(
    (s, p) => s + Number(p.unrealisedPnl || 0),
    0
  );

  const futuresEquity = futuresHasActivity ? (pnlData?.futures?.equity ?? 0) : 0;

  const futuresOpenMargin = pnlData?.futures?.margin ?? 0;

  const futuresIntervalPnl = pnlData?.futures?.totalPnl ?? 0;

  const futuresPositionCount = pnlData?.futures?.positionCount ?? futuresPositionsList.length ?? 0;



  return (

    <div className="space-y-4">

      <div className="panel border-bitget/30 p-4">

        <div className="mb-3 flex items-center justify-between">

          <div>

            <h3 className="text-sm font-semibold text-bitget">真实账户（逆天 模拟盘）</h3>

            <p className="text-xs text-ink-faint">

              数据来自 Bitget UTA V3 · 盈亏与上方账户权益同步

              {pnlData?.updatedAt && (

                <span className="ml-2 text-ink-faint">

                  · 更新 {new Date(pnlData.updatedAt).toLocaleTimeString("zh-CN")}

                </span>

              )}

            </p>

          </div>

          <button className="btn-ghost text-xs" onClick={() => load()} disabled={loading}>

            {loading ? "刷新中…" : "刷新账户"}

          </button>

        </div>



        <div className="mb-4 flex gap-1 rounded-lg border border-bitget-border bg-paper-sub/50 p-1">

          {ACCOUNT_TABS.map((t) => (

            <button

              key={t.id}

              type="button"

              onClick={() => setAccountTab(t.id)}

              className={`flex-1 rounded-md px-3 py-2 text-sm transition ${

                accountTab === t.id

                  ? "bg-bitget/20 font-semibold text-bitget"

                  : "text-ink-muted hover:text-ink-soft"

              }`}

            >

              {t.label}

            </button>

          ))}

        </div>



        {error && (

          <div className="mb-3 rounded border border-loss/40 bg-loss/10 px-3 py-2 text-xs text-loss">

            {error}

          </div>

        )}



        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">

          {accountTab === "spot" ? (

            <>

              <Stat

                label="现货权益"

                value={`$${spotEquity.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}

                highlight

              />

              <Stat

                label="USDT 可用"

                value={`$${Number(account?.usdt?.available || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}

              />

              <Stat

                label="区间盈亏"

                value={

                  pnlData?.spot?.totalPnl != null

                    ? `${pnlData.spot.totalPnl >= 0 ? "+" : ""}$${pnlData.spot.totalPnl.toFixed(2)}`

                    : "—"

                }

                sub={`${pnlData?.spot?.tradeCount ?? executedLogs.length} 笔成交`}

              />

              <Stat

                label="持仓币种"

                value={(pnlData?.spot?.assets || assets).filter((a) => a.coin !== "USDT" && Number(a.available || 0) > 0).length}

              />

            </>

          ) : (

            <>

              <Stat

                label="现货权益（参考）"

                value={`$${spotEquity.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}

                sub="合约页仅统计合约"

              />

              <Stat

                label="合约未实现盈亏"

                value={`${futuresUnrealised >= 0 ? "" : "-"}$${Math.abs(futuresUnrealised).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}

                sub="持仓浮盈/浮亏"

              />

              <Stat

                label="合约持仓"

                value={futuresPositionCount}

              />

              <Stat

                label="仓位保证金"

                value={`$${Number(futuresOpenMargin || futuresEquity).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}

                sub="非盈亏，为占用保证金"

              />

              <Stat

                label="开仓以来盈亏"

                value={`${futuresIntervalPnl >= 0 ? "+" : "-"}$${Math.abs(futuresIntervalPnl).toFixed(2)}`}

                sub="相对首次开仓快照"

              />

            </>

          )}

        </div>

      </div>



      {activeCategory && (

        <PnLAnalysisPanel

          title={activeCategory.label}

          equityCurve={activeCategory.equityCurve || []}

          initialCapital={activeCategory.initialCapital}

          currentEquity={
            accountTab === "spot"
              ? spotEquity
              : (pnlData?.futures?.totalPnl ?? 0)
          }

          symbol={symbol}

          unrealisedPnl={accountTab === "futures" ? futuresUnrealised : 0}

          metrics={{
            initialCapital: activeCategory.initialCapital,
            realizedPnl: accountTab === "futures" ? pnlData?.futures?.realizedPnl : undefined,
          }}

          emptyMessage={accountTab === "spot" ? "暂无现货交易记录" : "暂无合约盈亏数据"}

          footnote={

            accountTab === "futures"

              ? "* 未实现盈亏来自持仓浮盈/浮亏；开仓以来盈亏 = 未实现 + 已实现（不含保证金本金，新开仓不会虚增盈利）"

              : undefined

          }

        />

      )}



      {accountTab === "futures" && pnlData?.futures?.positions?.length > 0 && (

        <div className="panel p-4">

          <h4 className="mb-2 text-xs uppercase text-ink-faint">合约持仓</h4>

          <div className="overflow-x-auto">

            <table className="w-full text-xs">

              <thead className="text-ink-faint">

                <tr>

                  <th className="py-1 text-left">交易对</th>

                  <th className="py-1 text-left">方向</th>

                  <th className="py-1 text-right">数量</th>

                  <th className="py-1 text-right">开仓价</th>

                  <th className="py-1 text-right">现价</th>

                  <th className="py-1 text-right">强平价</th>

                  <th className="py-1 text-right">未实现盈亏</th>

                </tr>

              </thead>

              <tbody>

                {pnlData.futures.positions.map((p, i) => (

                  <tr key={p.symbol || i} className="border-t border-bitget-border/50">

                    <td className="py-1.5 font-medium">{p.symbol || "—"}</td>

                    <td className={`py-1.5 ${futuresSideClass(p)}`}>

                      {futuresSideLabel(p)}

                    </td>

                    <td className="py-1.5 text-right font-mono">{p.total || p.size || "—"}</td>

                    <td className="py-1.5 text-right font-mono text-ink-body">
                      {formatFuturesPrice(p.openPrice ?? p.avgPrice)}
                    </td>

                    <td className="py-1.5 text-right font-mono text-bitget">
                      {formatFuturesPrice(p.markPrice)}
                    </td>

                    <td className="py-1.5 text-right font-mono text-warn">
                      {formatLiquidationPrice(p.liquidationPrice)}
                    </td>

                    <td className={`py-1.5 text-right font-mono ${Number(p.unrealisedPnl || 0) >= 0 ? "text-profit" : "text-loss"}`}>

                      ${Number(p.unrealisedPnl || 0).toFixed(2)}

                    </td>

                  </tr>

                ))}

              </tbody>

            </table>

          </div>

        </div>

      )}



      {accountTab === "spot" && assets.length > 0 && (

        <div className="panel p-4">

          <h4 className="mb-2 text-xs uppercase text-ink-faint">资产明细</h4>

          <div className="overflow-x-auto">

            <table className="w-full text-xs">

              <thead className="text-ink-faint">

                <tr>

                  <th className="py-1 text-left">币种</th>

                  <th className="py-1 text-right">可用</th>

                  <th className="py-1 text-right">冻结</th>

                  <th className="py-1 text-right">USD 估值</th>

                </tr>

              </thead>

              <tbody>

                {assets

                  .filter((a) => Number(a.available || 0) > 0 || Number(a.usdValue || a.equity || 0) > 0.01)

                  .map((a) => (

                    <tr key={a.coin} className="border-t border-bitget-border/50">

                      <td className="py-1.5 font-medium">{a.coin}</td>

                      <td className="py-1.5 text-right font-mono">{a.available ?? "0"}</td>

                      <td className="py-1.5 text-right font-mono text-ink-faint">{a.frozen ?? "0"}</td>

                      <td className="py-1.5 text-right font-mono">

                        ${Number(a.usdValue ?? a.equity ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}

                      </td>

                    </tr>

                  ))}

              </tbody>

            </table>

          </div>

        </div>

      )}



      {accountTab === "spot" && orders.length > 0 && (

        <div className="panel p-4">

          <h4 className="mb-2 text-xs uppercase text-ink-faint">未成交挂单</h4>

          <div className="max-h-[140px] overflow-y-auto rounded border border-bitget-border text-xs">

            {orders.map((o) => (

              <div key={o.orderId} className="flex justify-between border-b border-bitget-border/50 px-3 py-2">

                <span className={o.side === "buy" ? "text-profit" : "text-loss"}>{o.side?.toUpperCase()}</span>

                <span className="font-mono">{o.qty} @ {o.price}</span>

              </div>

            ))}

          </div>

        </div>

      )}



      <div className="panel p-4 max-h-[320px] overflow-y-auto scroll-panel">

        <h4 className="mb-2 text-sm font-semibold">真实交易日志（demo-bot）</h4>

        {logs.length === 0 ? (

          <p className="text-sm text-ink-faint">暂无交易记录 · 在「模拟交易」页启动 bot 后将同步至此</p>

        ) : (

          <table className="w-full text-xs">

            <thead className="sticky top-0 bg-bitget-panel text-ink-faint">

              <tr>

                <th className="py-1 text-left">时间</th>

                <th className="py-1 text-left">方向</th>

                <th className="py-1 text-left">说明</th>

                <th className="py-1 text-right">状态</th>

              </tr>

            </thead>

            <tbody>

              {logs.map((log, i) => {

                const action = formatLogAction(log);

                return (

                  <tr key={i} className="border-t border-bitget-border/50">

                    <td className="py-1.5 text-ink-muted whitespace-nowrap">

                      {log.ts ? new Date(log.ts).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}

                    </td>

                    <td className={`py-1.5 font-medium ${logActionClass(action)}`}>

                      {action}

                    </td>

                    <td className="py-1.5 text-ink-muted max-w-[280px] truncate">{formatLogReason(log)}</td>

                    <td className={`py-1.5 text-right ${log.executed ? "text-profit" : "text-ink-faint"}`}>

                      {log.executed ? "已执行" : "跳过"}

                    </td>

                  </tr>

                );

              })}

            </tbody>

          </table>

        )}

      </div>

    </div>

  );

}

