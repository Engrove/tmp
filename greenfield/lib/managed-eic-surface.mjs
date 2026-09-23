export const EIC_SURFACE_STATE_KEY = "eic.gf.eic-surface.v1";
export const EIC_SURFACE_GRACE_MS = 10_000;
const CHATGPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);

export function customGptRoot(value) {
  try {
    const u = new URL(String(value || ""));
    if (u.protocol !== "https:" || !CHATGPT_HOSTS.has(u.hostname)) return "";
    const parts = u.pathname.split("/").filter(Boolean);
    const i = parts.indexOf("g");
    return i >= 0 && parts[i + 1] ? `${u.origin}/g/${parts[i + 1]}` : "";
  } catch { return ""; }
}

export function classifyManagedEicSurface(url, expectedRoot = "") {
  const observedRoot = customGptRoot(url);
  const expected = customGptRoot(expectedRoot);
  if (observedRoot && (!expected || observedRoot === expected)) {
    return { ok: true, kind: "EIC_CUSTOM_GPT", observedRoot, expectedRoot: expected };
  }
  if (observedRoot && expected && observedRoot !== expected) {
    return { ok: false, kind: "WRONG_CUSTOM_GPT", observedRoot, expectedRoot: expected };
  }
  try {
    const u = new URL(String(url || ""));
    if (u.protocol === "https:" && CHATGPT_HOSTS.has(u.hostname)) {
      return { ok: false, kind: "GENERIC_CHATGPT", observedRoot: "", expectedRoot: expected };
    }
  } catch {}
  return { ok: false, kind: "UNSUPPORTED", observedRoot: "", expectedRoot: expected };
}

export async function readEicSurfaceState(storage = globalThis.chrome?.storage?.local) {
  if (!storage?.get) return { schema: "eic.greenfield.eic-surface.v1", lastKnownGoodEicUrl: "", updatedAt: "" };
  const r = await storage.get(EIC_SURFACE_STATE_KEY);
  const v = r?.[EIC_SURFACE_STATE_KEY] || {};
  return {
    schema: "eic.greenfield.eic-surface.v1",
    lastKnownGoodEicUrl: customGptRoot(v.lastKnownGoodEicUrl || ""),
    updatedAt: String(v.updatedAt || "")
  };
}

export async function rememberGoodEicUrl(url, storage = globalThis.chrome?.storage?.local, now = Date.now()) {
  const root = customGptRoot(url);
  if (!root) return readEicSurfaceState(storage);
  const next = { schema: "eic.greenfield.eic-surface.v1", lastKnownGoodEicUrl: root, updatedAt: new Date(now).toISOString() };
  await storage.set({ [EIC_SURFACE_STATE_KEY]: next });
  return next;
}

export function recoveryDecision({ observedUrl = "", processRoot = "", globalRoot = "", wrongSinceMs = 0, now = Date.now(), graceMs = EIC_SURFACE_GRACE_MS } = {}) {
  const expectedRoot = customGptRoot(processRoot) || customGptRoot(globalRoot);
  const c = classifyManagedEicSurface(observedUrl, expectedRoot);
  if (c.ok) return { action: "ACCEPT", expectedRoot: c.observedRoot, classification: c.kind, wrongSinceMs: 0 };
  if (!expectedRoot) return { action: "NO_KNOWN_EIC_URL", expectedRoot: "", classification: c.kind, wrongSinceMs: Number(wrongSinceMs || now) };
  const since = Number(wrongSinceMs || now);
  if (Number(now) - since < Number(graceMs)) return { action: "GRACE", expectedRoot, classification: c.kind, wrongSinceMs: since };
  return { action: "RECOVER", expectedRoot, classification: c.kind, wrongSinceMs: since };
}
