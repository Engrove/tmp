import { readStorage } from "./storage-read.mjs";
import { WORKER_RETIRED_PREFIX } from "./mission-work-queue.mjs";
import { readMissionOwnership } from "./mission-ownership.mjs";
import { storageHealth } from "./storage-health.mjs";
import { packableStorageKey } from "./storage-codec.mjs";
import {
  CHECKPOINT_PREFIX,
  checkpointKeys,
  compactCheckpoint,
  packCheckpointStorage,
  readCheckpoint,
  writeCheckpoint,
  storageLock
} from "./durable-checkpoint.mjs";
import { WORKER_BINDING_WORKER_PREFIX } from "./worker-identity.mjs";

export const STORAGE_RETENTION_KEY = "eic.gf.storage-retention.v1";
export const STORAGE_RETENTION_TRIGGER_RATIO = 0.80;
export const STORAGE_RETENTION_TARGET_RATIO = 0.70;

const PROCESS_PREFIX = "eic.gf.process.worker.";
const QUEUE_PREFIX = "eic.gf.mission-work-queue.worker.";
const QUEUE_REGISTRY_KEY = "eic.gf.mission-work-queue.registry.v2";

const inFlight = new WeakMap();
const lastRuns = new WeakMap();
export const STORAGE_MAINTENANCE_INTERVAL_MS = 60000;

const copy = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const iso = (ms = Date.now()) => new Date(ms).toISOString();

function logicalCheckpointKey(key) {
  if (!String(key || "").startsWith(CHECKPOINT_PREFIX)) return "";
  return String(key).slice(CHECKPOINT_PREFIX.length).replace(/\.[01]$/, "");
}

function workerIdForLogicalKey(key) {
  const value = String(key || "");
  if (value.startsWith(PROCESS_PREFIX)) return value.slice(PROCESS_PREFIX.length);
  if (value.startsWith(QUEUE_PREFIX)) return value.slice(QUEUE_PREFIX.length);
  return "";
}

function timestampFrom(value) {
  if (!value || typeof value !== "object") return 0;
  const candidates = [
    value.updatedAt,
    value.completedAt,
    value.lastMaterialAt,
    value.startedAt,
    value.createdAt,
    value.savedAt
  ];
  let best = 0;
  for (const candidate of candidates) {
    const parsed = typeof candidate === "number" ? candidate : Date.parse(String(candidate || ""));
    if (Number.isFinite(parsed)) best = Math.max(best, parsed);
  }
  return best;
}

async function liveWorkerIds(session) {
  if (!session?.get) return new Set();
  const all = await readStorage(session,null);
  const out = new Set();
  for (const [key, value] of Object.entries(all || {})) {
    if (!key.startsWith(WORKER_BINDING_WORKER_PREFIX)) continue;
    const workerId = String(value?.workerId || key.slice(WORKER_BINDING_WORKER_PREFIX.length)).trim();
    if (workerId) out.add(workerId);
  }
  return out;
}

async function logicalKeys(local) {
  const all = await readStorage(local,null,{decode:false});
  const keys = new Set();
  for (const key of Object.keys(all || {})) {
    if (key.startsWith(CHECKPOINT_PREFIX)) {
      const logical = logicalCheckpointKey(key);
      if (logical) keys.add(logical);
      continue;
    }
    if (key.startsWith("eic.gf.")) keys.add(key);
  }
  return { all, keys };
}

async function compactCheckpointHistory(local) {
  const { keys } = await logicalKeys(local);
  let compacted = 0;
  let removedSlots = 0;
  const errors = [];
  for (const key of keys) {
    const slots = checkpointKeys(key);
    const rows = await readStorage(local,slots,{decode:false});
    if (!rows?.[slots[0]] || !rows?.[slots[1]]) continue;
    try {
      const result = await compactCheckpoint(key, local);
      if (result.changed) {
        compacted += 1;
        removedSlots += result.removed?.length || 0;
      }
    } catch (error) {
      errors.push({ key, code:String(error?.message || error) });
    }
  }
  return { compacted, removedSlots, errors };
}

async function packProtectedRecords(local) {
  const {keys} = await logicalKeys(local);
  let packedRecords = 0;
  const errors = [], retainedRecords = [];
  for (const key of keys) {
    if (!packableStorageKey(key)) continue;
    try {
      const result = await packCheckpointStorage(key,local);
      if (result.changed) packedRecords += result.keys.length;
      else if (!['VERIFIED','LEGACY','EMPTY'].includes(result.health))
        retainedRecords.push({key,code:result.health});
    } catch(error) { errors.push({key,code:String(error?.message || error)}); }
  }
  return {packedRecords,errors,retainedRecords};
}

async function readLogicalValue(local, key, all = null) {
  try {
    const record = await readCheckpoint(key, local);
    if (record?.value) return { value:record.value, health:record.health, revision:record.revision };
  } catch {}
  const source = all || await readStorage(local,null);
  if (source?.[key] && typeof source[key] === "object") {
    return { value:copy(source[key]), health:"PRIMARY_ONLY", revision:0 };
  }
  let newest = null;
  for (const slot of checkpointKeys(key)) {
    const envelope = source?.[slot];
    if (!envelope?.value || typeof envelope.value !== "object") continue;
    if (!newest || Number(envelope.revision || 0) > Number(newest.revision || 0)) newest = envelope;
  }
  return newest
    ? { value:copy(newest.value), health:"CHECKPOINT_FALLBACK", revision:Number(newest.revision || 0) }
    : { value:null, health:"EMPTY", revision:0 };
}

async function workerCandidates(local, session) {
  const { all, keys } = await logicalKeys(local);
  const live = await liveWorkerIds(session);
  const workers = new Map();
  for (const key of keys) {
    const workerId = workerIdForLogicalKey(key);
    if (!workerId) continue;
    const row = workers.get(workerId) || { workerId, keys:new Set(), atMs:0, phase:"", queueUpdatedAt:"" };
    row.keys.add(key);
    workers.set(workerId, row);
  }
  for (const row of workers.values()) {
    const processKey = PROCESS_PREFIX + row.workerId;
    const queueKey = QUEUE_PREFIX + row.workerId;
    const [process, queue] = await Promise.all([
      readLogicalValue(local, processKey, all),
      readLogicalValue(local, queueKey, all)
    ]);
    row.atMs = Math.max(timestampFrom(process.value), timestampFrom(queue.value));
    row.phase = String(process.value?.phase || "");
    row.queueUpdatedAt = String(queue.value?.updatedAt || "");
    row.live = live.has(row.workerId);
  }
  return [...workers.values()]
    .filter((row) => !row.live)
    .sort((a,b) => (a.atMs - b.atMs) || a.workerId.localeCompare(b.workerId));
}

async function removeWorkerBundle(local, session, workerId) {
  const processKey = PROCESS_PREFIX + workerId;
  const queueKey = QUEUE_PREFIX + workerId;
  // Same lock and order as queue publication. Otherwise a stale registry
  // read can resurrect a removed worker or erase a concurrent new worker.
  return storageLock(local, `${QUEUE_REGISTRY_KEY}:write`, () => storageLock(local, processKey, () =>
    storageLock(local, queueKey, async () => {
      const live = await liveWorkerIds(session);
      if (live.has(workerId)) return { removed:false, code:"WORKER_BECAME_LIVE" };
      const ownership = await readMissionOwnership(local);
      const evidence = await readStorage(local,[processKey,...checkpointKeys(processKey),queueKey,...checkpointKeys(queueKey)]);
      // This function already holds the process/queue checkpoint locks. Never
      // call readCheckpoint recursively here. Retain any process or WAL data;
      // only empty/never-started legacy queues are eligible for deletion.
      if (Object.values(ownership.owners).some(owner=>owner.workerId===workerId) ||
          [processKey,...checkpointKeys(processKey),...checkpointKeys(queueKey)].some(k=>evidence[k]) ||
          evidence[queueKey]?.enabled || evidence[queueKey]?.history?.length || evidence[queueKey]?.items?.length ||
          (evidence[queueKey]?.items || []).some(item=>item.processSnapshot || item.resume ||
            item.activatedAt || item.activationCount || item.status === "ACTIVE"))
        return {removed:false,code:"WORKER_MISSION_EVIDENCE_RETAINED"};
      const keys = [
        processKey, ...checkpointKeys(processKey),
        queueKey, ...checkpointKeys(queueKey)
      ];
      // Keep lifecycle metadata before deleting the payload. A crash before
      // registry cleanup must not make a retired identity look newly created.
      const retirementKey = WORKER_RETIRED_PREFIX + workerId;
      const retired = await readCheckpoint(retirementKey, local);
      if (!retired.value) await writeCheckpoint(retirementKey, {
        schema:"eic.greenfield.worker-retired.v1",workerId,
        queueId:String(evidence[queueKey]?.queueId || ""),retiredAtMs:Date.now(),
        reason:"EMPTY_NEVER_STARTED_WORKER_RETAINED_METADATA",terminalAuthority:false
      }, local);
      await local.remove(keys);
      const readback = await readStorage(local,keys);
      if (Object.keys(readback || {}).length) {
        throw new Error(`STORAGE_RETENTION_DELETE_READBACK_FAILED:${workerId}`);
      }
      const registry = (await readStorage(local,QUEUE_REGISTRY_KEY))?.[QUEUE_REGISTRY_KEY];
      if (registry && Array.isArray(registry.entries)) {
        const entries = registry.entries.filter((entry) => String(entry?.workerId || "") !== workerId);
        if (entries.length !== registry.entries.length) {
          const next = { ...registry, entries, updatedAt:iso() };
          await local.set({ [QUEUE_REGISTRY_KEY]:next });
        }
      }
      return { removed:true, keys };
    })
  ));
}

async function persistStatus(local, status) {
  try {
    await local.set({ [STORAGE_RETENTION_KEY]:copy(status) });
  } catch {}
  return status;
}

export async function readStorageRetentionStatus(local = chrome.storage.local) {
  const stored = await readStorage(local,STORAGE_RETENTION_KEY);
  return copy(stored?.[STORAGE_RETENTION_KEY] || null);
}

async function maintain(local, session, {
  reason = "periodic",
  triggerRatio = STORAGE_RETENTION_TRIGGER_RATIO,
  targetRatio = STORAGE_RETENTION_TARGET_RATIO,
  force = false,
  now = Date.now()
} = {}) {
  const before = await storageHealth(local);
  if (!before.known) {
    return persistStatus(local, {
      schema:"eic.greenfield.storage-retention.v1",
      at:iso(now), reason, known:false, action:"UNAVAILABLE"
    });
  }

  const base = {
    schema:"eic.greenfield.storage-retention.v1",
    at:iso(now),
    reason,
    known:true,
    triggerRatio,
    targetRatio,
    beforeBytes:before.bytes,
    limitBytes:before.limitBytes,
    beforeRatio:before.ratio,
    compactedCheckpoints:0,
    removedCheckpointSlots:0,
    packedRecords:0,
    removedWorkers:[],
    retainedWorkers:[],
    retainedRecords:[],
    errors:[]
  };

  if (!force && before.ratio < triggerRatio) {
    return persistStatus(local, {
      ...base,
      action:"NO_ACTION",
      afterBytes:before.bytes,
      afterRatio:before.ratio,
      freedBytes:0,
      targetReached:before.ratio <= targetRatio,
      pressureRemaining:false
    });
  }

  const compacted = await compactCheckpointHistory(local);
  base.compactedCheckpoints = compacted.compacted;
  base.removedCheckpointSlots = compacted.removedSlots;
  base.errors.push(...compacted.errors);

  const packed = await packProtectedRecords(local);
  base.packedRecords = packed.packedRecords;
  base.retainedRecords = packed.retainedRecords;
  base.errors.push(...packed.errors);

  let health = await storageHealth(local);
  if (health.ratio > targetRatio) {
    const candidates = await workerCandidates(local, session);
    for (const candidate of candidates) {
      if (health.ratio <= targetRatio) break;
      try {
        const result = await removeWorkerBundle(local, session, candidate.workerId);
        if (result.removed) {
          base.removedWorkers.push({
            workerId:candidate.workerId,
            lastActivityAt:candidate.atMs ? iso(candidate.atMs) : "",
            phase:candidate.phase || "UNKNOWN"
          });
          health = await storageHealth(local);
        } else base.retainedWorkers.push({workerId:candidate.workerId,code:result.code});
      } catch (error) {
        base.errors.push({ workerId:candidate.workerId, code:String(error?.message || error) });
      }
    }
  }

  health = await storageHealth(local);
  const freedBytes = Math.max(0,before.bytes-health.bytes);
  const targetReached = health.ratio <= targetRatio;
  const changed = base.packedRecords + base.removedCheckpointSlots + base.removedWorkers.length > 0;
  return persistStatus(local, {
    ...base,
    action:base.errors.length ? "ERROR" : changed ? (targetReached ? "COMPACTED" : "PARTIAL")
      : targetReached ? "NO_ACTION" : "RETAINED_PROTECTED",
    afterBytes:health.bytes,
    afterRatio:health.ratio,
    freedBytes,
    targetReached,
    pressureRemaining:health.ratio >= triggerRatio
  });
}

export async function maintainStorageHeadroom(
  local = chrome.storage.local,
  session = chrome.storage.session,
  options = {}
) {
  if (inFlight.has(local)) return inFlight.get(local);
  const now = options.now ?? Date.now(), last = lastRuns.get(local);
  if (!options.force && last && now >= last.atMs && now-last.atMs < STORAGE_MAINTENANCE_INTERVAL_MS)
    return last.result;
  const run = maintain(local, session, {...options,now});
  inFlight.set(local,run);
  try {
    const result = await run;
    lastRuns.set(local,{atMs:now,result});
    return result;
  } finally {
    inFlight.delete(local);
  }
}
