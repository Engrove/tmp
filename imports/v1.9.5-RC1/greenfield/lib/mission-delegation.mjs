import { deepClone, nowIso, text } from "./common.mjs";
import {
  DEFAULT_GREENFIELD_PRIORITY,
  GREENFIELD_PRIORITIES,
  normalizeGreenfieldPriority
} from "./global-capacity-scheduler.mjs";

export const MISSION_DELEGATION_REGISTRY_KEY = "eic.gf.mission-delegation.registry.v1";
export const MISSION_DELEGATION_REGISTRY_SCHEMA = "eic.greenfield.mission-delegation-registry.v1";
export const MISSION_DELEGATION_SCHEMA = "eic.greenfield.mission-delegation.v1";
export const MAX_MISSION_DELEGATIONS = 128;
export const MAX_RESPONSE_MISSION_DELEGATIONS = 3;
export const MISSION_DELEGATION_RETRY_BASE_MS = 60000;
export const MISSION_DELEGATION_RETRY_MAX_MS = 900000;
export const MAX_MISSION_DELEGATION_RECEIPTS = 32;

export const MISSION_DELEGATION_RELATION = Object.freeze({
  SUPPORTS_CURRENT: "SUPPORTS_CURRENT",
  UNBLOCKS_CURRENT: "UNBLOCKS_CURRENT"
});

export const MISSION_DELEGATION_STATE = Object.freeze({
  PENDING: "PENDING",
  ASSIGNED: "ASSIGNED",
  APPLIED: "APPLIED",
  COMPLETED: "COMPLETED",
  REJECTED: "REJECTED"
});

const VALID_RELATIONS = new Set(Object.values(MISSION_DELEGATION_RELATION));
const VALID_STATES = new Set(Object.values(MISSION_DELEGATION_STATE));
const TERMINAL_STATES = new Set([MISSION_DELEGATION_STATE.COMPLETED, MISSION_DELEGATION_STATE.REJECTED]);

function storageOrDefault(storage) {
  return storage || globalThis.chrome?.storage?.local || null;
}

function requireStorage(storage) {
  const area = storageOrDefault(storage);
  if (!area?.get || !area?.set) throw new Error("MISSION_DELEGATION_STORAGE_UNAVAILABLE");
  return area;
}

function boundedString(value, max, { required = false } = {}) {
  if (typeof value !== "string" || value.length > max) return false;
  return !required || value.trim().length > 0;
}

function normalizedRelation(value) {
  const relation = String(value || MISSION_DELEGATION_RELATION.SUPPORTS_CURRENT).trim().toUpperCase();
  return VALID_RELATIONS.has(relation)
    ? relation
    : MISSION_DELEGATION_RELATION.SUPPORTS_CURRENT;
}

function normalizeState(value) {
  const state = String(value || MISSION_DELEGATION_STATE.PENDING).trim().toUpperCase();
  return VALID_STATES.has(state) ? state : MISSION_DELEGATION_STATE.PENDING;
}

function normalizeOptionalInt(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

export function validateMissionDelegationRequest(value) {
  const v = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const errors = [];
  const allowed = new Set(["requestId", "label", "mission", "priority", "relation"]);
  for (const key of Object.keys(v)) {
    if (!allowed.has(key)) errors.push(`ADDITIONAL_PROPERTY:${key}`);
  }
  if (!boundedString(v.requestId, 200, { required: true })) errors.push("REQUEST_ID");
  if (!boundedString(v.label ?? "", 200)) errors.push("LABEL");
  if (!boundedString(v.mission, 120000, { required: true })) errors.push("MISSION");
  if (!Object.prototype.hasOwnProperty.call(v, "priority")) errors.push("PRIORITY_REQUIRED");
  const priority = String(v.priority || "").trim().toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(GREENFIELD_PRIORITIES, priority)) errors.push("PRIORITY");
  if (!Object.prototype.hasOwnProperty.call(v, "relation")) errors.push("RELATION_REQUIRED");
  const relation = String(v.relation || "").trim().toUpperCase();
  if (!VALID_RELATIONS.has(relation)) errors.push("RELATION");
  return { ok: errors.length === 0, errors };
}

export function validateMissionDelegationRequests(value) {
  if (value == null) return { ok: true, errors: [] };
  if (!Array.isArray(value)) return { ok: false, errors: ["MISSION_DELEGATIONS"] };
  if (value.length > MAX_RESPONSE_MISSION_DELEGATIONS) {
    return { ok: false, errors: ["MISSION_DELEGATIONS_MAX_ITEMS"] };
  }
  const errors = [];
  const ids = new Set();
  value.forEach((item, index) => {
    const validation = validateMissionDelegationRequest(item);
    for (const error of validation.errors) errors.push(`MISSION_DELEGATION_${index}:${error}`);
    const requestId = String(item?.requestId || "").trim();
    if (requestId && ids.has(requestId)) errors.push(`MISSION_DELEGATION_${index}:DUPLICATE_REQUEST_ID`);
    if (requestId) ids.add(requestId);
  });
  return { ok: errors.length === 0, errors };
}

export function clampDelegatedPriority(requestedPriority, sourcePriority) {
  const requested = normalizeGreenfieldPriority(requestedPriority || DEFAULT_GREENFIELD_PRIORITY);
  const source = normalizeGreenfieldPriority(sourcePriority || DEFAULT_GREENFIELD_PRIORITY);
  return GREENFIELD_PRIORITIES[requested] <= GREENFIELD_PRIORITIES[source]
    ? requested
    : source;
}

export function normalizeMissionDelegation(value = {}, { now = Date.now() } = {}) {
  const createdAt = String(value.createdAt || nowIso(now));
  const state = normalizeState(value.state);
  return {
    schema: MISSION_DELEGATION_SCHEMA,
    requestId: text(value.requestId, 200).trim(),
    label: text(value.label || "", 200).trim(),
    mission: text(value.mission, 120000).trim(),
    priority: normalizeGreenfieldPriority(value.priority || DEFAULT_GREENFIELD_PRIORITY),
    relation: normalizedRelation(value.relation),
    state,
    sourceWindowId: normalizeOptionalInt(value.sourceWindowId),
    sourceQueueId: text(value.sourceQueueId, 200).trim(),
    sourceItemId: text(value.sourceItemId, 200).trim(),
    sourceProcessId: text(value.sourceProcessId, 200).trim(),
    sourceRunId: text(value.sourceRunId, 200).trim(),
    sourceResponseHash: text(value.sourceResponseHash, 128).trim(),
    targetWindowId: normalizeOptionalInt(value.targetWindowId),
    targetQueueId: text(value.targetQueueId, 200).trim(),
    targetItemId: text(value.targetItemId, 200).trim(),
    attempts: Number.isFinite(Number(value.attempts)) ? Math.max(0, Math.floor(Number(value.attempts))) : 0,
    nextAttemptAtMs: Number.isFinite(Number(value.nextAttemptAtMs)) ? Math.max(0, Number(value.nextAttemptAtMs)) : 0,
    lastError: value.lastError && typeof value.lastError === "object" ? deepClone(value.lastError) : null,
    createdAt,
    updatedAt: String(value.updatedAt || createdAt),
    appliedAt: String(value.appliedAt || ""),
    completedAt: String(value.completedAt || ""),
    rejectedAt: String(value.rejectedAt || "")
  };
}

export function normalizeMissionDelegationRegistry(value = {}, { now = Date.now() } = {}) {
  const rows = Array.isArray(value?.items) ? value.items : [];
  const items = [];
  const seen = new Set();
  for (const row of rows) {
    const item = normalizeMissionDelegation(row, { now });
    if (!item.requestId || !item.mission || seen.has(item.requestId)) continue;
    seen.add(item.requestId);
    items.push(item);
  }
  const active = items
    .filter((item) => !TERMINAL_STATES.has(item.state))
    .sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0));
  const completed = items
    .filter((item) => TERMINAL_STATES.has(item.state))
    .sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0));
  const completedBudget = Math.max(0, MAX_MISSION_DELEGATIONS - active.length);
  return {
    schema: MISSION_DELEGATION_REGISTRY_SCHEMA,
    // Never evict unfinished autonomous work merely to satisfy a history cap.
    items: [...active, ...completed.slice(-completedBudget)],
    updatedAt: String(value?.updatedAt || nowIso(now))
  };
}

export async function loadMissionDelegationRegistry(storage = null) {
  const area = requireStorage(storage);
  const stored = await area.get(MISSION_DELEGATION_REGISTRY_KEY);
  return normalizeMissionDelegationRegistry(stored?.[MISSION_DELEGATION_REGISTRY_KEY] || {});
}

export async function saveMissionDelegationRegistry(registryValue, storage = null) {
  const area = requireStorage(storage);
  const next = normalizeMissionDelegationRegistry(registryValue || {});
  next.updatedAt = nowIso();
  await area.set({ [MISSION_DELEGATION_REGISTRY_KEY]: next });
  const stored = await area.get(MISSION_DELEGATION_REGISTRY_KEY);
  const readback = normalizeMissionDelegationRegistry(stored?.[MISSION_DELEGATION_REGISTRY_KEY] || {});
  if (readback.updatedAt !== next.updatedAt ||
      readback.items.length !== next.items.length ||
      readback.items.some((item, index) =>
        item.requestId !== next.items[index]?.requestId ||
        item.state !== next.items[index]?.state ||
        item.targetWindowId !== next.items[index]?.targetWindowId ||
        item.targetQueueId !== next.items[index]?.targetQueueId ||
        item.targetItemId !== next.items[index]?.targetItemId ||
        item.attempts !== next.items[index]?.attempts ||
        item.nextAttemptAtMs !== next.items[index]?.nextAttemptAtMs ||
        JSON.stringify(item.lastError) !== JSON.stringify(next.items[index]?.lastError) ||
        item.rejectedAt !== next.items[index]?.rejectedAt ||
        item.updatedAt !== next.items[index]?.updatedAt
      )) {
    throw new Error("MISSION_DELEGATION_READBACK_MISMATCH");
  }
  return readback;
}

function sameLogicalRequest(a, b) {
  return a.requestId === b.requestId &&
    a.mission === b.mission &&
    a.relation === b.relation &&
    a.sourceQueueId === b.sourceQueueId &&
    a.sourceItemId === b.sourceItemId;
}

export async function registerMissionDelegationRequests(requests, source, storage = null, { now = Date.now() } = {}) {
  const validation = validateMissionDelegationRequests(requests);
  if (!validation.ok) {
    const error = new Error(`MISSION_DELEGATION_REQUEST_INVALID:${validation.errors.join(",")}`);
    error.code = "MISSION_DELEGATION_REQUEST_INVALID";
    error.validation = validation;
    throw error;
  }
  const registry = await loadMissionDelegationRegistry(storage);
  const accepted = [];
  const duplicates = [];
  const sourcePriority = normalizeGreenfieldPriority(source?.sourcePriority || DEFAULT_GREENFIELD_PRIORITY);

  for (const request of requests || []) {
    const next = normalizeMissionDelegation({
      ...request,
      priority: clampDelegatedPriority(request.priority, sourcePriority),
      sourceWindowId: source?.sourceWindowId,
      sourceQueueId: source?.sourceQueueId,
      sourceItemId: source?.sourceItemId,
      sourceProcessId: source?.sourceProcessId,
      sourceRunId: source?.sourceRunId,
      sourceResponseHash: source?.sourceResponseHash,
      state: MISSION_DELEGATION_STATE.PENDING,
      createdAt: nowIso(now),
      updatedAt: nowIso(now)
    }, { now });
    const existing = registry.items.find((item) => item.requestId === next.requestId);
    if (existing) {
      if (!sameLogicalRequest(existing, next)) {
        const error = new Error(`MISSION_DELEGATION_REQUEST_ID_CONFLICT:${next.requestId}`);
        error.code = "MISSION_DELEGATION_REQUEST_ID_CONFLICT";
        error.requestId = next.requestId;
        throw error;
      }
      duplicates.push(existing);
      continue;
    }
    const unfinishedCount = registry.items.filter((item) =>
      !TERMINAL_STATES.has(item.state)
    ).length;
    if (unfinishedCount >= MAX_MISSION_DELEGATIONS) {
      const error = new Error("MISSION_DELEGATION_REGISTRY_FULL");
      error.code = "MISSION_DELEGATION_REGISTRY_FULL";
      throw error;
    }
    registry.items.push(next);
    accepted.push(next);
  }

  if (accepted.length === 0) return { registry, accepted, duplicates };
  const saved = await saveMissionDelegationRegistry(registry, storage);
  return { registry: saved, accepted, duplicates };
}

export async function claimPendingMissionDelegationForWorker(worker, storage = null, {
  now = Date.now(),
  liveTargetQueueIds = null,
  queueFull = null,
  targetQueueRequestIds = []
} = {}) {
  const registry = await loadMissionDelegationRegistry(storage);
  const targetWindowId = Number(worker?.targetWindowId);
  const targetQueueId = text(worker?.targetQueueId, 200).trim();
  if (!Number.isInteger(targetWindowId) || !targetQueueId) return { registry, delegation: null };

  const liveQueues = Array.isArray(liveTargetQueueIds)
    ? new Set(liveTargetQueueIds.map((item) => String(item || "")).filter(Boolean))
    : null;
  // v1.9.3 (operator rule 2026-10-07): work a GFW delegates lands in the queue
  // of the same Chrome window as the delegating GFW. The stable source queue
  // id is the key (a window id can change after a Chrome restart). Insertion
  // still happens on a later worker/recovery pass, never inside the delegating answer.
  const ownedBySource = (item) => String(item.sourceQueueId || "") === targetQueueId;
  const existing = new Set(targetQueueRequestIds);
  const retryDue = (item) => Number(item.nextAttemptAtMs || 0) <= now ||
    existing.has(item.requestId) || (queueFull === false && item.lastError?.code === "MISSION_WORK_QUEUE_FULL");
  if (queueFull === true) {
    let deferred = false;
    registry.items = registry.items.map((item) => {
      const pendingHere = item.state === MISSION_DELEGATION_STATE.PENDING && ownedBySource(item);
      const assignedHere = item.state === MISSION_DELEGATION_STATE.ASSIGNED &&
        (String(item.targetQueueId || "") === targetQueueId ||
          liveQueues && !liveQueues.has(String(item.targetQueueId || "")) && ownedBySource(item));
      if ((!pendingHere && !assignedHere) || existing.has(item.requestId) || !retryDue(item)) return item;
      deferred = true;
      return delegationFailure(item, { code: "MISSION_WORK_QUEUE_FULL", message: "Queue capacity is full; the request remains pending." }, now, true);
    });
    if (deferred) Object.assign(registry, await saveMissionDelegationRegistry(registry, storage));
  }
  const eligible = (item) => retryDue(item) && (queueFull !== true || existing.has(item.requestId));
  // An assignment this queue already holds (including a pre-1.9.3 one made to
  // another window) is reconciled here, never duplicated elsewhere.
  const assignedToThisWorker = registry.items
    .filter((item) => item.state === MISSION_DELEGATION_STATE.ASSIGNED)
    .filter((item) => String(item.targetQueueId || "") === targetQueueId)
    .filter(eligible)
    .sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0))[0] || null;
  const pending = registry.items
    .filter((item) => item.state === MISSION_DELEGATION_STATE.PENDING)
    .filter(ownedBySource)
    .filter(eligible)
    .sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0))[0] || null;
  const orphanedAssignment = liveQueues
    ? registry.items
        .filter((item) => item.state === MISSION_DELEGATION_STATE.ASSIGNED)
        .filter((item) => !liveQueues.has(String(item.targetQueueId || "")))
        .filter(ownedBySource)
        .filter(eligible)
        .sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0))[0] || null
    : null;
  const candidate = assignedToThisWorker || pending || orphanedAssignment;
  if (!candidate) return { registry, delegation: null };

  const updated = normalizeMissionDelegation({
    ...candidate,
    state: MISSION_DELEGATION_STATE.ASSIGNED,
    targetWindowId,
    targetQueueId,
    attempts: assignedToThisWorker
      ? Number(candidate.attempts || 0)
      : Number(candidate.attempts || 0) + 1,
    lastError: null,
    nextAttemptAtMs: 0,
    updatedAt: nowIso(now)
  }, { now });
  registry.items = registry.items.map((item) => item.requestId === updated.requestId ? updated : item);
  const saved = await saveMissionDelegationRegistry(registry, storage);
  return {
    registry: saved,
    delegation: saved.items.find((item) => item.requestId === updated.requestId) || updated
  };
}

function delegationFailure(item, errorRecord, now, countAttempt = false) {
  const attempts = Math.max(0, Number(item.attempts || 0)) + (countAttempt ? 1 : 0);
  const permanent = errorRecord?.code === "MISSION_WORK_QUEUE_DELEGATION_CONFLICT" ||
    errorRecord?.code === "MISSION_DELEGATION_REQUEST_ID_CONFLICT";
  const delay = Math.min(MISSION_DELEGATION_RETRY_MAX_MS,
    MISSION_DELEGATION_RETRY_BASE_MS * (2 ** Math.min(20, Math.max(0, attempts - 1))));
  return normalizeMissionDelegation({ ...item, attempts,
    state: permanent ? MISSION_DELEGATION_STATE.REJECTED : MISSION_DELEGATION_STATE.PENDING,
    targetWindowId: null, targetQueueId: "", targetItemId: "",
    lastError: errorRecord && typeof errorRecord === "object" ? deepClone(errorRecord) : null,
    nextAttemptAtMs: permanent ? 0 : now + delay,
    rejectedAt: permanent ? nowIso(now) : "", updatedAt: nowIso(now)
  }, { now });
}

export function missionDelegationPromptState(registryValue, { sourceQueueId = "", sourceItemId = "" } = {}) {
  const all = normalizeMissionDelegationRegistry(registryValue).items
    .filter(item => item.sourceQueueId === String(sourceQueueId || ""));
  const ranked = all.slice().sort((a, b) =>
    Number(b.sourceItemId === sourceItemId) - Number(a.sourceItemId === sourceItemId) ||
    Number(Boolean(b.lastError)) - Number(Boolean(a.lastError)) ||
    Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return { schema: "eic.greenfield.mission-delegation-status.v1", sourceQueueId,
    counts: Object.fromEntries([...VALID_STATES].map(state => [state, all.filter(item => item.state === state).length])),
    receipts: ranked.slice(0, MAX_MISSION_DELEGATION_RECEIPTS).map(item => ({
      requestId: item.requestId, state: item.state, sourceItemId: item.sourceItemId,
      targetItemId: item.targetItemId, attempts: item.attempts, nextAttemptAtMs: item.nextAttemptAtMs,
      lastError: item.lastError ? { code: text(item.lastError.code, 200), message: text(item.lastError.message, 240) } : null
    })),
    omittedCount: Math.max(0, all.length - MAX_MISSION_DELEGATION_RECEIPTS)
  };
}

export async function releaseMissionDelegation(requestId, errorRecord, storage = null, { now = Date.now() } = {}) {
  const registry = await loadMissionDelegationRegistry(storage);
  let found = false;
  registry.items = registry.items.map((item) => {
    if (item.requestId !== String(requestId || "")) return item;
    if (item.state === MISSION_DELEGATION_STATE.APPLIED || TERMINAL_STATES.has(item.state)) return item;
    found = true;
    return delegationFailure(item, errorRecord, now);
  });
  if (!found) return registry;
  return saveMissionDelegationRegistry(registry, storage);
}

export async function markMissionDelegationApplied(requestId, targetItemId, storage = null, { now = Date.now() } = {}) {
  const registry = await loadMissionDelegationRegistry(storage);
  let found = false;
  registry.items = registry.items.map((item) => {
    if (item.requestId !== String(requestId || "")) return item;
    found = true;
    return normalizeMissionDelegation({
      ...item,
      state: MISSION_DELEGATION_STATE.APPLIED,
      targetItemId: text(targetItemId, 200).trim(),
      lastError: null,
      nextAttemptAtMs: 0,
      appliedAt: item.appliedAt || nowIso(now),
      updatedAt: nowIso(now)
    }, { now });
  });
  if (!found) throw new Error("MISSION_DELEGATION_NOT_FOUND");
  return saveMissionDelegationRegistry(registry, storage);
}

export async function markMissionDelegationCompleted(requestId, storage = null, { now = Date.now() } = {}) {
  const registry = await loadMissionDelegationRegistry(storage);
  let found = false;
  registry.items = registry.items.map((item) => {
    if (item.requestId !== String(requestId || "")) return item;
    found = true;
    return normalizeMissionDelegation({
      ...item,
      state: MISSION_DELEGATION_STATE.COMPLETED,
      completedAt: item.completedAt || nowIso(now),
      lastError: null,
      nextAttemptAtMs: 0,
      updatedAt: nowIso(now)
    }, { now });
  });
  if (!found) return registry;
  return saveMissionDelegationRegistry(registry, storage);
}
