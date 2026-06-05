const STORAGE_KEY = "bitget_agent_custom_presets";

function makePresetId(symbol, type, seed = "") {
  const sym = (symbol || "X").replace(/USDT$/i, "");
  const t = type || "custom";
  return `custom_${Date.now()}_${sym}_${t}${seed ? `_${seed}` : ""}`;
}

/** 修复历史数据：重复/缺失 id 的策略各自分配唯一 id */
export function normalizeCustomPresets(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.map((p, i) => {
    let id = p.id;
    if (!id || seen.has(id)) {
      id = makePresetId(p.symbol, p.type, String(i));
    }
    seen.add(id);
    return {
      ...p,
      id,
      isCustom: p.isCustom !== false,
    };
  });
}

export function loadCustomPresets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const normalized = normalizeCustomPresets(parsed);
    const needsSave = normalized.some((p, i) => p.id !== parsed[i]?.id);
    if (needsSave) saveCustomPresets(normalized);
    return normalized;
  } catch {
    return [];
  }
}

export function saveCustomPresets(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function addCustomPreset(preset) {
  const list = loadCustomPresets();
  list.push({
    ...preset,
    id: preset.id || makePresetId(preset.symbol, preset.type),
    isCustom: true,
  });
  saveCustomPresets(list);
  return list;
}

/** 聊天/解析策略写入「我的策略」— 同 type+symbol 则更新，避免重复堆叠 */
export function upsertCustomPresetFromStrategy(strategy) {
  if (!strategy) return loadCustomPresets();
  const list = loadCustomPresets();
  const sym = strategy.symbol || "BTCUSDT";
  const type = strategy.type || "custom";
  const idx = list.findIndex((p) => p.isCustom && p.symbol === sym && p.type === type);
  const preset = {
    ...strategy,
    id: idx >= 0 ? list[idx].id : makePresetId(sym, type),
    name: strategy.name || "我的策略",
    isCustom: true,
    rawInstruction: strategy.rawInstruction || strategy.summary || "",
    updatedAt: new Date().toISOString(),
  };
  if (idx >= 0) list[idx] = preset;
  else list.push(preset);
  saveCustomPresets(list);
  return list;
}

/** 删除单条策略 — 优先按 symbol+type 精确匹配，避免重复 id 误删全部 */
export function removeCustomPreset(id, { symbol, type } = {}) {
  const list = loadCustomPresets();
  let idx = -1;

  if (symbol) {
    idx = list.findIndex(
      (p) => p.symbol === symbol && (p.type || "custom") === (type || "custom")
    );
  }
  if (idx < 0 && id) {
    idx = list.findIndex((p) => p.id === id);
  }

  if (idx < 0) return list;

  list.splice(idx, 1);
  saveCustomPresets(list);
  return list;
}

/** 展示用：合并 localStorage 列表与当前活跃策略 */
export function getMyStrategiesList(currentStrategy = null) {
  const list = loadCustomPresets();
  if (!currentStrategy) return list;
  const exists = list.some(
    (p) =>
      p.id === currentStrategy.id ||
      (p.symbol === currentStrategy.symbol && p.type === currentStrategy.type)
  );
  if (exists) return list;
  return [
    {
      ...currentStrategy,
      id: currentStrategy.id || makePresetId(currentStrategy.symbol, currentStrategy.type, "active"),
      name: currentStrategy.name || `${(currentStrategy.symbol || "BTC").replace(/USDT$/i, "")} 策略`,
      isCustom: true,
    },
    ...list,
  ];
}
