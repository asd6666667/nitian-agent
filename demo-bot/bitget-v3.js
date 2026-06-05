import crypto from "node:crypto";

const BASE_URL = "https://api.bitget.com";

/** 运行时凭证（前端登录）；为空则回退 process.env */
let runtimeCredentials = null;
let ignoreEnvCredentials = false;

function envCredentials() {
  const apiKey = process.env.BITGET_API_KEY;
  const secretKey = process.env.BITGET_SECRET_KEY;
  const passphrase = process.env.BITGET_PASSPHRASE;
  if (!apiKey || !secretKey || !passphrase || apiKey.includes("your-")) return null;
  return { apiKey, secretKey, passphrase };
}

export function setBitgetCredentials(creds) {
  runtimeCredentials = creds
    ? {
        apiKey: creds.apiKey?.trim(),
        secretKey: creds.secretKey?.trim(),
        passphrase: creds.passphrase?.trim(),
      }
    : null;
}

export function setBitgetEnvIgnored(ignored) {
  ignoreEnvCredentials = !!ignored;
}

export function getBitgetCredentials() {
  if (runtimeCredentials) return runtimeCredentials;
  if (ignoreEnvCredentials) return null;
  return envCredentials();
}

export function hasBitgetCredentials() {
  return !!getBitgetCredentials();
}

function requireCredential(field) {
  const creds = getBitgetCredentials();
  const value = creds?.[field];
  if (!value) {
    throw new Error(`Missing Bitget API credential: ${field}`);
  }
  return value;
}

function signRequest(method, path, body) {
  const apiKey = requireCredential("apiKey");
  const secretKey = requireCredential("secretKey");
  const passphrase = requireCredential("passphrase");
  const timestamp = Date.now().toString();
  const payload = `${timestamp}${method.toUpperCase()}${path}${body}`;
  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(payload)
    .digest("base64");

  return {
    "ACCESS-KEY": apiKey,
    "ACCESS-SIGN": signature,
    "ACCESS-PASSPHRASE": passphrase,
    "ACCESS-TIMESTAMP": timestamp,
    "Content-Type": "application/json",
    paptrading: "1",
  };
}

async function request(method, path, bodyObj) {
  const body = bodyObj ? JSON.stringify(bodyObj) : "";
  const headers =
    method === "GET" && !path.includes("/spot/market/")
      ? signRequest(method, path, "")
      : method === "GET"
        ? { "Content-Type": "application/json" }
        : signRequest(method, path, body);

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body || undefined,
  });

  const data = await response.json();
  if (data.code !== "00000") {
    throw new Error(
      `Bitget API error (${data.code}): ${data.msg || "unknown"} [${method} ${path}]`
    );
  }
  return data;
}

export async function getAssets() {
  const result = await request("GET", "/api/v3/account/assets");
  return result.data;
}

export async function getTicker(symbol) {
  const result = await request(
    "GET",
    `/api/v2/spot/market/tickers?symbol=${symbol}`
  );
  return result.data?.[0];
}

/** USDT 永续合约 ticker */
export async function getFuturesTicker(symbol) {
  const result = await request(
    "GET",
    `/api/v2/mix/market/ticker?symbol=${symbol}&productType=USDT-FUTURES`
  );
  const row = result.data?.[0] || result.data;
  return Array.isArray(row) ? row[0] : row;
}

export async function setFuturesLeverage(symbol, leverage = "1") {
  const result = await request("POST", "/api/v3/account/set-leverage", {
    symbol,
    category: "USDT-FUTURES",
    coin: "USDT",
    leverage: String(leverage),
  });
  return result.data;
}

export async function getCandles(symbol, granularity, limit) {
  const result = await request(
    "GET",
    `/api/v2/spot/market/candles?symbol=${symbol}&granularity=${granularity}&limit=${limit}`
  );
  return result.data ?? [];
}

export async function placeSpotOrder({
  symbol,
  side,
  orderType,
  qty,
  price,
  timeInForce = "gtc",
}) {
  const clientOid = `bot-${Date.now()}`;
  const body = {
    category: "SPOT",
    symbol,
    side,
    orderType,
    qty: String(qty),
    timeInForce,
    clientOid,
  };
  if (price) body.price = price;

  const result = await request("POST", "/api/v3/trade/place-order", body);
  return { ...result.data, clientOid };
}

export async function getUnfilledOrders(symbol) {
  const result = await request(
    "GET",
    `/api/v3/trade/unfilled-orders?category=SPOT&symbol=${symbol}`
  );
  return result.data?.list ?? [];
}

export async function cancelSpotOrder({ symbol, orderId }) {
  const result = await request("POST", "/api/v3/trade/cancel-order", {
    category: "SPOT",
    symbol,
    orderId,
  });
  return result.data;
}

export async function cancelAllSpotOrders(symbol) {
  const orders = await getUnfilledOrders(symbol);
  const results = [];
  for (const o of orders) {
    if (!o.orderId) continue;
    try {
      results.push(await cancelSpotOrder({ symbol, orderId: o.orderId }));
    } catch (e) {
      results.push({ orderId: o.orderId, error: e.message });
    }
  }
  return results;
}

export async function getHistoryOrders(symbol, limit = 20) {
  const result = await request(
    "GET",
    `/api/v3/trade/history-orders?category=SPOT&symbol=${symbol}&limit=${limit}`
  );
  return result.data?.list ?? result.data ?? [];
}

export async function getFuturesHistoryOrders(symbol, limit = 20) {
  const result = await request(
    "GET",
    `/api/v3/trade/history-orders?category=USDT-FUTURES&symbol=${symbol}&limit=${limit}`
  );
  return result.data?.list ?? result.data ?? [];
}

export async function getFinancialRecords(limit = 20, params = {}) {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (params.category) qs.set("category", params.category);
  if (params.coin) qs.set("coin", params.coin);
  if (params.type) qs.set("type", params.type);
  if (params.startTime) qs.set("startTime", String(params.startTime));
  if (params.endTime) qs.set("endTime", String(params.endTime));
  if (params.cursor) qs.set("cursor", params.cursor);
  const result = await request(
    "GET",
    `/api/v3/account/financial-records?${qs.toString()}`
  );
  const data = result.data;
  if (params.raw) return data;
  return data?.list ?? data ?? [];
}

/** 分页拉取财务流水（单次窗口 ≤30 天，总窗口 ≤90 天） */
export async function fetchFinancialRecordsRange({
  category = "SPOT",
  startTime,
  endTime,
  coin,
  maxPages = 20,
} = {}) {
  const start = Number(startTime);
  const end = Number(endTime);
  if (!start || !end || end <= start) return [];

  const windowMs = 30 * 86400000;
  const all = [];
  let windowStart = start;

  while (windowStart < end) {
    const windowEnd = Math.min(end, windowStart + windowMs);
    let cursor = null;
    let pages = 0;

    do {
      const data = await getFinancialRecords(100, {
        category,
        coin,
        startTime: windowStart,
        endTime: windowEnd,
        cursor,
        raw: true,
      });
      const list = data?.list ?? [];
      all.push(...list);
      cursor = data?.cursor;
      pages += 1;
      if (!list.length || !cursor || pages >= maxPages) break;
    } while (cursor);

    windowStart = windowEnd + 1;
  }

  const seen = new Set();
  return all.filter((r) => {
    const id = r.id || `${r.ts}-${r.type}-${r.amount}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export async function getCurrentPositions(category = "USDT-FUTURES") {
  const result = await request(
    "GET",
    `/api/v3/position/current-position?category=${category}`
  );
  const data = result.data?.list ?? result.data;
  if (Array.isArray(data)) return data;
  if (data?.list && Array.isArray(data.list)) return data.list;
  return [];
}

const posModeCache = new Map();

/** 是否双向持仓（hedge）— 从持仓 posMode 读取 */
export async function getFuturesHedgeMode(symbol) {
  const sym = String(symbol || "").toUpperCase();
  if (posModeCache.has(sym)) return posModeCache.get(sym);

  try {
    const positions = await getCurrentPositions("USDT-FUTURES");
    const row =
      positions.find((p) => String(p.symbol || "").toUpperCase() === sym) ||
      positions[0];
    const mode = row?.posMode || row?.positionMode;
    if (mode) {
      const hedge = /hedge/i.test(String(mode));
      posModeCache.set(sym, hedge);
      return hedge;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function resolveFuturesOrderSide(side, posSide, isReduce) {
  let orderSide = String(side || "").toLowerCase();
  if (orderSide === "long") orderSide = isReduce ? "sell" : "buy";
  else if (orderSide === "short") orderSide = isReduce ? "buy" : "sell";
  else if (orderSide !== "buy" && orderSide !== "sell") {
    const ps = String(posSide || "long").toLowerCase();
    orderSide = isReduce ? (ps === "short" ? "buy" : "sell") : ps === "short" ? "sell" : "buy";
  }
  return orderSide;
}

function buildFuturesOrderBody({
  symbol,
  orderSide,
  orderType,
  qty,
  price,
  timeInForce,
  clientOid,
  hedgeMode,
  isReduce,
  posSide,
}) {
  const body = {
    category: "USDT-FUTURES",
    symbol,
    side: orderSide,
    orderType,
    qty: String(qty),
    timeInForce: orderType === "market" ? "ioc" : timeInForce,
    clientOid,
  };
  if (price) body.price = String(price);

  if (hedgeMode) {
    const inferred =
      isReduce
        ? orderSide === "sell"
          ? "long"
          : "short"
        : orderSide === "buy"
          ? "long"
          : "short";
    const ps = String(posSide || inferred).toLowerCase();
    body.posSide = ps === "short" ? "short" : "long";
  } else if (isReduce) {
    body.reduceOnly = "yes";
  }

  return body;
}

async function placeFuturesOrderOnce({
  symbol,
  side,
  posSide,
  orderType = "market",
  qty,
  price,
  timeInForce = "ioc",
  reduceOnly = "NO",
  hedgeMode = false,
}) {
  const clientOid = `bot-${Date.now()}`;
  const isReduce = String(reduceOnly).toUpperCase() === "YES";
  const orderSide = resolveFuturesOrderSide(side, posSide, isReduce);
  const body = buildFuturesOrderBody({
    symbol,
    orderSide,
    orderType,
    qty,
    price,
    timeInForce,
    clientOid,
    hedgeMode,
    isReduce,
    posSide,
  });

  const result = await request("POST", "/api/v3/trade/place-order", body);
  return { ...result.data, clientOid, hedgeMode };
}

/** USDT 永续合约下单（UTA V3）— 自动识别单向/双向持仓 */
export async function placeFuturesOrder(params) {
  const { symbol, hedgeMode: forcedMode } = params;
  let hedgeMode = forcedMode;
  if (hedgeMode == null) {
    hedgeMode = await getFuturesHedgeMode(symbol);
  }

  const modes = hedgeMode != null ? [hedgeMode] : [true, false];
  let lastErr;
  for (const hm of modes) {
    try {
      return await placeFuturesOrderOnce({ ...params, hedgeMode: hm });
    } catch (e) {
      lastErr = e;
      if (forcedMode != null || modes.length === 1) throw e;
      if (!/25236|25238|position open type|do not assign values/i.test(e.message)) throw e;
    }
  }
  throw lastErr;
}

/** 一键平掉全部合约仓位（UTA V3） */
export async function closeAllFuturesPositions({
  category = "USDT-FUTURES",
  symbol,
  posSide,
} = {}) {
  const body = { category };
  if (symbol) body.symbol = String(symbol).toUpperCase();
  if (posSide) body.posSide = posSide;
  const result = await request("POST", "/api/v3/trade/close-positions", body);
  return result.data;
}

export function findAsset(assets, coin) {
  return assets?.assets?.find((item) => item.coin === coin) ?? null;
}
