import { readCheckpoint, writeCheckpoint, CHECKPOINT_PREFIX, checkpointKeys, storageLock } from "./durable-checkpoint.mjs";
import { validateProcess } from "./state.mjs";
import {
  WORKER_BINDING_WINDOW_PREFIX,
  getWorkerBinding,
  workerBindingMatches
} from "./worker-identity.mjs";

const LEGACY_PREFIX = "eic.gf.process.window.";
const WORKER_PREFIX = "eic.gf.process.worker.";

function localStorageOrDefault(storage) {
  return storage || globalThis.chrome?.storage?.local || null;
}
function sessionStorageOrDefault(storage) {
  return storage || globalThis.chrome?.storage?.session || null;
}
function requireLocalStorage(storage) {
  const area = localStorageOrDefault(storage);
  if (!area?.get || !area?.set || !area?.remove) throw new Error("PROCESS_STORAGE_UNAVAILABLE");
  return area;
}
function requireSessionStorage(storage) {
  const area = sessionStorageOrDefault(storage);
  if (!area?.get) throw new Error("PROCESS_SESSION_STORAGE_UNAVAILABLE");
  return area;
}

export function processKey(windowId) {
  // Legacy v1.5.0-and-earlier key. It is intentionally never read by v1.5.1
  // runtime ownership because Chrome numeric window IDs may be reused.
  return `${LEGACY_PREFIX}${Number(windowId)}`;
}

export function processWorkerKey(workerId) {
  const id = String(workerId || "").trim();
  if (!id) throw new Error("PROCESS_WORKER_REQUIRED");
  return `${WORKER_PREFIX}${id}`;
}

export async function loadProcessForWindow(windowId, storage = null, sessionStorage = null) {
  const local = requireLocalStorage(storage);
  const session = requireSessionStorage(sessionStorage);
  const binding = await getWorkerBinding(windowId, session).catch(() => null);
  if (!binding) return null;
  const key = processWorkerKey(binding.workerId);
  const record = await readCheckpoint(key, local);
  const value = record.value;
  if (value && record.health === "RECOVERY_REQUIRED") value.storageRecoveryRequired = true;
  if (!value) return null;
  const process = validateProcess(value);
  if (process.workerId !== binding.workerId || Number(process.windowId) !== Number(windowId)) {
    return null;
  }
  return process;
}

export async function saveProcess(process, storage = null, sessionStorage = null) {
  const local = requireLocalStorage(storage);
  const session = requireSessionStorage(sessionStorage);
  validateProcess(process);
  if (!await workerBindingMatches(process.windowId, process.workerId, session)) {
    const error = new Error("PROCESS_WORKER_BINDING_MISMATCH");
    error.code = "PROCESS_WORKER_BINDING_MISMATCH";
    throw error;
  }
  const key = processWorkerKey(process.workerId);
  await writeCheckpoint(key, process, local);
  const readback = await local.get(key);
  const value = readback?.[key] || null;
  if (!value || value.processId !== process.processId || value.runId !== process.runId ||
      value.workerId !== process.workerId || Number(value.windowId) !== Number(process.windowId)) {
    throw new Error("PROCESS_READBACK_MISMATCH");
  }
  return process;
}

export async function removeProcessForWindow(windowId, storage = null, sessionStorage = null) {
  const local = requireLocalStorage(storage);
  const session = requireSessionStorage(sessionStorage);
  const binding = await getWorkerBinding(windowId, session).catch(() => null);
  if (!binding) return;
  const key=processWorkerKey(binding.workerId);
  await storageLock(local,key,()=>local.remove([key,...checkpointKeys(key)]));
}

export async function loadAllProcesses(storage = null, sessionStorage = null) {
  const local = requireLocalStorage(storage);
  const session = requireSessionStorage(sessionStorage);
  const sessionState = await session.get(null);
  const liveWorkers = new Map();
  for (const [key, value] of Object.entries(sessionState || {})) {
    if (!key.startsWith(WORKER_BINDING_WINDOW_PREFIX)) continue;
    const workerId = String(value?.workerId || "").trim();
    const windowId = Number(value?.windowId);
    if (!workerId || !Number.isInteger(windowId)) continue;
    const reverse = sessionState?.[`eic.gf.worker-binding.worker.${workerId}`];
    if (!reverse ||
        String(reverse.workerId || "") !== workerId ||
        Number(reverse.windowId) !== windowId) continue;
    liveWorkers.set(workerId, windowId);
  }
  if (liveWorkers.size === 0) return [];

  const all = await local.get(null);
  const out = [];
  for (const [key, value] of Object.entries(all || {})) {
    if (!key.startsWith(WORKER_PREFIX)) continue;
    try {
      const record = await readCheckpoint(key, local);
      const process = validateProcess(record.value);
      if (record.health === "RECOVERY_REQUIRED") process.storageRecoveryRequired = true;
      const expectedWindow = liveWorkers.get(process.workerId);
      if (!Number.isInteger(expectedWindow) || expectedWindow !== Number(process.windowId)) continue;
      out.push(process);
    } catch {}
  }
  return out;
}

// Recovery inventory intentionally does not depend on volatile window bindings.
export async function loadPersistedProcessInventory(storage = null) {
  const local = requireLocalStorage(storage);
  const all = await local.get(null);
  const keys = new Set();
  for (const key of Object.keys(all || {})) {
    if (key.startsWith(WORKER_PREFIX)) keys.add(key);
    if (key.startsWith(CHECKPOINT_PREFIX + WORKER_PREFIX)) keys.add(key.slice(CHECKPOINT_PREFIX.length).replace(/\.[01]$/, ""));
  }
  const processes = [], errors = [];
  for (const key of keys) {
    try {
      const record = await readCheckpoint(key, local);
      const process = validateProcess(record.value);
      if (record.health === "RECOVERY_REQUIRED") process.storageRecoveryRequired = true;
      processes.push(process);
    } catch (error) { errors.push({ key, code:String(error.message) }); }
  }
  return { processes, errors };
}
