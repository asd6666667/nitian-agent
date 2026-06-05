const KEY = "bitget_agent_running_strategies";

export function loadRunningStrategies() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveRunningStrategies(list) {
  localStorage.setItem(KEY, JSON.stringify(list || []));
}
