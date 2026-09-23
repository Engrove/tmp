import { readCheckpoint, writeCheckpoint, registerLegacyCheckpointCodec } from "./durable-checkpoint.mjs";
import { nowIso, randomId, text, deepClone } from "./common.mjs";
import {
  DEFAULT_GREENFIELD_PRIORITY,
  GREENFIELD_PRIORITIES,
  normalizeGreenfieldPriority
} from "./global-capacity-scheduler.mjs";
import { queuePlanningFields } from "./queue-planning.mjs";

export const MISSION_WORK_QUEUE_SCHEMA = "eic.greenfield.mission-work-queue.v4";
export const MISSION_WORK_QUEUE_REGISTRY_SCHEMA = "eic.greenfield.mission-work-queue-registry.v2";
export const MISSION_WORK_QUEUE_REGISTRY_KEY = "eic.gf.mission-work-queue.registry.v2";
export const QUEUE_CONTEXT_SCHEMA = "eic.greenfield.queue-context.v1";
export const QUEUE_STATUS = Object.freeze({
  READY: "READY",
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  DONE: "DONE",
  BLOCKED: "BLOCKED",
  FAILED: "FAILED",
  STOPPED: "STOPPED"
});
export const DEFAULT_MISSION_QUANTUM_INTERACTIONS = 5;
export const MIN_MISSION_QUANTUM_INTERACTIONS = 1;
export const MAX_MISSION_QUANTUM_INTERACTIONS = 50;
export const DEFAULT_QUEUE_PRIORITY_AGING_SECONDS = 180;
export const MIN_QUEUE_PRIORITY_AGING_SECONDS = 30;
export const MAX_QUEUE_PRIORITY_AGING_SECONDS = 3600;
export const DEFAULT_QUEUE_SWITCH_HARD_RELOAD = true;
export const DEFAULT_QUEUE_SWITCH_DELAY_SECONDS = 5;
export const MIN_QUEUE_SWITCH_DELAY_SECONDS = 0;
export const MAX_QUEUE_SWITCH_DELAY_SECONDS = 300;
export const DEFAULT_QUEUE_SWITCH_SETTLE_SECONDS = 2;
export const MIN_QUEUE_SWITCH_SETTLE_SECONDS = 0;
export const MAX_QUEUE_SWITCH_SETTLE_SECONDS = 30;
export const MAX_QUEUE_ITEMS = 48;
export const MAX_QUEUE_HISTORY = 30;
export const MAX_DURABLE_QUEUE_REGISTRY = 32;

const LEGACY_WINDOW_PREFIX = "eic.gf.mission-work-queue.window.";
const WORKER_PREFIX = "eic.gf.mission-work-queue.worker.";
registerLegacyCheckpointCodec(MISSION_WORK_QUEUE_SCHEMA,value=>normalizeMissionWorkQueue(value));
const registryWriteLocks = new WeakMap();
const PRIORITY_RANK = Object.freeze(
  Object.fromEntries(Object.entries(GREENFIELD_PRIORITIES))
);

function storageOrDefault(storage) {
  return storage || globalThis.chrome?.storage?.local || null;
}
function requireStorage(storage) {
  const area = storageOrDefault(storage);
  if (!area?.get || !area?.set) throw new Error("MISSION_WORK_QUEUE_STORAGE_UNAVAILABLE");
  return area;
}
export function missionWorkQueueKey(windowId) {
  // Legacy v1/v2 key retained only for deterministic quarantine/tests.
  return `${LEGACY_WINDOW_PREFIX}${Number(windowId)}`;
}
export function missionWorkQueueWorkerKey(workerId) {
  const id = String(workerId || "").trim();
  if (!id) throw new Error("MISSION_WORK_QUEUE_WORKER_REQUIRED");
  return `${WORKER_PREFIX}${id}`;
}
function requireWorkerId(workerId) {
  const id = String(workerId || "").trim();
  if (!id) throw new Error("MISSION_WORK_QUEUE_WORKER_REQUIRED");
  return id;
}
function withRegistryWriteLock(area, work) {
  const prior = registryWriteLocks.get(area) || Promise.resolve();
  const next = prior.catch(() => undefined).then(work);
  let tail;
  tail = next.then(
    () => undefined,
    () => undefined
  ).finally(() => {
    if (registryWriteLocks.get(area) === tail) registryWriteLocks.delete(area);
  });
  registryWriteLocks.set(area, tail);
  return next;
}
export function normalizeMissionQuantumInteractions(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_MISSION_QUANTUM_INTERACTIONS;
  return Math.max(MIN_MISSION_QUANTUM_INTERACTIONS, Math.min(MAX_MISSION_QUANTUM_INTERACTIONS, Math.round(n)));
}
export function normalizeQueuePriorityAgingSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_QUEUE_PRIORITY_AGING_SECONDS;
  return Math.max(MIN_QUEUE_PRIORITY_AGING_SECONDS, Math.min(MAX_QUEUE_PRIORITY_AGING_SECONDS, Math.round(n)));
}
export function normalizeQueueSwitchDelaySeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_QUEUE_SWITCH_DELAY_SECONDS;
  return Math.max(MIN_QUEUE_SWITCH_DELAY_SECONDS, Math.min(MAX_QUEUE_SWITCH_DELAY_SECONDS, Math.round(n)));
}
export function normalizeQueueSwitchSettleSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_QUEUE_SWITCH_SETTLE_SECONDS;
  return Math.max(MIN_QUEUE_SWITCH_SETTLE_SECONDS, Math.min(MAX_QUEUE_SWITCH_SETTLE_SECONDS, Math.round(n)));
}
function normalizeStatus(value) {
  const status = String(value || "").trim().toUpperCase();
  return Object.values(QUEUE_STATUS).includes(status) ? status : QUEUE_STATUS.READY;
}
export function normalizeMissionWorkItem(value = {}, { now = Date.now(), defaultMaxInteractions = DEFAULT_MISSION_QUANTUM_INTERACTIONS } = {}) {
  const goal = text(value.goal, 120000).trim();
  if (!goal) return null;
  const createdAt = String(value.createdAt || nowIso(now));
  const status = normalizeStatus(value.status);
  const item = {
    itemId: String(value.itemId || value.id || randomId("queue-item")),
    savedMissionId: String(value.savedMissionId || ""),
    label: text(value.label || goal.split(/\r?\n/,1)[0] || "Uppdrag", 120).trim() || "Uppdrag",
    goal,
    priority: normalizeGreenfieldPriority(value.priority || DEFAULT_GREENFIELD_PRIORITY),
    // v1.7.7: the operator-assigned priority is the ceiling for AI-requested
    // SET_PRIORITY; operatorEditedAtMs gives operator edits precedence over any
    // AI runtime-control request formed from an older prompt.
    operatorPriority: normalizeGreenfieldPriority(value.operatorPriority || value.priority || DEFAULT_GREENFIELD_PRIORITY),
    operatorEditedAtMs: Math.max(0, Math.floor(Number(value.operatorEditedAtMs || 0))),
    maxInteractions: normalizeMissionQuantumInteractions(value.maxInteractions ?? defaultMaxInteractions),
    quantumProgress: Math.max(
      0,
      Math.min(
        Math.max(0, normalizeMissionQuantumInteractions(value.maxInteractions ?? defaultMaxInteractions) - 1),
        Math.floor(Number(value.quantumProgress || 0))
      )
    ),
    activationCount: Math.max(0, Math.floor(Number(value.activationCount || 0))),
    lastLeftAtMs: Math.max(0, Math.floor(Number(value.lastLeftAtMs || 0))),
    lastSelfRoundTripMs: value.lastSelfRoundTripMs !== null &&
        value.lastSelfRoundTripMs !== undefined &&
        value.lastSelfRoundTripMs !== "" &&
        Number.isFinite(Number(value.lastSelfRoundTripMs))
      ? Math.max(0, Math.round(Number(value.lastSelfRoundTripMs)))
      : null,
    lastLoopRoundTripMs: value.lastLoopRoundTripMs !== null &&
        value.lastLoopRoundTripMs !== undefined &&
        value.lastLoopRoundTripMs !== "" &&
        Number.isFinite(Number(value.lastLoopRoundTripMs))
      ? Math.max(0, Math.round(Number(value.lastLoopRoundTripMs)))
      : null,
    status,
    order: Number.isFinite(Number(value.order)) ? Number(value.order) : 0,
    readySinceMs: Number(value.readySinceMs || now),
    pauseUntilMs: Number(value.pauseUntilMs || 0),
    blockedSinceMs: Number(value.blockedSinceMs || 0),
    blockedRetryAtMs: Number(value.blockedRetryAtMs || 0),
    blockedCount: Math.max(0, Number(value.blockedCount || 0)),
    createdAt,
    updatedAt: String(value.updatedAt || createdAt),
    activatedAt: String(value.activatedAt || ""),
    completedAt: String(value.completedAt || ""),
    lastOutcome: String(value.lastOutcome || ""),
    lastSummary: text(value.lastSummary || "", 2000),
    lastError: value.lastError && typeof value.lastError === "object" ? deepClone(value.lastError) : null,
    processSnapshot: value.processSnapshot && typeof value.processSnapshot === "object"
      ? deepClone(value.processSnapshot)
      : null,
    resume: value.resume && typeof value.resume === "object"
      ? deepClone(value.resume)
      : null,
    delegation: value.delegation && typeof value.delegation === "object"
      ? {
          requestId: text(value.delegation.requestId, 200).trim(),
          relation: text(value.delegation.relation, 64).trim().toUpperCase(),
          sourceWindowId: value.delegation.sourceWindowId !== null &&
              value.delegation.sourceWindowId !== undefined &&
              value.delegation.sourceWindowId !== "" &&
              Number.isInteger(Number(value.delegation.sourceWindowId))
            ? Number(value.delegation.sourceWindowId)
            : null,
          sourceQueueId: text(value.delegation.sourceQueueId, 200).trim(),
          sourceItemId: text(value.delegation.sourceItemId, 200).trim(),
          sourceProcessId: text(value.delegation.sourceProcessId, 200).trim(),
          createdBy: text(value.delegation.createdBy || "EIC_DELEGATION", 64).trim(),
          createdAt: String(value.delegation.createdAt || createdAt)
        }
      : null
  };
  if (status !== QUEUE_STATUS.PAUSED) item.pauseUntilMs = 0;
  if (status !== QUEUE_STATUS.BLOCKED) {
    item.blockedSinceMs = 0;
    item.blockedRetryAtMs = 0;
  }
  return item;
}
export function normalizeMissionWorkQueue(value = {}, { workerId = value.workerId, windowId = value.windowId, now = Date.now(), defaultMaxInteractions = DEFAULT_MISSION_QUANTUM_INTERACTIONS } = {}) {
  const items = Array.isArray(value.items)
    ? value.items.map((item) => normalizeMissionWorkItem(item, { now, defaultMaxInteractions })).filter(Boolean).slice(0, MAX_QUEUE_ITEMS)
    : [];
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    if (seen.has(item.itemId)) continue;
    seen.add(item.itemId);
    deduped.push(item);
  }
  const history = Array.isArray(value.history)
    ? value.history.map((item) => normalizeMissionWorkItem(item, { now, defaultMaxInteractions })).filter(Boolean).slice(-MAX_QUEUE_HISTORY)
    : [];
  const requestedActiveItemId = String(value.activeItemId || "");
  const activeItems = deduped.filter((item) => item.status === QUEUE_STATUS.ACTIVE);
  const keepActiveItemId = activeItems.find((item) => item.itemId === requestedActiveItemId)?.itemId ||
    activeItems[0]?.itemId ||
    "";
  if (activeItems.length > 1) {
    for (const item of deduped) {
      if (item.status === QUEUE_STATUS.ACTIVE && item.itemId !== keepActiveItemId) {
        item.status = QUEUE_STATUS.READY;
        item.readySinceMs = now;
      }
    }
  }
  return {
    schema: MISSION_WORK_QUEUE_SCHEMA,
    queueId: String(value.queueId || randomId("work-queue")),
    revision: Math.max(0, Math.floor(Number(value.revision || 0))),
    workerId: String(workerId || value.workerId || ""),
    windowId: Number(windowId),
    enabled: value.enabled === true,
    activeItemId: keepActiveItemId,
    cursorOrder: Number.isFinite(Number(value.cursorOrder)) ? Number(value.cursorOrder) : -1,
    items: deduped,
    history,
    createdAt: String(value.createdAt || nowIso(now)),
    updatedAt: String(value.updatedAt || nowIso(now))
  };
}
export function publicMissionWorkQueue(queueValue, now = Date.now()) {
  const queue = normalizeMissionWorkQueue(queueValue || {}, { workerId: queueValue?.workerId, windowId: queueValue?.windowId, now });
  return {
    schema: queue.schema,
    queueId: queue.queueId,
    revision: queue.revision,
    workerId: queue.workerId,
    windowId: queue.windowId,
    enabled: queue.enabled,
    activeItemId: queue.activeItemId,
    cursorOrder: queue.cursorOrder,
    items: queue.items.map((item) => ({
      itemId: item.itemId,
      savedMissionId: item.savedMissionId,
      label: item.label,
      priority: item.priority,
      maxInteractions: item.maxInteractions,
      quantumProgress: item.quantumProgress,
      activationCount: item.activationCount,
      lastSelfRoundTripMs: item.lastSelfRoundTripMs,
      lastLoopRoundTripMs: item.lastLoopRoundTripMs,
      status: item.status,
      order: item.order,
      readySinceMs: item.readySinceMs,
      pauseUntilMs: item.pauseUntilMs,
      blockedSinceMs: item.blockedSinceMs,
      blockedRetryAtMs: item.blockedRetryAtMs,
      blockedCount: item.blockedCount,
      activatedAt: item.activatedAt,
      completedAt: item.completedAt,
      lastOutcome: item.lastOutcome,
      lastSummary: item.lastSummary,
      delegation: item.delegation ? deepClone(item.delegation) : null,
      hasContinuation: Boolean(item.processSnapshot || item.resume)
    })),
    history: queue.history.slice(-MAX_QUEUE_HISTORY).map((item) => ({
      itemId: item.itemId,
      savedMissionId: item.savedMissionId,
      label: item.label,
      priority: item.priority,
      maxInteractions: item.maxInteractions,
      quantumProgress: item.quantumProgress,
      status: item.status,
      completedAt: item.completedAt,
      lastOutcome: item.lastOutcome,
      lastSummary: item.lastSummary,
      lastError: item.lastError || null,
      delegation: item.delegation ? deepClone(item.delegation) : null
    })),
    updatedAt: queue.updatedAt
  };
}
export function effectiveQueuePriority(item, { now = Date.now(), agingSeconds = DEFAULT_QUEUE_PRIORITY_AGING_SECONDS } = {}) {
  const base = PRIORITY_RANK[normalizeGreenfieldPriority(item?.priority)] ?? PRIORITY_RANK.NORMAL;
  const stepMs = normalizeQueuePriorityAgingSeconds(agingSeconds) * 1000;
  const waitedMs = Math.max(0, Number(now) - Number(item?.readySinceMs || now));
  return Math.min(PRIORITY_RANK.URGENT, base + Math.floor(waitedMs / stepMs));
}
export function isRunnableQueueItem(item, now = Date.now()) {
  if (!item) return false;
  if (item.status === QUEUE_STATUS.READY) return true;
  if (item.status === QUEUE_STATUS.PAUSED) return Number(item.pauseUntilMs || 0) <= Number(now);
  if (item.status === QUEUE_STATUS.BLOCKED) {
    const retryAt = Number(item.blockedRetryAtMs || 0);
    return retryAt > 0 && retryAt <= Number(now);
  }
  return false;
}
export function selectNextMissionItem(queueValue, {
  now = Date.now(),
  agingSeconds = DEFAULT_QUEUE_PRIORITY_AGING_SECONDS,
  excludeItemId = "",
  afterItemId = "",
  afterOrder = null
} = {}) {
  // Inner mission scheduling is intentionally order-driven and cyclic.
  // Per-slot priority is retained for the profile-global capacity scheduler
  // once a slot is active; it never reorders slots inside this worker queue.
  void agingSeconds;
  const queue = normalizeMissionWorkQueue(queueValue || {}, {
    workerId: queueValue?.workerId,
    windowId: queueValue?.windowId,
    now
  });
  const ordered = queue.items
    .filter((item) => item.itemId !== excludeItemId && isRunnableQueueItem(item, now))
    .slice()
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.itemId.localeCompare(b.itemId);
    });
  if (ordered.length === 0) return null;

  const allOrdered = queue.items
    .slice()
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.itemId.localeCompare(b.itemId);
    });

  let pivotOrder = afterOrder !== null && afterOrder !== undefined && afterOrder !== "" &&
      Number.isFinite(Number(afterOrder))
    ? Number(afterOrder)
    : null;
  const exactPivot = String(afterItemId || "").trim();
  if (exactPivot) {
    const pivotItem = allOrdered.find((item) => item.itemId === exactPivot);
    if (pivotItem) pivotOrder = Number(pivotItem.order);
  }
  if (pivotOrder === null) {
    pivotOrder = Number.isFinite(Number(queue.cursorOrder)) ? Number(queue.cursorOrder) : -1;
  }

  return ordered.find((item) => Number(item.order) > pivotOrder) || ordered[0] || null;
}
export function createQueueContext(queue, item, { interactionCount = null, now = Date.now() } = {}) {
  const restoredProgress = interactionCount === null || interactionCount === undefined
    ? Math.max(0, Number(item?.quantumProgress || 0))
    : Math.max(0, Number(interactionCount || 0));
  return {
    schema: QUEUE_CONTEXT_SCHEMA,
    queueId: String(queue?.queueId || ""),
    workerId: String(queue?.workerId || ""),
    itemId: String(item?.itemId || ""),
    savedMissionId: String(item?.savedMissionId || ""),
    slotOrder: Number(item?.order || 0),
    interactionCount: restoredProgress,
    maxInteractions: normalizeMissionQuantumInteractions(item?.maxInteractions),
    priority: normalizeGreenfieldPriority(item?.priority),
    operatorPriority: normalizeGreenfieldPriority(item?.operatorPriority || item?.priority),
    activationCount: Math.max(0, Math.floor(Number(item?.activationCount || 0))),
    responseRoundTripApproxMs: item?.lastSelfRoundTripMs !== null &&
        item?.lastSelfRoundTripMs !== undefined &&
        item?.lastSelfRoundTripMs !== "" &&
        Number.isFinite(Number(item.lastSelfRoundTripMs))
      ? Math.max(0, Math.round(Number(item.lastSelfRoundTripMs)))
      : null,
    loopRoundTripApproxMs: item?.lastLoopRoundTripMs !== null &&
        item?.lastLoopRoundTripMs !== undefined &&
        item?.lastLoopRoundTripMs !== "" &&
        Number.isFinite(Number(item.lastLoopRoundTripMs))
      ? Math.max(0, Math.round(Number(item.lastLoopRoundTripMs)))
      : null,
    activatedAt: nowIso(now)
  };
}
export function queueTurnControl(process) {
  const ctx = process?.queueContext;
  if (!ctx || ctx.schema !== QUEUE_CONTEXT_SCHEMA || !ctx.itemId) return null;
  const max = normalizeMissionQuantumInteractions(ctx.maxInteractions);
  const planning = queuePlanningFields({ ...ctx, maxInteractions: max });
  return {
    schema: "eic.greenfield.queue-turn-control.v2",
    managed: true,
    queueId: String(ctx.queueId || ""),
    itemId: String(ctx.itemId || ""),
    savedMissionId: String(ctx.savedMissionId || ""),
    slotOrder: Number(ctx.slotOrder || 0),
    priority: normalizeGreenfieldPriority(ctx.priority),
    completedInteractions: planning.completedInteractions,
    interactionInQuantum: planning.interactionInQuantum,
    maxInteractions: planning.maxInteractions,
    remainingInteractionsIncludingCurrent: planning.remainingInteractionsIncludingCurrent,
    finalInteractionInQuantum: planning.finalInteractionInQuantum,
    checkpointRequired: planning.finalInteractionInQuantum,
    operatorDisplay: planning.operatorDisplay,
    planningHint: planning.planningHint,
    responseRoundTripApproxMs: planning.responseRoundTripApproxMs,
    loopRoundTripApproxMs: planning.loopRoundTripApproxMs,
    activationCount: planning.activationCount
  };
}
function normalizeRegistry(value = {}, { now = Date.now() } = {}) {
  const rows = Array.isArray(value?.entries) ? value.entries : [];
  const entries = [];
  const seenWorkers = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const workerId = String(row.workerId || row.queue?.workerId || "").trim();
    const queueId = String(row.queueId || row.queue?.queueId || "").trim();
    const rawWindowId = Number(row.boundWindowId ?? row.queue?.windowId);
    if (!workerId || !queueId || !Number.isInteger(rawWindowId) || seenWorkers.has(workerId)) continue;
    seenWorkers.add(workerId);
    const itemCount = Math.max(0, Number(row.itemCount ?? row.queue?.items?.length ?? 0));
    entries.push({
      workerId,
      queueId,
      revision: Math.max(0, Math.floor(Number(row.revision ?? row.queue?.revision ?? 0))),
      boundWindowId: rawWindowId,
      itemCount,
      activeItemId: String(row.activeItemId ?? row.queue?.activeItemId ?? ""),
      enabled: row.enabled === true || row.queue?.enabled === true,
      updatedAt: String(row.updatedAt || row.queue?.updatedAt || nowIso(now))
    });
  }
  return {
    schema: MISSION_WORK_QUEUE_REGISTRY_SCHEMA,
    entries: entries
      .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0))
      .slice(0, MAX_DURABLE_QUEUE_REGISTRY),
    updatedAt: String(value?.updatedAt || nowIso(now))
  };
}

function upsertRegistryQueue(registryValue, queueValue, { now = Date.now() } = {}) {
  const registry = normalizeRegistry(registryValue || {}, { now });
  const workerId = requireWorkerId(queueValue?.workerId);
  const queue = normalizeMissionWorkQueue(queueValue || {}, {
    workerId,
    windowId: queueValue?.windowId,
    now
  });
  const entries = registry.entries.filter((entry) => entry.workerId !== workerId);
  entries.unshift({
    workerId,
    queueId: queue.queueId,
    revision: queue.revision,
    boundWindowId: queue.windowId,
    itemCount: queue.items.length,
    activeItemId: queue.activeItemId,
    enabled: queue.enabled,
    updatedAt: queue.updatedAt || nowIso(now)
  });
  registry.entries = entries.slice(0, MAX_DURABLE_QUEUE_REGISTRY);
  registry.updatedAt = nowIso(now);
  return registry;
}

export function requeueBlockedMissionWorkItem(queueValue, itemId, {
  processSnapshot = null,
  resume = null,
  lastOutcome = "BLOCKED",
  lastSummary = "",
  lastError = null,
  retryAfterSeconds = DEFAULT_QUEUE_PRIORITY_AGING_SECONDS,
  now = Date.now()
} = {}) {
  const queue = normalizeMissionWorkQueue(queueValue || {}, {
    workerId: queueValue?.workerId,
    windowId: queueValue?.windowId,
    now
  });
  const target = queue.items.find((item) => item.itemId === String(itemId || ""));
  if (!target) throw new Error("MISSION_WORK_QUEUE_ITEM_NOT_FOUND");
  const logicalSavedMissionId = String(target.savedMissionId || "").trim();
  const sameLogicalMission = (item) =>
    item.itemId === target.itemId ||
    Boolean(logicalSavedMissionId && String(item.savedMissionId || "").trim() === logicalSavedMissionId);
  const retryAtMs = Number(now) + normalizeQueuePriorityAgingSeconds(retryAfterSeconds) * 1000;
  const quantumProgress = Math.max(0, Number(processSnapshot?.queueContext?.interactionCount ?? target.quantumProgress ?? 0));

  queue.items = queue.items.map((item) => {
    if (!sameLogicalMission(item)) return item;
    return normalizeMissionWorkItem({
      ...item,
      status: QUEUE_STATUS.BLOCKED,
      readySinceMs: retryAtMs,
      pauseUntilMs: 0,
      blockedSinceMs: now,
      blockedRetryAtMs: retryAtMs,
      blockedCount: Math.max(0, Number(item.blockedCount || 0)) + 1,
      completedAt: "",
      quantumProgress: item.itemId === target.itemId
        ? Math.min(
            Math.max(0, normalizeMissionQuantumInteractions(item.maxInteractions) - 1),
            quantumProgress
          )
        : item.quantumProgress,
      processSnapshot: processSnapshot && typeof processSnapshot === "object"
        ? deepClone(processSnapshot)
        : item.processSnapshot,
      resume: resume && typeof resume === "object"
        ? deepClone(resume)
        : item.resume,
      lastOutcome: String(lastOutcome || "BLOCKED"),
      lastSummary: text(lastSummary || "", 2000),
      lastError: lastError && typeof lastError === "object" ? deepClone(lastError) : null,
      updatedAt: nowIso(now)
    }, { now, defaultMaxInteractions: item.maxInteractions });
  });
  const activeItem = queue.items.find((item) => item.itemId === queue.activeItemId);
  if (activeItem && sameLogicalMission(activeItem)) queue.activeItemId = "";
  queue.cursorOrder = Number(target.order);
  queue.updatedAt = nowIso(now);
  return queue;
}

export async function loadMissionWorkQueue(windowId, storage = null, {
  workerId = "",
  defaultMaxInteractions = DEFAULT_MISSION_QUANTUM_INTERACTIONS
} = {}) {
  const area = requireStorage(storage);
  const id = requireWorkerId(workerId);
  const key = missionWorkQueueWorkerKey(id);
  const checkpoint = await readCheckpoint(key, area);
  if (checkpoint.health === "RECOVERY_REQUIRED") throw new Error("MISSION_QUEUE_CHECKPOINT_RECOVERY_REQUIRED");
  const raw = checkpoint.value;
  if (!raw) {
    return normalizeMissionWorkQueue({}, {
      workerId: id,
      windowId,
      defaultMaxInteractions
    });
  }
  const queue = normalizeMissionWorkQueue(raw, {
    workerId: id,
    windowId,
    defaultMaxInteractions
  });
  // A worker-keyed record may never be rebound to another worker by embedded data.
  if (String(raw.workerId || id) !== id) {
    throw new Error("MISSION_WORK_QUEUE_WORKER_BINDING_MISMATCH");
  }
  queue.workerId = id;
  queue.windowId = Number(windowId);
  return queue;
}

export async function saveMissionWorkQueue(queueValue, storage = null, {
  defaultMaxInteractions = DEFAULT_MISSION_QUANTUM_INTERACTIONS
} = {}) {
  const area = requireStorage(storage);
  const workerId = requireWorkerId(queueValue?.workerId);
  return withRegistryWriteLock(area, async () => {
    const next = normalizeMissionWorkQueue(queueValue, {
      workerId,
      windowId: queueValue?.windowId,
      defaultMaxInteractions
    });
    next.workerId = workerId;
    const key = missionWorkQueueWorkerKey(workerId);

    // Optimistic queue revision prevents two same-worker read/modify/write paths
    // from silently overwriting one another. Cross-worker registry updates remain
    // serialized by withRegistryWriteLock.
    const currentStored = await area.get(key);
    const currentRaw = currentStored?.[key] && typeof currentStored[key] === "object"
      ? currentStored[key]
      : null;
    const currentRevision = Math.max(0, Math.floor(Number(currentRaw?.revision || 0)));
    const expectedRevision = Math.max(0, Math.floor(Number(next.revision || 0)));
    if (currentRaw && expectedRevision !== currentRevision) {
      const error = new Error("MISSION_WORK_QUEUE_STALE_WRITE");
      error.code = "MISSION_WORK_QUEUE_STALE_WRITE";
      error.expectedRevision = expectedRevision;
      error.currentRevision = currentRevision;
      throw error;
    }
    if (!currentRaw && expectedRevision !== 0) {
      const error = new Error("MISSION_WORK_QUEUE_STALE_WRITE");
      error.code = "MISSION_WORK_QUEUE_STALE_WRITE";
      error.expectedRevision = expectedRevision;
      error.currentRevision = 0;
      throw error;
    }
    next.revision = currentRevision + 1;
    next.updatedAt = nowIso();

    const registryStored = await area.get(MISSION_WORK_QUEUE_REGISTRY_KEY);
    const registry = normalizeRegistry(registryStored?.[MISSION_WORK_QUEUE_REGISTRY_KEY] || {});
    const nextRegistry = upsertRegistryQueue(registry, next);
    await writeCheckpoint(key, next, area, { extra: { [MISSION_WORK_QUEUE_REGISTRY_KEY]: nextRegistry } });

    const stored = await area.get(key);
    const registryReadStored = await area.get(MISSION_WORK_QUEUE_REGISTRY_KEY);
    const readback = normalizeMissionWorkQueue(stored?.[key] || {}, {
      workerId,
      windowId: next.windowId,
      defaultMaxInteractions
    });
    const registryReadback = normalizeRegistry(registryReadStored?.[MISSION_WORK_QUEUE_REGISTRY_KEY] || {});
    const registryMatch = registryReadback.entries.some((entry) =>
      entry.workerId === workerId &&
      entry.queueId === next.queueId &&
      entry.revision === next.revision &&
      Number(entry.boundWindowId) === Number(next.windowId) &&
      entry.updatedAt === next.updatedAt &&
      entry.itemCount === next.items.length &&
      entry.activeItemId === next.activeItemId
    );
    if (readback.workerId !== workerId ||
        readback.queueId !== next.queueId ||
        readback.revision !== next.revision ||
        readback.updatedAt !== next.updatedAt ||
        readback.items.length !== next.items.length ||
        readback.activeItemId !== next.activeItemId ||
        !registryMatch) {
      throw new Error("MISSION_WORK_QUEUE_READBACK_MISMATCH");
    }
    return readback;
  });
}

export async function addMissionWorkItem(windowId, mission, {
  storage = null,
  workerId = "",
  priority = DEFAULT_GREENFIELD_PRIORITY,
  maxInteractions = DEFAULT_MISSION_QUANTUM_INTERACTIONS,
  savedMissionId = "",
  label = "",
  delegation = null,
  now = Date.now()
} = {}) {
  const queue = await loadMissionWorkQueue(windowId, storage, { workerId, defaultMaxInteractions: maxInteractions });
  const delegationRequestId = text(delegation?.requestId || "", 200).trim();
  const delegatedExisting = delegationRequestId
    ? [...queue.items, ...queue.history].find((item) => item.delegation?.requestId === delegationRequestId)
    : null;
  if (delegatedExisting) {
    if (delegatedExisting.goal !== String(mission || "").trim()) {
      const error = new Error("MISSION_WORK_QUEUE_DELEGATION_CONFLICT");
      error.code = "MISSION_WORK_QUEUE_DELEGATION_CONFLICT";
      throw error;
    }
    return queue;
  }
  // A saved GFW may intentionally appear in multiple scheduling slots.
  // itemId owns the slot; savedMissionId owns logical mission continuity.
  // Delegation request IDs remain exactly-once and are still deduplicated above.
  const logicalSavedMissionId = String(savedMissionId || "").trim();
  const continuationSource = logicalSavedMissionId
    ? queue.items
        .filter((item) => String(item.savedMissionId || "").trim() === logicalSavedMissionId)
        .slice()
        .sort((a, b) => {
          const at = Date.parse(a.processSnapshot?.updatedAt || a.updatedAt || 0);
          const bt = Date.parse(b.processSnapshot?.updatedAt || b.updatedAt || 0);
          return bt - at;
        })[0] || null
    : null;
  if (queue.items.length >= MAX_QUEUE_ITEMS) throw new Error("MISSION_WORK_QUEUE_FULL");
  const order = queue.items.reduce((max, item) => Math.max(max, Number(item.order || 0)), -1) + 1;
  const item = normalizeMissionWorkItem({
    itemId: randomId("queue-item"),
    savedMissionId,
    label,
    goal: mission,
    priority,
    maxInteractions,
    status: QUEUE_STATUS.READY,
    order,
    readySinceMs: now,
    quantumProgress: 0,
    processSnapshot: continuationSource?.processSnapshot ? deepClone(continuationSource.processSnapshot) : null,
    resume: continuationSource?.resume ? deepClone(continuationSource.resume) : null,
    delegation: delegationRequestId && delegation && typeof delegation === "object"
      ? deepClone(delegation)
      : null,
    createdAt: nowIso(now),
    updatedAt: nowIso(now)
  }, { now, defaultMaxInteractions: maxInteractions });
  if (!item) throw new Error("MISSION_WORK_QUEUE_GOAL_REQUIRED");
  queue.items.push(item);
  return saveMissionWorkQueue(queue, storage, { defaultMaxInteractions: maxInteractions });
}
export async function removeMissionWorkItem(windowId, itemId, storage = null, { workerId = "" } = {}) {
  const queue = await loadMissionWorkQueue(windowId, storage, { workerId });
  const target = queue.items.find((item) => item.itemId === String(itemId || ""));
  if (target?.status === QUEUE_STATUS.ACTIVE) throw new Error("MISSION_WORK_QUEUE_ACTIVE_ITEM_CANNOT_REMOVE");
  queue.items = queue.items.filter((item) => item.itemId !== String(itemId || ""));
  return saveMissionWorkQueue(queue, storage);
}
// Operator edit path (side panel UPDATE). Every edit stamps operatorEditedAtMs
// and re-anchors the AI priority ceiling to the priority the operator left.
export async function updateMissionWorkItem(windowId, itemId, patch = {}, storage = null, { workerId = "", now = Date.now() } = {}) {
  const queue = await loadMissionWorkQueue(windowId, storage, { workerId });
  const index = queue.items.findIndex((item) => item.itemId === String(itemId || ""));
  if (index < 0) throw new Error("MISSION_WORK_QUEUE_ITEM_NOT_FOUND");
  const current = queue.items[index];
  // Only fields the operator actually sent are edited; an absent field never
  // resets a value (v1.7.7: AI runtime control may have changed the other one).
  patch = Object.fromEntries(Object.entries(patch || {}).filter(([, value]) => value !== undefined && value !== null));
  if (current.status === QUEUE_STATUS.ACTIVE && patch.maxInteractions != null &&
      normalizeMissionQuantumInteractions(patch.maxInteractions) !== current.maxInteractions) {
    const error = new Error("MISSION_WORK_QUEUE_ACTIVE_QUANTUM_IMMUTABLE");
    error.code = "MISSION_WORK_QUEUE_ACTIVE_QUANTUM_IMMUTABLE";
    throw error;
  }
  const next = normalizeMissionWorkItem({
    ...current,
    ...patch,
    itemId: current.itemId,
    goal: current.goal,
    savedMissionId: current.savedMissionId,
    status: current.status,
    updatedAt: nowIso(now)
  });
  next.operatorPriority = next.priority;
  next.operatorEditedAtMs = Math.max(0, Math.floor(Number(now)));
  queue.items[index] = next;
  return saveMissionWorkQueue(queue, storage);
}
export async function moveMissionWorkItem(windowId, itemId, direction, storage = null, { workerId = "" } = {}) {
  const queue = await loadMissionWorkQueue(windowId, storage, { workerId });
  const ordered = [...queue.items].sort((a,b) => a.order - b.order);
  const index = ordered.findIndex((item) => item.itemId === String(itemId || ""));
  if (index < 0) throw new Error("MISSION_WORK_QUEUE_ITEM_NOT_FOUND");
  const target = Math.max(0, Math.min(ordered.length - 1, index + (String(direction).toUpperCase() === "UP" ? -1 : 1)));
  if (target === index) return queue;
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  ordered.forEach((item, i) => { item.order = i; item.updatedAt = nowIso(); });
  queue.items = ordered;
  return saveMissionWorkQueue(queue, storage);
}
