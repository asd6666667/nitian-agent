/**
 * 在其它模块 fetch 之前加载 .env 并配置全局 HTTP 代理
 * Node 内置 EnvHttpProxyAgent 在部分 Clash 环境下 TLS 不稳定，改用 undici ProxyAgent
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { ProxyAgent, setGlobalDispatcher } from "undici";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config({ path: path.join(__dirname, "../../demo-bot/.env") });

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const useProxy = process.env.NODE_USE_ENV_PROXY === "1" || process.env.USE_PROXY === "1";

if (useProxy && proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.log(`[network] 已启用代理 → ${proxyUrl}`);
} else if (useProxy && !proxyUrl) {
  console.warn("[network] NODE_USE_ENV_PROXY=1 但未设置 HTTP_PROXY / HTTPS_PROXY");
}

export { proxyUrl, useProxy };
