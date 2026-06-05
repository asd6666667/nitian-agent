/**
 * DeepSeek API 客户端 — Lite(Flash) / Premium(Pro) 双档
 */
const DEEPSEEK_BASE = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");

export function getDeepseekApiKey() {
  return (process.env.DEEPSEEK_API_KEY || "").trim();
}

export function isDeepseekConfigured() {
  return !!getDeepseekApiKey();
}

/** 最便宜：感知 / 聊天 / 策略解析 */
export function getDeepseekLiteModel() {
  return (
    process.env.DEEPSEEK_LITE_MODEL ||
    process.env.DEEPSEEK_PERCEPTION_MODEL ||
    "deepseek-v4-flash"
  );
}

/** 高质量：决策 / 风控 / 退出 */
export function getDeepseekPremiumModel() {
  return (
    process.env.DEEPSEEK_PREMIUM_MODEL ||
    process.env.DEEPSEEK_DECISION_MODEL ||
    "deepseek-v4-flash"
  );
}

/** @deprecated 使用 getDeepseekLiteModel */
export function getDeepseekPerceptionModel() {
  return getDeepseekLiteModel();
}

/** @deprecated 使用 getDeepseekPremiumModel */
export function getDeepseekDecisionModel() {
  return getDeepseekPremiumModel();
}

export function parseJsonContent(content) {
  let text = String(content || "").trim();
  if (!text) throw new Error("DeepSeek 返回内容为空");

  // 移除代码块标记（如果模型包了 markdown）
  text = text.replace(/```(?:json)?\s*/gi, "").replace(/\s*```/g, "").trim();
  if (!text) throw new Error("DeepSeek 返回内容为空（仅代码块标记）");

  // 提取第一个 { ... } 对象
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`DeepSeek 返回无法解析为 JSON（未找到 JSON 对象）: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    // 尝试修复常见问题：尾随逗号、单引号等
    const fixed = jsonMatch[0]
      .replace(/,\s*}/g, "}")
      .replace(/,\s*\]/g, "]")
      .replace(/'/g, '"')
      .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
    try {
      return JSON.parse(fixed);
    } catch {
      throw new Error(
        `DeepSeek 返回无法解析为 JSON: ${jsonMatch[0].slice(0, 300)}`
      );
    }
  }
}

export async function deepseekChat({ model, system, user, temperature = 0.15, json = true }) {
  const key = getDeepseekApiKey();
  if (!key) throw new Error("DEEPSEEK_API_KEY 未配置");

  const body = {
    model,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      { role: "user", content: user },
    ],
    temperature,
  };
  if (json) body.response_format = { type: "json_object" };

  const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(process.env.DEEPSEEK_TIMEOUT_MS) || 8000),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
    throw new Error(`DeepSeek API: ${msg}`);
  }

  return {
    content: data?.choices?.[0]?.message?.content || "",
    model,
    usage: data?.usage,
    calledAt: new Date().toISOString(),
  };
}

export async function deepseekChatLite(opts) {
  return deepseekChat({ ...opts, model: opts.model || getDeepseekLiteModel() });
}

export async function deepseekChatPremium(opts) {
  const model = opts.model || getDeepseekPremiumModel();
  try {
    const chat = await deepseekChat({ ...opts, model });
    // 如果 Pro 返回空内容，自动降级到 Flash
    if (!chat.content || chat.content.trim().length < 10) {
      const liteModel = getDeepseekLiteModel();
      if (liteModel !== model) {
        console.warn(`[deepseekClient] ${model} 返回空内容，降级到 ${liteModel}`);
        return deepseekChat({ ...opts, model: liteModel });
      }
    }
    return chat;
  } catch (e) {
    // Pro 调用失败时，自动降级到 Flash
    const liteModel = getDeepseekLiteModel();
    if (liteModel !== model) {
      console.warn(`[deepseekClient] ${model} 调用失败（${e.message.slice(0, 60)}），降级到 ${liteModel}`);
      return deepseekChat({ ...opts, model: liteModel });
    }
    throw e;
  }
}
