import { randomId } from "./common.mjs";

export const WORKER_BINDING_SCHEMA = "eic.greenfield.worker-binding.v1";
export const WORKER_BINDING_WINDOW_PREFIX = "eic.gf.worker-binding.window.";
export const WORKER_BINDING_WORKER_PREFIX = "eic.gf.worker-binding.worker.";

const pendingByWindow = new Map();

function sessionStorageOrDefault(storage) {
  return storage || globalThis.chrome?.storage?.session || null;
}

function requireSessionStorage(storage) {
  const area = sessionStorageOrDefault(storage);
  if (!area?.get || !area?.set || !area?.remove) {
    throw new Error("WORKER_SESSION_STORAGE_UNAVAILABLE");
  }
  return area;
}

export function workerBindingWindowKey(windowId) {
  const id = Number(windowId);
  if (!Number.isInteger(id)) throw new Error("WORKER_WINDOW_INVALID");
  return `${WORKER_BINDING_WINDOW_PREFIX}${id}`;
}

export function workerBindingWorkerKey(workerId) {
  const id = String(workerId || "").trim();
  if (!id) throw new Error("WORKER_ID_REQUIRED");
  return `${WORKER_BINDING_WORKER_PREFIX}${id}`;
}

function validBinding(value, windowId = null) {
  if (!value || value.schema !== WORKER_BINDING_SCHEMA) return null;
  const workerId = String(value.workerId || "").trim();
  const boundWindowId = Number(value.windowId);
  if (!workerId || !Number.isInteger(boundWindowId)) return null;
  if (Number.isInteger(windowId) && boundWindowId !== Number(windowId)) return null;
  return {
    schema: WORKER_BINDING_SCHEMA,
    workerId,
    windowId: boundWindowId,
    createdAt: String(value.createdAt || ""),
    updatedAt: String(value.updatedAt || value.createdAt || "")
  };
}

export async function getWorkerBinding(windowId, storage = null) {
  const area = requireSessionStorage(storage);
  const key = workerBindingWindowKey(windowId);
  const stored = await area.get(key);
  const binding = validBinding(stored?.[key], Number(windowId));
  if (!binding) return null;
  const reverseKey = workerBindingWorkerKey(binding.workerId);
  const reverse = await area.get(reverseKey);
  const reverseBinding = validBinding(reverse?.[reverseKey], Number(windowId));
  if (!reverseBinding || reverseBinding.workerId !== binding.workerId) return null;
  return binding;
}

export async function ensureWorkerBinding(windowId, storage = null, { now = Date.now() } = {}) {
  const id = Number(windowId);
  if (!Number.isInteger(id)) throw new Error("WORKER_WINDOW_INVALID");
  const existingPending = pendingByWindow.get(id);
  if (existingPending) return existingPending;

  const work = (async () => {
    const area = requireSessionStorage(storage);
    const existing = await getWorkerBinding(id, area).catch(() => null);
    if (existing) return existing;

    const at = new Date(Number(now)).toISOString();
    const binding = {
      schema: WORKER_BINDING_SCHEMA,
      workerId: randomId("worker"),
      windowId: id,
      createdAt: at,
      updatedAt: at
    };
    await area.set({
      [workerBindingWindowKey(id)]: binding,
      [workerBindingWorkerKey(binding.workerId)]: binding
    });
    const readback = await getWorkerBinding(id, area);
    if (!readback || readback.workerId !== binding.workerId) {
      throw new Error("WORKER_BINDING_READBACK_MISMATCH");
    }
    return readback;
  })();

  pendingByWindow.set(id, work);
  try {
    return await work;
  } finally {
    if (pendingByWindow.get(id) === work) pendingByWindow.delete(id);
  }
}

export async function releaseWorkerBinding(windowId, storage = null) {
  const area = requireSessionStorage(storage);
  const id = Number(windowId);
  if (!Number.isInteger(id)) return null;
  const key = workerBindingWindowKey(id);
  const stored = await area.get(key);
  const binding = validBinding(stored?.[key], id);
  const keys = [key];
  if (binding?.workerId) keys.push(workerBindingWorkerKey(binding.workerId));
  await area.remove(keys);
  pendingByWindow.delete(id);
  return binding;
}

export async function resetWorkerBindingForCreatedWindow(windowId, storage = null) {
  // Chrome numeric window IDs are ephemeral and may be reused. A newly-created
  // browser window must never inherit a prior worker binding that survived a
  // service-worker lifecycle edge.
  return releaseWorkerBinding(windowId, storage);
}

export async function workerBindingMatches(windowId, workerId, storage = null) {
  const binding = await getWorkerBinding(windowId, storage).catch(() => null);
  return Boolean(binding && binding.workerId === String(workerId || ""));
}

// Only the recovery reconciler calls this, after proving the conversation and
// exact prior user-turn hash. Numeric Chrome IDs never constitute that proof.
export async function restoreWorkerBinding(windowId, workerId, storage = null) {
  const area = requireSessionStorage(storage);
  const existing = await getWorkerBinding(windowId, area);
  if (existing && existing.workerId !== workerId) throw new Error("RECOVERY_WINDOW_ALREADY_OWNED");
  const reverse = (await area.get(workerBindingWorkerKey(workerId)))[workerBindingWorkerKey(workerId)];
  if (reverse && Number(reverse.windowId) !== Number(windowId)) throw new Error("RECOVERY_WORKER_ALREADY_BOUND");
  const at = new Date().toISOString();
  const binding = { schema:WORKER_BINDING_SCHEMA, workerId, windowId:Number(windowId), createdAt:existing?.createdAt || at, updatedAt:at };
  await area.set({[workerBindingWindowKey(windowId)]:binding,[workerBindingWorkerKey(workerId)]:binding});
  if (!await workerBindingMatches(windowId,workerId,area)) throw new Error("RECOVERY_BINDING_READBACK_FAILED");
  return binding;
}
