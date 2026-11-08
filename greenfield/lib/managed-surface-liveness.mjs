function integerId(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

export function managedSurfaceKey(windowId, tabId) {
  const w = integerId(windowId);
  const t = integerId(tabId);
  return w == null || t == null ? "" : `${w}:${t}`;
}

export function buildLiveManagedSurfaceIndex(
  windows = [],
  { isSupportedUrl = null } = {}
) {
  const keys = new Set();
  const urls = new Map();
  for (const windowValue of Array.isArray(windows) ? windows : []) {
    const windowId = integerId(windowValue?.id);
    if (windowId == null) continue;
    for (const tab of Array.isArray(windowValue?.tabs) ? windowValue.tabs : []) {
      const tabId = integerId(tab?.id);
      if (tabId == null) continue;
      const url = String(tab?.url || "");
      if (typeof isSupportedUrl === "function" && url && !isSupportedUrl(url)) continue;
      const key = managedSurfaceKey(windowId, tabId);
      keys.add(key);
      urls.set(key, url);
    }
  }
  return { keys, urls, verified: true };
}

export function managedSurfaceIsLive(process, index) {
  const key = managedSurfaceKey(process?.windowId, process?.tabId);
  return Boolean(key && index?.keys instanceof Set && index.keys.has(key));
}
