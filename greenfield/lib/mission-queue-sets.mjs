import { loadMissionQueueSetVault, writeMissionQueueSetVault } from "./mission-queue-set-vault.mjs";
import { deepClone, nowIso, randomId, text } from "./common.mjs";
import {
  MAX_QUEUE_ITEMS,
  QUEUE_STATUS,
  normalizeMissionWorkQueue,
  normalizeMissionQuantumInteractions
} from "./mission-work-queue.mjs";
import {
  DEFAULT_GREENFIELD_PRIORITY,
  normalizeGreenfieldPriority
} from "./global-capacity-scheduler.mjs";

export const MISSION_QUEUE_SET_SCHEMA = "eic.greenfield.mission-queue-set.v1";
export const MISSION_QUEUE_SET_STORE_SCHEMA = "eic.greenfield.mission-queue-set-store.v1";
export const MISSION_QUEUE_SET_STORE_KEY = "eic.gf.mission-queue-sets.v1";
export const MAX_MISSION_QUEUE_SETS = 64;

const storeWriteLocks = new WeakMap();

function storageOrDefault(storage) {
  return storage || globalThis.chrome?.storage?.local || null;
}
function requireStorage(storage) {
  const area = storageOrDefault(storage);
  if (!area?.get || !area?.set) throw new Error("MISSION_QUEUE_SET_STORAGE_UNAVAILABLE");
  return area;
}
function withStoreWriteLock(area, work) {
  const prior = storeWriteLocks.get(area) || Promise.resolve();
  const next = prior.catch(() => undefined).then(work);
  let tail;
  tail = next.then(
    () => undefined,
    () => undefined
  ).finally(() => {
    if (storeWriteLocks.get(area) === tail) storeWriteLocks.delete(area);
  });
  storeWriteLocks.set(area, tail);
  return next;
}
function normalizeName(value) {
  return text(value, 120).trim();
}
function normalizeTemplateItem(value = {}, order = 0) {
  const goal = text(value.goal, 120000).trim();
  if (!goal) return null;
  return {
    savedMissionId: String(value.savedMissionId || ""),
    label: text(value.label || goal.split(/\r?\n/, 1)[0] || "Uppdrag", 120).trim() || "Uppdrag",
    goal,
    priority: normalizeGreenfieldPriority(value.priority || DEFAULT_GREENFIELD_PRIORITY),
    maxInteractions: normalizeMissionQuantumInteractions(value.maxInteractions),
    order: Number.isFinite(Number(value.order)) ? Number(value.order) : order
  };
}
export function normalizeMissionQueueSet(value = {}, { now = Date.now() } = {}) {
  const name = normalizeName(value.name);
  if (!name) return null;
  const items = (Array.isArray(value.items) ? value.items : [])
    .map((item, index) => normalizeTemplateItem(item, index))
    .filter(Boolean)
    .slice(0, MAX_QUEUE_ITEMS)
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({ ...item, order: index }));
  const createdAt = String(value.createdAt || nowIso(now));
  return {
    schema: MISSION_QUEUE_SET_SCHEMA,
    setId: String(value.setId || randomId("queue-set")),
    name,
    items,
    createdAt,
    updatedAt: String(value.updatedAt || createdAt)
  };
}
function normalizeStore(value = {}, { now = Date.now() } = {}) {
  const rows = Array.isArray(value?.sets) ? value.sets : [];
  const seen = new Set();
  const sets = [];
  for (const row of rows) {
    const set = normalizeMissionQueueSet(row, { now });
    if (!set || seen.has(set.setId)) continue;
    seen.add(set.setId);
    sets.push(set);
  }
  return {
    schema: MISSION_QUEUE_SET_STORE_SCHEMA,
    sets: sets
      .sort((a, b) => a.name.localeCompare(b.name, "sv"))
      .slice(0, MAX_MISSION_QUEUE_SETS),
    updatedAt: String(value?.updatedAt || nowIso(now))
  };
}
export async function loadMissionQueueSets(storage = null, { bookmarks = globalThis.chrome?.bookmarks || null } = {}) {
  const area = requireStorage(storage);
  const stored = await area.get(MISSION_QUEUE_SET_STORE_KEY);
  const local = normalizeStore(stored?.[MISSION_QUEUE_SET_STORE_KEY] || {});
  if (!bookmarks) return local;
  const durableRaw = await loadMissionQueueSetVault(bookmarks).catch(() => null);
  const durable = durableRaw ? normalizeStore(durableRaw) : null;
  if (durable?.sets?.length) {
    if (JSON.stringify(durable) !== JSON.stringify(local)) await area.set({ [MISSION_QUEUE_SET_STORE_KEY]: durable });
    return durable;
  }
  if (local.sets.length) {
    await writeMissionQueueSetVault(local, { bookmarks });
    return local;
  }
  return local;
}
export async function saveMissionQueueSet({ name, queue, setId = "" } = {}, storage = null, { now = Date.now(), bookmarks = globalThis.chrome?.bookmarks || null } = {}) {
  const area = requireStorage(storage);
  return withStoreWriteLock(area, async () => {
    const normalizedQueue = normalizeMissionWorkQueue(queue || {}, {
      workerId: queue?.workerId,
      windowId: queue?.windowId,
      now
    });
    const cleanItems = normalizedQueue.items
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((item, index) => normalizeTemplateItem(item, index))
      .filter(Boolean);
    const store = await loadMissionQueueSets(area, { bookmarks });
    const normalizedName = normalizeName(name);
    if (!normalizedName) throw new Error("MISSION_QUEUE_SET_NAME_REQUIRED");

    const sameName = store.sets.find((candidate) =>
      candidate.name.localeCompare(normalizedName, "sv", { sensitivity: "accent" }) === 0
    );
    const targetId = String(setId || sameName?.setId || randomId("queue-set"));
    const createdAt = sameName?.createdAt || store.sets.find((candidate) => candidate.setId === targetId)?.createdAt || nowIso(now);
    const next = normalizeMissionQueueSet({
      setId: targetId,
      name: normalizedName,
      items: cleanItems,
      createdAt,
      updatedAt: nowIso(now)
    }, { now });
    const filtered = store.sets.filter((candidate) =>
      candidate.setId !== targetId &&
      candidate.name.localeCompare(normalizedName, "sv", { sensitivity: "accent" }) !== 0
    );
    filtered.push(next);
    const nextStore = normalizeStore({ sets: filtered, updatedAt: nowIso(now) }, { now });
    await area.set({ [MISSION_QUEUE_SET_STORE_KEY]: nextStore });
    if (bookmarks) await writeMissionQueueSetVault(nextStore, { bookmarks });
    const readback = await loadMissionQueueSets(area, { bookmarks });
    const saved = readback.sets.find((candidate) => candidate.setId === targetId);
    if (!saved || saved.updatedAt !== next.updatedAt || saved.items.length !== next.items.length) {
      throw new Error("MISSION_QUEUE_SET_READBACK_MISMATCH");
    }
    return { store: readback, set: saved };
  });
}
export async function deleteMissionQueueSet(setId, storage = null, { now = Date.now(), bookmarks = globalThis.chrome?.bookmarks || null } = {}) {
  const area = requireStorage(storage);
  return withStoreWriteLock(area, async () => {
    const id = String(setId || "").trim();
    if (!id) throw new Error("MISSION_QUEUE_SET_ID_REQUIRED");
    const store = await loadMissionQueueSets(area, { bookmarks });
    const nextStore = normalizeStore({
      sets: store.sets.filter((candidate) => candidate.setId !== id),
      updatedAt: nowIso(now)
    }, { now });
    await area.set({ [MISSION_QUEUE_SET_STORE_KEY]: nextStore });
    if (bookmarks) await writeMissionQueueSetVault(nextStore, { bookmarks });
    const readback = await loadMissionQueueSets(area, { bookmarks });
    if (readback.sets.some((candidate) => candidate.setId === id)) {
      throw new Error("MISSION_QUEUE_SET_DELETE_READBACK_MISMATCH");
    }
    return readback;
  });
}
export function applyMissionQueueSet(queueValue, setValue, {
  workerId = queueValue?.workerId,
  windowId = queueValue?.windowId,
  now = Date.now()
} = {}) {
  const queue = normalizeMissionWorkQueue(queueValue || {}, { workerId, windowId, now });
  if (queue.enabled || queue.activeItemId || queue.items.some((item) => item.status === QUEUE_STATUS.ACTIVE)) {
    throw new Error("MISSION_QUEUE_SET_REQUIRES_STOPPED_QUEUE");
  }
  const set = normalizeMissionQueueSet(setValue || {}, { now });
  if (!set) throw new Error("MISSION_QUEUE_SET_INVALID");
  const items = set.items.map((template, index) => ({
    itemId: randomId("queue-item"),
    savedMissionId: template.savedMissionId,
    label: template.label,
    goal: template.goal,
    priority: template.priority,
    maxInteractions: template.maxInteractions,
    status: QUEUE_STATUS.READY,
    order: index,
    readySinceMs: now,
    pauseUntilMs: 0,
    blockedSinceMs: 0,
    blockedRetryAtMs: 0,
    blockedCount: 0,
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
    activatedAt: "",
    completedAt: "",
    lastOutcome: "",
    lastSummary: "",
    lastError: null,
    processSnapshot: null,
    resume: null,
    delegation: null
  }));
  return normalizeMissionWorkQueue({
    ...deepClone(queue),
    workerId,
    windowId,
    enabled: false,
    activeItemId: "",
    cursorOrder: -1,
    items,
    updatedAt: nowIso(now)
  }, { workerId, windowId, now });
}
export function publicMissionQueueSets(storeValue) {
  const store = normalizeStore(storeValue || {});
  return store.sets.map((set) => ({
    setId: set.setId,
    name: set.name,
    itemCount: set.items.length,
    updatedAt: set.updatedAt
  }));
}
