#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  fetchJson,
  yahooPrice,
  yahooOhlcv,
  getRate,
  pearson,
  dailyReturns,
  resolveSymbol,
  RATE_SERIES,
  fredLatest,
} from "./lib/fetch.js";

const server = new McpServer({
  name: "market-data-local",
  version: "1.0.0",
});

const FEED_KEYS = [
  "cointelegraph", "decrypt", "coindesk", "cnbc", "fed", "blockworks",
];

server.tool(
  "global_assets",
  "Yahoo Finance price/OHLCV (local proxy)",
  {
    action: z.enum(["price", "ohlcv"]),
    symbol: z.string(),
    period: z.enum(["1mo", "3mo", "6mo", "1y", "2y", "5y", "max"]).optional(),
    interval: z.enum(["1h", "1d", "1wk", "1mo"]).optional(),
  },
  async ({ action, symbol, period, interval }) => {
    if (action === "price") {
      return { content: [{ type: "text", text: JSON.stringify(await yahooPrice(symbol)) }] };
    }
    const data = await yahooOhlcv(symbol, period || "1y", interval || "1d");
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  }
);

server.tool(
  "sentiment_index",
  "Crypto Fear & Greed Index",
  {
    action: z.enum(["current", "history", "realtime"]),
    days: z.number().min(1).max(365).optional(),
  },
  async ({ action, days }) => {
    if (action === "current") {
      const data = await fetchJson("https://api.alternative.me/fng/?limit=1");
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
    const limit = days || 30;
    const data = await fetchJson(`https://api.alternative.me/fng/?limit=${limit}`);
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  }
);

server.tool(
  "crypto_market",
  "CoinGecko market data",
  {
    action: z.enum(["search", "price", "ohlcv", "markets", "trending", "global"]),
    coin_ids: z.string().optional(),
    coin_id: z.string().optional(),
    query: z.string().optional(),
    vs_currency: z.string().optional(),
    days: z.number().optional(),
    per_page: z.number().optional(),
    page: z.number().optional(),
  },
  async ({ action, coin_ids, vs_currency }) => {
    const vs = vs_currency || "usd";
    if (action === "price") {
      const ids = coin_ids || "bitcoin";
      const data = await fetchJson(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=${vs}&include_24hr_change=true`
      );
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
    if (action === "global") {
      const data = await fetchJson("https://api.coingecko.com/api/v3/global");
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
    if (action === "trending") {
      const data = await fetchJson("https://api.coingecko.com/api/v3/search/trending");
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
    throw new Error(`Unsupported crypto_market action: ${action}`);
  }
);

server.tool(
  "rates_yields",
  "US rates and yields (FRED or Yahoo proxy)",
  {
    action: z.enum(["yield_curve", "fed_funds", "rate", "history", "rates_snapshot", "series_list"]),
    rate_key: z.string().optional(),
    limit: z.number().optional(),
  },
  async ({ action, rate_key }) => {
    if (action === "series_list") {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            available_rates: Object.fromEntries(
              Object.keys(RATE_SERIES).map((k) => [k, k])
            ),
            note: "Set FRED_API_KEY for full FRED data; Yahoo proxy used as fallback",
          }),
        }],
      };
    }
    if (action === "rate" && rate_key) {
      return { content: [{ type: "text", text: JSON.stringify(await getRate(rate_key)) }] };
    }
    if (action === "yield_curve" || action === "rates_snapshot") {
      const keys = ["t3m", "t2y", "t5y", "t10y", "t30y", "spread_10y2y", "breakeven_10y"];
      const out = {};
      for (const k of keys) {
        try {
          out[k] = await getRate(k);
        } catch (e) {
          out[k] = { error: e.message };
        }
      }
      const t10 = out.t10y?.value;
      const t2 = out.t2y?.value;
      const spread = t10 != null && t2 != null ? Number(t10) - Number(t2) : out.spread_10y2y?.value;
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ...(action === "rates_snapshot" ? out : { yield_curve: out }),
            spread_10y2y: spread,
            inverted: spread != null ? spread < 0 : false,
          }),
        }],
      };
    }
    throw new Error(`Unsupported rates_yields action: ${action}`);
  }
);

server.tool(
  "macro_indicators",
  "Macro indicators via FRED (requires FRED_API_KEY)",
  {
    action: z.enum(["latest_release", "history", "fomc_news", "multi_indicator", "series_list"]),
    indicator: z.string().optional(),
    indicators: z.string().optional(),
    limit: z.number().optional(),
  },
  async ({ action, indicator, indicators }) => {
    const IND = {
      cpi: "CPIAUCSL",
      core_pce: "PCEPILFE",
      nonfarm_payrolls: "PAYEMS",
      gdp_growth: "GDP",
      unemployment: "UNRATE",
    };
    if (action === "series_list") {
      return { content: [{ type: "text", text: JSON.stringify({ indicators: IND }) }] };
    }
    if (action === "latest_release" && indicator) {
      const series = IND[indicator];
      if (!series) throw new Error(`Unknown indicator: ${indicator}`);
      return { content: [{ type: "text", text: JSON.stringify(await fredLatest(series)) }] };
    }
    if (action === "multi_indicator") {
      const keys = (indicators || "cpi,unemployment").split(",").map((s) => s.trim());
      const out = {};
      for (const k of keys) {
        try {
          out[k] = await fredLatest(IND[k]);
        } catch (e) {
          out[k] = { error: e.message };
        }
      }
      return { content: [{ type: "text", text: JSON.stringify(out) }] };
    }
    if (action === "fomc_news") {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            note: "FOMC RSS unavailable locally; use macro web sources or set FRED_API_KEY",
            items: [],
          }),
        }],
      };
    }
    throw new Error(`Unsupported macro_indicators action: ${action}`);
  }
);

server.tool(
  "cross_asset",
  "Rolling cross-asset correlation via Yahoo",
  {
    action: z.enum(["correlation", "assets_list", "heatmap"]),
    base: z.string().optional(),
    targets: z.string().optional(),
    period: z.enum(["30d", "90d", "180d", "1y", "2y", "5y"]).optional(),
    window: z.number().optional(),
    assets: z.string().optional(),
  },
  async ({ action, base, targets, period }) => {
    if (action === "assets_list") {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            assets: ["btc", "gold", "dxy", "ndx", "spx", "t10y", "vix", "oil"],
          }),
        }],
      };
    }
    const baseSym = resolveSymbol(base || "btc");
    const targetKeys = (targets || "gold,dxy,ndx,spx,t10y,vix").split(",").map((s) => s.trim());
    const range = period || "1y";
    const baseData = await yahooOhlcv(baseSym, range);
    const baseReturns = dailyReturns(baseData.rows.map((r) => r.close));
    const correlations = {};
    for (const t of targetKeys) {
      try {
        const sym = resolveSymbol(t);
        const tData = await yahooOhlcv(sym, range);
        const tReturns = dailyReturns(tData.rows.map((r) => r.close));
        const corr = pearson(baseReturns, tReturns);
        correlations[t] = { symbol: sym, correlation: corr, period: range };
      } catch (e) {
        correlations[t] = { error: e.message };
      }
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ base: baseSym, period: range, correlations }),
      }],
    };
  }
);

server.tool(
  "defi_analytics",
  "DeFiLlama DeFi data",
  {
    action: z.enum(["tvl_rank", "protocol", "chains", "fees", "yields", "stablecoins"]),
    protocol: z.string().optional(),
    limit: z.number().optional(),
    chain: z.string().optional(),
    min_tvl: z.number().optional(),
  },
  async ({ action, limit }) => {
    if (action === "tvl_rank") {
      const data = await fetchJson("https://api.llama.fi/protocols");
      const top = data
        .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
        .slice(0, limit || 10)
        .map((p) => ({ name: p.name, symbol: p.symbol, tvl: p.tvl, chain: p.chain }));
      return { content: [{ type: "text", text: JSON.stringify({ protocols: top }) }] };
    }
    if (action === "chains") {
      const data = await fetchJson("https://api.llama.fi/v2/chains");
      return { content: [{ type: "text", text: JSON.stringify(data.slice(0, limit || 10)) }] };
    }
    throw new Error(`Unsupported defi_analytics action: ${action}`);
  }
);

server.tool(
  "network_status",
  "On-chain public network stats",
  {
    action: z.enum(["eth_gas", "btc_fees", "btc_mempool", "btc_blocks"]),
  },
  async ({ action }) => {
    if (action === "btc_fees") {
      const data = await fetchJson("https://mempool.space/api/v1/fees/recommended");
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
    if (action === "btc_mempool") {
      const data = await fetchJson("https://mempool.space/api/mempool");
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
    throw new Error(`Unsupported network_status action: ${action}`);
  }
);

server.tool(
  "news_feed",
  "Crypto/macro RSS feeds (subset)",
  {
    action: z.enum(["latest", "sources"]),
    feeds: z.string().optional(),
    keyword: z.string().optional(),
    limit: z.number().optional(),
  },
  async ({ action, feeds, limit }) => {
    if (action === "sources") {
      return { content: [{ type: "text", text: JSON.stringify({ feeds: FEED_KEYS, total: FEED_KEYS.length }) }] };
    }
    const RSS = {
      cointelegraph: "https://cointelegraph.com/rss",
      coindesk: "https://www.coindesk.com/arc/outboundfeeds/rss/",
      decrypt: "https://decrypt.co/feed",
    };
    const keys = feeds === "all" ? Object.keys(RSS) : (feeds || "cointelegraph").split(",");
    const results = [];
    for (const key of keys) {
      const url = RSS[key.trim()];
      if (!url) {
        results.push({ feed: key, error: "feed not configured locally" });
        continue;
      }
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        const text = await res.text();
        const titles = [...text.matchAll(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/g)]
          .map((m) => m[1])
          .filter((t) => !t.includes("rss") && t.length > 10)
          .slice(0, limit || 5);
        results.push({ feed: key, items: titles.map((title) => ({ title })) });
      } catch (e) {
        results.push({ feed: key, error: e.message });
      }
    }
    return { content: [{ type: "text", text: JSON.stringify(results) }] };
  }
);

server.tool(
  "derivatives_sentiment",
  "Derivatives sentiment via Bitget public API",
  {
    action: z.enum(["reddit_trending", "long_short", "top_ls", "top_position", "open_interest", "taker_ratio"]),
    symbol: z.string().optional(),
    period: z.string().optional(),
    filter: z.string().optional(),
    limit: z.number().optional(),
  },
  async ({ action, symbol }) => {
    const sym = symbol || "BTCUSDT";
    if (action === "open_interest") {
      const data = await fetchJson(
        `https://api.bitget.com/api/v2/mix/market/open-interest?symbol=${sym}&productType=USDT-FUTURES`
      );
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
    if (action === "long_short") {
      const data = await fetchJson(
        `https://api.bitget.com/api/v2/mix/market/account-long-short?symbol=${sym}&productType=USDT-FUTURES&period=4h`
      );
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
    throw new Error(`Unsupported derivatives_sentiment action: ${action}`);
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
