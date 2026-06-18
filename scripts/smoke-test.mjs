/**
 * 烟雾测试: 验证 Bitget Demo API 凭证 + 连通性 + DeepSeek 凭证
 * 只读取账户信息, 绝不下单
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// 简易 .env 加载 (不依赖 dotenv 包)
const envPath = path.resolve("bitget-agent-demo/backend/.env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const BITGET_BASE = "https://api.bitget.com";

function signedHeaders(method, path, body = "") {
  const ts = Date.now().toString();
  const payload = `${ts}${method.toUpperCase()}${path}${body}`;
  const sig = crypto
    .createHmac("sha256", process.env.BITGET_SECRET_KEY)
    .update(payload)
    .digest("base64");
  return {
    "ACCESS-KEY": process.env.BITGET_API_KEY,
    "ACCESS-SIGN": sig,
    "ACCESS-PASSPHRASE": process.env.BITGET_PASSPHRASE,
    "ACCESS-TIMESTAMP": ts,
    "Content-Type": "application/json",
    paptrading: "1",
  };
}

async function testBitgetPublic() {
  const r = await fetch(`${BITGET_BASE}/api/v2/spot/market/tickers?symbol=BTCUSDT`, {
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json();
  return { ok: j.code === "00000", price: j.data?.[0]?.lastPr, msg: j.msg };
}

async function testBitgetAuth() {
  const path = "/api/v2/spot/account/assets";
  const r = await fetch(`${BITGET_BASE}${path}`, {
    method: "GET",
    headers: signedHeaders("GET", path, ""),
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json();
  return {
    ok: j.code === "00000",
    code: j.code,
    msg: j.msg,
    assetCount: j.data?.length || 0,
    sample: (j.data || [])
      .filter((a) => Number(a.available) > 0 || Number(a.frozen) > 0)
      .slice(0, 5)
      .map((a) => ({ coin: a.coin, available: a.available, frozen: a.frozen })),
  };
}

async function testDeepseek() {
  const r = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_LITE_MODEL || "deepseek-chat",
      messages: [{ role: "user", content: "reply with the word: OK" }],
      max_tokens: 5,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  return {
    ok: r.ok && !!j.choices?.[0]?.message?.content,
    status: r.status,
    reply: j.choices?.[0]?.message?.content,
    err: j.error?.message,
  };
}

const out = {};
try { out.publicMarket = await testBitgetPublic(); } catch (e) { out.publicMarket = { ok: false, err: e.message }; }
try { out.bitgetAuth = await testBitgetAuth(); } catch (e) { out.bitgetAuth = { ok: false, err: e.message }; }
try { out.deepseek = await testDeepseek(); } catch (e) { out.deepseek = { ok: false, err: e.message }; }

console.log(JSON.stringify(out, null, 2));
process.exit(out.bitgetAuth.ok && out.deepseek.ok ? 0 : 1);
