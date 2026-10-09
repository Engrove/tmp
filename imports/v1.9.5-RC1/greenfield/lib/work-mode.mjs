export const WORK_MODE_SCHEMA = "eic.greenfield.work-mode.v1";
export const WMT_POINTER_SCHEMA = "eic.greenfield.work-mode.pointer.v1";
export const DEFAULT_WORK_MODE_ENDPOINT = "https://api.elho.fi/greenfield/work-mode/v1";
export const WORK_MODE_POLL_MS = 15_000;
export const WMT_MAX_CLOCK_SKEW_MS = 60_000;

export function normalizeWorkModeEndpoint(value) {
  try {
    const u = new URL(String(value || DEFAULT_WORK_MODE_ENDPOINT));
    if (u.protocol !== "https:" || u.hostname !== "api.elho.fi") return DEFAULT_WORK_MODE_ENDPOINT;
    return u.href.replace(/\/$/, "");
  } catch { return DEFAULT_WORK_MODE_ENDPOINT; }
}

export function validateWmtPointer(value, { now = Date.now(), maxClockSkewMs = WMT_MAX_CLOCK_SKEW_MS } = {}) {
  const v = value && typeof value === "object" ? value : {};
  const errors = [];
  if (v.schema !== WMT_POINTER_SCHEMA) errors.push("SCHEMA");
  const taskRef = String(v.taskRef || "").trim();
  const nonce = String(v.nonce || "").trim();
  const taskKey = String(v.taskKey || "").trim();
  const objective = String(v.objective || "").trim();
  const issuedAtMs = Number(v.issuedAtMs);
  const expiresAtMs = Number(v.expiresAtMs);
  if (!taskRef || taskRef.length > 200) errors.push("TASK_REF");
  if (!nonce || nonce.length > 200) errors.push("NONCE");
  if (!taskKey || taskKey.length < 16 || taskKey.length > 300) errors.push("TASK_KEY");
  if (!objective || objective.length > 1200) errors.push("OBJECTIVE");
  if (!Number.isFinite(issuedAtMs) || Math.abs(Number(now) - issuedAtMs) > Number(maxClockSkewMs)) errors.push("ISSUED_AT_WINDOW");
  if (!Number.isFinite(expiresAtMs) || expiresAtMs < Number(now) || expiresAtMs - issuedAtMs > 5 * 60_000) errors.push("EXPIRES_AT");
  return { ok: errors.length === 0, errors, value: { ...v, taskRef, nonce, taskKey, objective, issuedAtMs, expiresAtMs } };
}

export function wmtPointerMission(pointer, endpoint = DEFAULT_WORK_MODE_ENDPOINT) {
  const v = validateWmtPointer(pointer, { now: Number(pointer?.issuedAtMs || Date.now()) });
  if (!v.ok) throw new Error(`WMT_POINTER_INVALID:${v.errors.join(",")}`);
  const p = v.value;
  return [
    "EIC Greenfield Arbetsläge (GFW-WMT).",
    `WMT taskRef=${p.taskRef}; revision=${String(p.revision || "1")}; taskKey=${p.taskKey}; objective=${p.objective}`,
    `Resolve the complete immutable task package from ${normalizeWorkModeEndpoint(endpoint)} using taskRef and the taskKey carried by the Work Mode pointer.`,
    "The resolved WMT package is authoritative for scope and must be next-person-ready: execute it without asking for information already present there; never invent missing owner facts.",
    "Report progress and terminal state through the available EIC owner routes. This short prompt is only a pointer; do not treat it as the full task package."
  ].join("\n");
}

export function workModeStatusPayload({ taskRef, state, workerId, seq = 0, detail = "", now = Date.now() } = {}) {
  return {
    schema: "eic.greenfield.work-mode.status.v1",
    taskRef: String(taskRef || "").slice(0, 200),
    state: String(state || "UNKNOWN").toUpperCase().slice(0, 40),
    workerId: String(workerId || "").slice(0, 200),
    seq: Math.max(0, Number(seq || 0)),
    detail: String(detail || "").slice(0, 500),
    ts: Number(now)
  };
}

export const WORK_MODE_PREQUEUE_KEY = "eic.gf.work-mode.prequeue.v1";
export const WORK_MODE_PREQUEUE_MAX = 48;

export async function loadWorkModePrequeue(storage = globalThis.chrome?.storage?.local) {
  if (!storage?.get) throw new Error("WORK_MODE_STORAGE_UNAVAILABLE");
  const r = await storage.get(WORK_MODE_PREQUEUE_KEY);
  const v = r?.[WORK_MODE_PREQUEUE_KEY] || {};
  const items = Array.isArray(v.items) ? v.items.filter((x) => x && typeof x === "object").slice(0, WORK_MODE_PREQUEUE_MAX) : [];
  return { schema: "eic.greenfield.work-mode.prequeue.v1", revision: Math.max(0, Number(v.revision || 0)), items };
}

export async function enqueueWorkModePointer(pointer, storage = globalThis.chrome?.storage?.local, { now = Date.now() } = {}) {
  const check = validateWmtPointer(pointer, { now });
  if (!check.ok) throw new Error(`WMT_POINTER_INVALID:${check.errors.join(",")}`);
  const q = await loadWorkModePrequeue(storage);
  const v = check.value;
  const key = `${v.taskRef}:${String(v.revision || "1")}`;
  if (!q.items.some((x) => x.key === key)) {
    if (q.items.length >= WORK_MODE_PREQUEUE_MAX) throw new Error("WORK_MODE_PREQUEUE_FULL");
    q.items.push({ key, pointer: v, state: "READY", createdAtMs: now, updatedAtMs: now });
    q.revision += 1;
    await storage.set({ [WORK_MODE_PREQUEUE_KEY]: q });
  }
  return q;
}

export async function claimNextWorkModePointer(storage = globalThis.chrome?.storage?.local, { now = Date.now() } = {}) {
  const q = await loadWorkModePrequeue(storage);
  const item = q.items.find((x) => x.state === "READY" && Number(x.pointer?.expiresAtMs || 0) >= now);
  if (!item) return { queue: q, item: null };
  item.state = "CLAIMED";
  item.updatedAtMs = now;
  q.revision += 1;
  await storage.set({ [WORK_MODE_PREQUEUE_KEY]: q });
  return { queue: q, item };
}

export async function completeWorkModePointer(key, state, storage = globalThis.chrome?.storage?.local, { now = Date.now(), workerId = "", windowId = null } = {}) {
  const q = await loadWorkModePrequeue(storage);
  const item = q.items.find((x) => x.key === String(key || ""));
  if (!item) return q;
  item.state = String(state || "DONE").toUpperCase();
  item.updatedAtMs = now;
  item.workerId = String(workerId || "");
  item.windowId = Number.isInteger(windowId) ? windowId : null;
  q.revision += 1;
  await storage.set({ [WORK_MODE_PREQUEUE_KEY]: q });
  return q;
}
