import { readStorage } from "./storage-read.mjs";
import "./safety-policy.js";
import { storageLock } from "./durable-checkpoint.mjs";

const S = globalThis.GreenfieldSafetyPolicy;
export const EIC_SURFACE_STATE_KEY = "eic.gf.eic-surface.v1";
export const EIC_SURFACE_GRACE_MS = 10_000;
const CHATGPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);

// Navigation target, NOT an observation or a safety receipt. This EIC id is
// present in the operator's diagnostics (2026-10-14) and screenshot (2026-10-15).
// A fresh installation must not need a manual probe prompt or sidebar history
// before it can navigate to EIC. The ordinary landing/send gates still apply.
export const DEFAULT_EIC_ENTRY_URL = "https://chatgpt.com/g/g-69e0b4be34308191aa6c05db1908be1b-eic";

export function normalizeEicEntryUrl(value) {
  let url;
  try { url = new URL(String(value || "").trim()); } catch { return ""; }
  if (url.protocol !== "https:" || !CHATGPT_HOSTS.has(url.hostname) ||
      url.username || url.password || url.port || url.search || url.hash) return "";
  const match = /^\/g\/(g-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)(?:\/c\/[A-Za-z0-9-]+)?\/?$/.exec(url.pathname);
  if (!match || match[1].startsWith("g-p-")) return "";
  return `${url.origin}/g/${match[1]}`;
}

function surfaceState(value = {}) {
  const configuredEicUrl = normalizeEicEntryUrl(value.configuredEicUrl);
  const lastKnownGoodEicUrl = normalizeEicEntryUrl(value.lastKnownGoodEicUrl);
  return {
    schema: "eic.greenfield.eic-surface.v1",
    configuredEicUrl,
    configuredAt: String(value.configuredAt || ""),
    lastKnownGoodEicUrl,
    updatedAt: String(value.updatedAt || ""),
    entryUrl: configuredEicUrl || lastKnownGoodEicUrl || DEFAULT_EIC_ENTRY_URL,
    entrySource: configuredEicUrl ? "OPERATOR_CONFIGURED" : lastKnownGoodEicUrl ? "LAST_OBSERVED" : "EIC_DISTRIBUTION_DEFAULT"
  };
}

// Both writers run in the service worker; serialize configuration and observed
// URL updates so an in-flight observation cannot discard an operator's choice.
export async function configureEicEntryUrl(value, storage = globalThis.chrome?.storage?.local, now = Date.now()) {
  const raw = String(value || "").trim();
  const configuredEicUrl = normalizeEicEntryUrl(raw);
  if (raw && !configuredEicUrl) throw Object.assign(new Error("EIC_ENTRY_URL_INVALID"), { code: "EIC_ENTRY_URL_INVALID" });
  if (!storage?.get || !storage?.set) throw new Error("EIC_ENTRY_STORAGE_UNAVAILABLE");
  return storageLock(storage, EIC_SURFACE_STATE_KEY, async () => {
    const prior = await readEicSurfaceState(storage);
    const next = { schema: prior.schema, configuredEicUrl, configuredAt: new Date(now).toISOString(),
      lastKnownGoodEicUrl: prior.lastKnownGoodEicUrl, updatedAt: prior.updatedAt };
    await storage.set({ [EIC_SURFACE_STATE_KEY]: next });
    return surfaceState(next);
  });
}

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

// Root for a queue start or rotation: preserve the process's bound GPT,
// otherwise the last verified EIC root. An incidental different GPT in the
// active tab must not retarget a queued mission. A first-use operator-selected
// custom GPT remains the fallback only when neither binding exists.
export function resolveManagedGptRoot(url = "", processRoot = "", globalRoot = "") {
  const live = customGptRoot(url);
  const prior = customGptRoot(processRoot);
  const global = customGptRoot(globalRoot);
  if (prior) return preferNamedRoot(preferNamedRoot(prior, live), global);
  if (global) return preferNamedRoot(global, live);
  return live;
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
  if (!storage?.get) return surfaceState();
  const r = await readStorage(storage,EIC_SURFACE_STATE_KEY);
  return surfaceState(r?.[EIC_SURFACE_STATE_KEY] || {});
}

export async function rememberGoodEicUrl(url, storage = globalThis.chrome?.storage?.local, now = Date.now()) {
  const observed = normalizeEicEntryUrl(url);
  if (!observed) return readEicSurfaceState(storage);
  return storageLock(storage, EIC_SURFACE_STATE_KEY, async () => {
    // A slugless URL of the same GPT never erases the remembered name slug.
    const prior = await readEicSurfaceState(storage);
    const root = preferNamedRoot(observed, prior.lastKnownGoodEicUrl);
    if (prior.lastKnownGoodEicUrl === root) return prior;
    const next = { schema: prior.schema, configuredEicUrl: prior.configuredEicUrl,
      configuredAt: prior.configuredAt, lastKnownGoodEicUrl: root, updatedAt: new Date(now).toISOString() };
    await storage.set({ [EIC_SURFACE_STATE_KEY]: next });
    return surfaceState(next);
  });
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
