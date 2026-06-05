/**
 * 模拟盘 API 会话：支持前端随时登录 / 退出
 * 凭证仅存内存，不写磁盘
 */
import { setBitgetCredentials, setBitgetEnvIgnored, getBitgetCredentials, hasBitgetCredentials } from "../../../demo-bot/bitget-v3.js";
import { getAssets } from "../../../demo-bot/bitget-v3.js";

let loggedOut = false;
let loggedInAt = null;
let loginSource = null;

function maskKey(key) {
  if (!key || key.length < 8) return "****";
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

function envConfigured() {
  const k = process.env.BITGET_API_KEY;
  return !!(k && process.env.BITGET_SECRET_KEY && process.env.BITGET_PASSPHRASE && !k.includes("your-"));
}

export function isSimApiConfigured() {
  if (loggedOut) return false;
  return hasBitgetCredentials();
}

export function getSimAuthStatus() {
  const creds = loggedOut ? null : getBitgetCredentials();
  const configured = !!creds;
  return {
    configured,
    loggedOut,
    source: configured ? (loginSource || (envConfigured() ? "env" : "session")) : null,
    apiKeyPreview: configured ? maskKey(creds.apiKey) : null,
    loggedInAt,
  };
}

export async function connectSimApi({ apiKey, secretKey, passphrase }) {
  if (!apiKey?.trim() || !secretKey?.trim() || !passphrase?.trim()) {
    throw new Error("请填写 API Key、Secret Key 和 Passphrase");
  }

  setBitgetCredentials({ apiKey, secretKey, passphrase });
  setBitgetEnvIgnored(false);
  loggedOut = false;
  process.env.BITGET_API_KEY = apiKey.trim();
  process.env.BITGET_SECRET_KEY = secretKey.trim();
  process.env.BITGET_PASSPHRASE = passphrase.trim();

  try {
    await getAssets();
    try {
      const { resetAgentHubCache } = await import("./agentHubBridge.js");
      resetAgentHubCache();
    } catch { /* ignore */ }
    loginSource = "session";
    loggedInAt = new Date().toISOString();
    return getSimAuthStatus();
  } catch (e) {
    setBitgetCredentials(null);
    loginSource = envConfigured() ? "env" : null;
    throw new Error(`连接失败：${e.message}`);
  }
}

export function disconnectSimApi() {
  setBitgetCredentials(null);
  setBitgetEnvIgnored(true);
  loggedOut = true;
  loginSource = null;
  loggedInAt = null;
  return getSimAuthStatus();
}

export function resetSimLogoutFlag() {
  loggedOut = false;
  setBitgetEnvIgnored(false);
  if (envConfigured()) {
    loginSource = "env";
    loggedInAt = loggedInAt || new Date().toISOString();
  }
}
