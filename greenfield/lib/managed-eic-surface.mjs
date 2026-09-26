import "./safety-policy.js";

const S = globalThis.GreenfieldSafetyPolicy;
export const EIC_SURFACE_STATE_KEY = "eic.gf.eic-surface.v1";
export const EIC_SURFACE_GRACE_MS = 10_000;
const CHATGPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);

export function customGptRoot(value) {
  return S.gptRef(value)?.root || "";
}

// v1.8.7: the GPT identity is the id token (g-<id>); the newer ChatGPT shell
// drops the name slug from its URLs (/g/g-<id>/c/...). Same id = same GPT.
export const sameGpt = (a, b) => S.sameGpt(a, b);
export const gptSlug = (value) => S.gptRef(value)?.slug || "";
export const canonicalGptRoot = (value) => S.gptRef(value)?.canonicalRoot || "";

// Of two roots of the same GPT, keep the one that carries the name slug: the
// slug is what proves the GPT by name where ChatGPT shows it at "/".
export function preferNamedRoot(primary, secondary = "") {
  const a = customGptRoot(primary);
  const b = customGptRoot(secondary);
  if (!a) return b;
  if (!b || !S.sameGpt(a, b)) return a;
  return gptSlug(a) || !gptSlug(b) ? a : b;
}

// Root for a queue start or rotation: the tab's GPT, else the process's GPT,
// else the last GPT verified as EIC. Never a generic ChatGPT address: a
// generic root lands in standard chat in ChatGPT's newer shell.
export function resolveManagedGptRoot(url = "", processRoot = "", globalRoot = "") {
  const live = customGptRoot(url);
  const prior = customGptRoot(processRoot);
  const global = customGptRoot(globalRoot);
  if (live) return preferNamedRoot(preferNamedRoot(live, prior), global);
  if (prior) return preferNamedRoot(prior, global);
  return global;
}

export function classifyManagedEicSurface(url, expectedRoot = "") {
  const observedRoot = customGptRoot(url);
  const expected = customGptRoot(expectedRoot);
  if (observedRoot && (!expected || S.sameGpt(observedRoot, expected))) {
    return { ok: true, kind: "EIC_CUSTOM_GPT", observedRoot: preferNamedRoot(expected, observedRoot) || observedRoot, expectedRoot: expected };
  }
  if (observedRoot && expected) {
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
  const observed = customGptRoot(url);
  if (!observed) return readEicSurfaceState(storage);
  // A slugless URL of the same GPT never erases the remembered name slug.
  const prior = await readEicSurfaceState(storage);
  const root = preferNamedRoot(observed, prior.lastKnownGoodEicUrl);
  if (prior.lastKnownGoodEicUrl === root) return prior;
  const next = { schema: "eic.greenfield.eic-surface.v1", lastKnownGoodEicUrl: root, updatedAt: new Date(now).toISOString() };
  await storage.set({ [EIC_SURFACE_STATE_KEY]: next });
  return next;
}

export function recoveryDecision({ observedUrl = "", processRoot = "", globalRoot = "", wrongSinceMs = 0, now = Date.now(), graceMs = EIC_SURFACE_GRACE_MS } = {}) {
  const expectedRoot = preferNamedRoot(processRoot, globalRoot);
  const c = classifyManagedEicSurface(observedUrl, expectedRoot);
  if (c.ok) return { action: "ACCEPT", expectedRoot: c.observedRoot, classification: c.kind, wrongSinceMs: 0 };
  if (!expectedRoot) return { action: "NO_KNOWN_EIC_URL", expectedRoot: "", classification: c.kind, wrongSinceMs: Number(wrongSinceMs || now) };
  const since = Number(wrongSinceMs || now);
  if (Number(now) - since < Number(graceMs)) return { action: "GRACE", expectedRoot, classification: c.kind, wrongSinceMs: since };
  return { action: "RECOVER", expectedRoot, classification: c.kind, wrongSinceMs: since };
}
