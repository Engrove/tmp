export const GLOBAL_CAPACITY_SCHEDULER_KEY = "eic.gf.global-capacity-scheduler.v1";
export const GLOBAL_CAPACITY_SCHEDULER_SCHEMA = "eic.greenfield.global-capacity-scheduler.v1";

export const GREENFIELD_PRIORITIES = Object.freeze({
  LOW: 0,
  NORMAL: 1,
  HIGH: 2,
  URGENT: 3
});

export const GREENFIELD_PRIORITY_LABELS = Object.freeze({
  LOW: "Låg",
  NORMAL: "Normal",
  HIGH: "Hög",
  URGENT: "Brådskande"
});

export const DEFAULT_GREENFIELD_PRIORITY = "NORMAL";
export const MIN_MAX_ACTIVE_SESSIONS = 1;
export const MAX_MAX_ACTIVE_SESSIONS = 4;
export const DEFAULT_MAX_ACTIVE_SESSIONS = 2;

// Anti-starvation invariant:
// every full aging step raises a waiting session one priority level. A LOW
// session therefore reaches the same effective level as URGENT after 9 min.
// Once levels tie, readySince/ticket order wins, so later high-priority
// arrivals cannot starve an older lower-priority waiter indefinitely.
export const PRIORITY_AGING_STEP_MS = 3 * 60 * 1000;
export const LOW_TO_TOP_PRIORITY_MAX_AGING_MS =
  (GREENFIELD_PRIORITIES.URGENT - GREENFIELD_PRIORITIES.LOW) * PRIORITY_AGING_STEP_MS;

let schedulerQueue = Promise.resolve();

function serialize(work) {
  const next = schedulerQueue.then(work, work);
  schedulerQueue = next.catch(() => undefined);
  return next;
}

function finiteMs(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

function normalizeWindowId(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

export function normalizeGreenfieldPriority(value) {
  const key = String(value || DEFAULT_GREENFIELD_PRIORITY).trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(GREENFIELD_PRIORITIES, key)
    ? key
    : DEFAULT_GREENFIELD_PRIORITY;
}

export function normalizeMaxActiveSessions(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_MAX_ACTIVE_SESSIONS;
  return Math.max(
    MIN_MAX_ACTIVE_SESSIONS,
    Math.min(MAX_MAX_ACTIVE_SESSIONS, Math.round(n))
  );
}

export function normalizeEffectiveCapacity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_MAX_ACTIVE_SESSIONS;
  return Math.max(0, Math.min(MAX_MAX_ACTIVE_SESSIONS, Math.round(n)));
}

export function schedulerPriorityRank(priority) {
  return GREENFIELD_PRIORITIES[normalizeGreenfieldPriority(priority)];
}

export function effectiveSchedulerPriority(priority, readySinceMs, now = Date.now()) {
  const base = schedulerPriorityRank(priority);
  const waitMs = Math.max(0, finiteMs(now) - finiteMs(readySinceMs));
  const agingLevels = Math.floor(waitMs / PRIORITY_AGING_STEP_MS);
  const rank = Math.min(GREENFIELD_PRIORITIES.URGENT, base + agingLevels);
  return {
    priority: Object.keys(GREENFIELD_PRIORITIES)
      .find((key) => GREENFIELD_PRIORITIES[key] === rank) || "URGENT",
    rank,
    baseRank: base,
    waitMs,
    agingLevels
  };
}

// v1.8.12 reserved slot. One worker (the Chrome window's Greenfield binding)
// can be given a slot of its own for GFWs that must run around the clock.
// With effective capacity >= 2 that slot is exclusive: the reserved worker
// always finds it free, and no other worker may use it, even while the
// reserved worker is idle; the other workers share capacity - 1. With
// effective capacity 1 (serial rate-limit recovery) the reserved worker only
// goes first. Callers pass an empty id when no reservation applies (the
// configured capacity is 1). Running turns are never pre-empted.
export const RESERVATION_MODES = Object.freeze({
  NONE: "NONE",
  EXCLUSIVE: "EXCLUSIVE",
  FIRST_IN_LINE: "FIRST_IN_LINE",
  SUSPENDED: "SUSPENDED"
});

export function normalizeReservedWorkerId(value) {
  return String(value || "").trim().slice(0, 200);
}

function isReservedEntry(item, reservedWorkerId) {
  return Boolean(reservedWorkerId) && item?.workerId === reservedWorkerId;
}

function normalizeWaiter(value = {}) {
  const processId = String(value.processId || "").trim();
  if (!processId) return null;
  return {
    processId,
    workerId: normalizeReservedWorkerId(value.workerId),
    windowId: normalizeWindowId(value.windowId),
    promptHash: String(value.promptHash || ""),
    priority: normalizeGreenfieldPriority(value.priority),
    readySinceMs: finiteMs(value.readySinceMs),
    ticketSeq: Math.max(0, Number(value.ticketSeq || 0) | 0),
    updatedAtMs: finiteMs(value.updatedAtMs)
  };
}

function normalizeActiveTurn(value = {}) {
  const processId = String(value.processId || "").trim();
  if (!processId) return null;
  return {
    processId,
    workerId: normalizeReservedWorkerId(value.workerId),
    windowId: normalizeWindowId(value.windowId),
    promptHash: String(value.promptHash || ""),
    priority: normalizeGreenfieldPriority(value.priority),
    readySinceMs: finiteMs(value.readySinceMs),
    ticketSeq: Math.max(0, Number(value.ticketSeq || 0) | 0),
    acquiredAtMs: finiteMs(value.acquiredAtMs),
    updatedAtMs: finiteMs(value.updatedAtMs)
  };
}

function dedupeByProcessId(values, normalizer) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const item = normalizer(raw);
    if (!item || seen.has(item.processId)) continue;
    seen.add(item.processId);
    out.push(item);
  }
  return out;
}

export function normalizeGlobalCapacityScheduler(value = {}) {
  const activeTurns = dedupeByProcessId(value.activeTurns, normalizeActiveTurn);
  const activeIds = new Set(activeTurns.map((item) => item.processId));
  const waiters = dedupeByProcessId(value.waiters, normalizeWaiter)
    .filter((item) => !activeIds.has(item.processId));
  return {
    schema: GLOBAL_CAPACITY_SCHEDULER_SCHEMA,
    ticketSeq: Math.max(0, Number(value.ticketSeq || 0) | 0),
    activeTurns,
    waiters,
    updatedAt: String(value.updatedAt || "")
  };
}

async function readRaw(storage) {
  const stored = await storage.get(GLOBAL_CAPACITY_SCHEDULER_KEY);
  return normalizeGlobalCapacityScheduler(
    stored?.[GLOBAL_CAPACITY_SCHEDULER_KEY] || {}
  );
}

async function writeReadback(next, storage) {
  const normalized = normalizeGlobalCapacityScheduler(next);
  await storage.set({ [GLOBAL_CAPACITY_SCHEDULER_KEY]: normalized });
  return readRaw(storage);
}

function rankedWaiters(state, now) {
  const nowMs = finiteMs(now);
  return state.waiters.slice().sort((a, b) => {
    const ae = effectiveSchedulerPriority(a.priority, a.readySinceMs, nowMs);
    const be = effectiveSchedulerPriority(b.priority, b.readySinceMs, nowMs);
    if (ae.rank !== be.rank) return be.rank - ae.rank;
    if (a.readySinceMs !== b.readySinceMs) return a.readySinceMs - b.readySinceMs;
    if (a.ticketSeq !== b.ticketSeq) return a.ticketSeq - b.ticketSeq;
    return a.processId.localeCompare(b.processId);
  });
}

function publicWaiter(waiter, now, rank) {
  const effective = effectiveSchedulerPriority(waiter.priority, waiter.readySinceMs, now);
  return {
    ...waiter,
    effectivePriority: effective.priority,
    effectivePriorityRank: effective.rank,
    waitMs: effective.waitMs,
    agingLevels: effective.agingLevels,
    queueRank: rank
  };
}

// Which waiters may take a slot now, in queue order, with the reserved
// worker's lane applied.
function laneSelection(state, { capacity, reservedWorkerId = "", now }) {
  const effectiveCapacity = normalizeEffectiveCapacity(capacity);
  const reserved = normalizeReservedWorkerId(reservedWorkerId);
  const ranked = rankedWaiters(state, now);
  const totalFree = Math.max(0, effectiveCapacity - state.activeTurns.length);
  const activeReserved = state.activeTurns.filter((item) => isReservedEntry(item, reserved)).length;
  const activeShared = state.activeTurns.length - activeReserved;
  if (!reserved) {
    return {
      ordered: ranked,
      runnable: ranked.slice(0, totalFree),
      reservation: { workerId: "", mode: RESERVATION_MODES.NONE, reservedActive: false, reservedSlotFree: false,
        sharedCapacity: effectiveCapacity, activeShared, sharedAvailableSlots: totalFree }
    };
  }
  const reservedWaiters = ranked.filter((item) => isReservedEntry(item, reserved));
  const sharedWaiters = ranked.filter((item) => !isReservedEntry(item, reserved));
  const ordered = [...reservedWaiters, ...sharedWaiters];
  if (effectiveCapacity >= 2) {
    const reservedFree = activeReserved === 0 ? Math.min(1, totalFree) : 0;
    const sharedFree = Math.max(0, Math.min(
      effectiveCapacity - 1 - activeShared,
      totalFree - (activeReserved === 0 ? 1 : 0)
    ));
    return {
      ordered,
      runnable: [...reservedWaiters.slice(0, reservedFree), ...sharedWaiters.slice(0, sharedFree)],
      reservation: { workerId: reserved, mode: RESERVATION_MODES.EXCLUSIVE, reservedActive: activeReserved > 0,
        reservedSlotFree: reservedFree > 0, sharedCapacity: effectiveCapacity - 1, activeShared, sharedAvailableSlots: sharedFree }
    };
  }
  return {
    ordered,
    runnable: ordered.slice(0, totalFree),
    reservation: { workerId: reserved,
      mode: effectiveCapacity === 1 ? RESERVATION_MODES.FIRST_IN_LINE : RESERVATION_MODES.SUSPENDED,
      reservedActive: activeReserved > 0, reservedSlotFree: false, sharedCapacity: effectiveCapacity, activeShared,
      sharedAvailableSlots: totalFree }
  };
}

function snapshotOf(state, {
  capacity = DEFAULT_MAX_ACTIVE_SESSIONS,
  configuredCapacity = capacity,
  reservedWorkerId = "",
  now = Date.now()
} = {}) {
  const effectiveCapacity = normalizeEffectiveCapacity(capacity);
  const configured = normalizeMaxActiveSessions(configuredCapacity);
  const lanes = laneSelection(state, { capacity: effectiveCapacity, reservedWorkerId, now });
  const availableSlots = Math.max(0, effectiveCapacity - state.activeTurns.length);
  return {
    schema: state.schema,
    configuredCapacity: configured,
    effectiveCapacity,
    activeCount: state.activeTurns.length,
    waitingCount: state.waiters.length,
    availableSlots,
    reservation: lanes.reservation,
    activeTurns: state.activeTurns.map((item) => ({ ...item })),
    waiters: lanes.ordered.map((item, index) => publicWaiter(item, now, index + 1)),
    runnableProcessIds: lanes.runnable.map((item) => item.processId),
    updatedAt: state.updatedAt
  };
}

export async function readGlobalCapacityScheduler(
  storage = chrome.storage.local,
  options = {}
) {
  const state = await readRaw(storage);
  return snapshotOf(state, options);
}

export async function requestGlobalTurnSlot({
  processId,
  windowId,
  workerId = "",
  promptHash,
  priority = DEFAULT_GREENFIELD_PRIORITY,
  capacity = DEFAULT_MAX_ACTIVE_SESSIONS,
  configuredCapacity = capacity,
  reservedWorkerId = "",
  now = Date.now(),
  storage = chrome.storage.local
}) {
  const id = String(processId || "").trim();
  const hash = String(promptHash || "");
  if (!id) throw new Error("GLOBAL_CAPACITY_PROCESS_ID_REQUIRED");
  if (!hash) throw new Error("GLOBAL_CAPACITY_PROMPT_HASH_REQUIRED");

  return serialize(async () => {
    const nowMs = finiteMs(now);
    let current = await readRaw(storage);
    const normalizedPriority = normalizeGreenfieldPriority(priority);
    const active = current.activeTurns.find((item) => item.processId === id);
    if (active) {
      const samePrompt = !active.promptHash || active.promptHash === hash;
      const snapshot = snapshotOf(current, { capacity, configuredCapacity, reservedWorkerId, now: nowMs });
      return {
        allowed: samePrompt,
        reason: samePrompt
          ? "GLOBAL_CAPACITY_ALREADY_ACTIVE"
          : "GLOBAL_CAPACITY_ACTIVE_PROMPT_MISMATCH",
        activeTurn: { ...active },
        queueRank: 0,
        scheduler: snapshot,
        runnableProcessIds: snapshot.runnableProcessIds
      };
    }

    const existingIndex = current.waiters.findIndex((item) => item.processId === id);
    let waiter;
    if (existingIndex >= 0) {
      const existing = current.waiters[existingIndex];
      const samePrompt = !existing.promptHash || existing.promptHash === hash;
      waiter = {
        ...existing,
        workerId: normalizeReservedWorkerId(workerId) || existing.workerId,
        windowId: normalizeWindowId(windowId),
        promptHash: hash,
        priority: normalizedPriority,
        readySinceMs: samePrompt && existing.readySinceMs
          ? existing.readySinceMs
          : nowMs,
        ticketSeq: samePrompt && existing.ticketSeq
          ? existing.ticketSeq
          : current.ticketSeq + 1,
        updatedAtMs: nowMs
      };
      if (!samePrompt || !existing.ticketSeq) {
        current = { ...current, ticketSeq: Math.max(current.ticketSeq + 1, waiter.ticketSeq) };
      }
      current.waiters.splice(existingIndex, 1, waiter);
    } else {
      const ticketSeq = current.ticketSeq + 1;
      waiter = {
        processId: id,
        workerId: normalizeReservedWorkerId(workerId),
        windowId: normalizeWindowId(windowId),
        promptHash: hash,
        priority: normalizedPriority,
        readySinceMs: nowMs,
        ticketSeq,
        updatedAtMs: nowMs
      };
      current = {
        ...current,
        ticketSeq,
        waiters: [...current.waiters, waiter]
      };
    }

    const effectiveCapacity = normalizeEffectiveCapacity(capacity);
    const winners = laneSelection(current, { capacity: effectiveCapacity, reservedWorkerId, now: nowMs }).runnable;
    const selected = winners.some((item) => item.processId === id);

    if (!selected) {
      const saved = await writeReadback({
        ...current,
        updatedAt: new Date(nowMs).toISOString()
      }, storage);
      const snapshot = snapshotOf(saved, {
        capacity: effectiveCapacity,
        configuredCapacity,
        reservedWorkerId,
        now: nowMs
      });
      const queued = snapshot.waiters.find((item) => item.processId === id);
      return {
        allowed: false,
        reason: effectiveCapacity <= 0
          ? "GLOBAL_CAPACITY_SUSPENDED"
          : "GLOBAL_CAPACITY_WAIT",
        queueRank: queued?.queueRank || null,
        effectivePriority: queued?.effectivePriority || normalizedPriority,
        scheduler: snapshot,
        runnableProcessIds: snapshot.runnableProcessIds
      };
    }

    const selectedWaiter = current.waiters.find((item) => item.processId === id) || waiter;
    const activeTurn = {
      processId: id,
      workerId: normalizeReservedWorkerId(workerId) || selectedWaiter.workerId || "",
      windowId: normalizeWindowId(windowId),
      promptHash: hash,
      priority: normalizedPriority,
      readySinceMs: selectedWaiter.readySinceMs || nowMs,
      ticketSeq: selectedWaiter.ticketSeq || current.ticketSeq,
      acquiredAtMs: nowMs,
      updatedAtMs: nowMs
    };
    const next = {
      ...current,
      waiters: current.waiters.filter((item) => item.processId !== id),
      activeTurns: [...current.activeTurns, activeTurn],
      updatedAt: new Date(nowMs).toISOString()
    };
    const readback = await writeReadback(next, storage);
    const committed = readback.activeTurns.find((item) => item.processId === id);
    if (!committed || committed.promptHash !== hash) {
      throw new Error("GLOBAL_CAPACITY_ACQUIRE_READBACK_MISMATCH");
    }
    const snapshot = snapshotOf(readback, {
      capacity: effectiveCapacity,
      configuredCapacity,
      reservedWorkerId,
      now: nowMs
    });
    return {
      allowed: true,
      reason: "GLOBAL_CAPACITY_SLOT_ACQUIRED",
      activeTurn: { ...committed },
      queueRank: 0,
      scheduler: snapshot,
      runnableProcessIds: snapshot.runnableProcessIds
    };
  });
}


export async function adoptGlobalTurnSlot({
  processId,
  windowId,
  workerId = "",
  promptHash,
  priority = DEFAULT_GREENFIELD_PRIORITY,
  capacity = DEFAULT_MAX_ACTIVE_SESSIONS,
  configuredCapacity = capacity,
  reservedWorkerId = "",
  observedEffect = false,
  now = Date.now(),
  storage = chrome.storage.local
}) {
  const id = String(processId || "").trim();
  const hash = String(promptHash || "");
  if (!id) throw new Error("GLOBAL_CAPACITY_PROCESS_ID_REQUIRED");
  if (!hash) throw new Error("GLOBAL_CAPACITY_PROMPT_HASH_REQUIRED");
  if (observedEffect !== true) {
    throw new Error("GLOBAL_CAPACITY_ADOPT_REQUIRES_OBSERVED_EFFECT");
  }
  return serialize(async () => {
    const nowMs = finiteMs(now);
    const current = await readRaw(storage);
    const effectiveCapacity = normalizeEffectiveCapacity(capacity);
    const existing = current.activeTurns.find((item) => item.processId === id);
    if (existing) {
      const snapshot = snapshotOf(current, { capacity, configuredCapacity, reservedWorkerId, now: nowMs });
      return {
        adopted: false,
        alreadyActive: true,
        observedEffect: true,
        observedOverCapacity: current.activeTurns.length > effectiveCapacity,
        activeTurn: { ...existing },
        scheduler: snapshot,
        runnableProcessIds: snapshot.runnableProcessIds
      };
    }
    const waiter = current.waiters.find((item) => item.processId === id);
    const activeTurn = {
      processId: id,
      workerId: normalizeReservedWorkerId(workerId) || waiter?.workerId || "",
      windowId: normalizeWindowId(windowId),
      promptHash: hash,
      priority: normalizeGreenfieldPriority(priority),
      readySinceMs: waiter?.readySinceMs || nowMs,
      ticketSeq: waiter?.ticketSeq || current.ticketSeq,
      acquiredAtMs: nowMs,
      updatedAtMs: nowMs
    };
    const next = {
      ...current,
      waiters: current.waiters.filter((item) => item.processId !== id),
      activeTurns: [...current.activeTurns, activeTurn],
      updatedAt: new Date(nowMs).toISOString()
    };
    const readback = await writeReadback(next, storage);
    const committed = readback.activeTurns.find((item) => item.processId === id);
    if (!committed || committed.promptHash !== hash) {
      throw new Error("GLOBAL_CAPACITY_ADOPT_READBACK_MISMATCH");
    }
    const snapshot = snapshotOf(readback, { capacity, configuredCapacity, reservedWorkerId, now: nowMs });
    return {
      adopted: true,
      alreadyActive: false,
      observedEffect: true,
      observedOverCapacity: readback.activeTurns.length > effectiveCapacity,
      activeTurn: { ...committed },
      scheduler: snapshot,
      runnableProcessIds: snapshot.runnableProcessIds
    };
  });
}

export async function releaseGlobalTurnSlot({
  processId,
  promptHash = "",
  capacity = DEFAULT_MAX_ACTIVE_SESSIONS,
  configuredCapacity = capacity,
  reservedWorkerId = "",
  now = Date.now(),
  storage = chrome.storage.local
}) {
  const id = String(processId || "").trim();
  if (!id) throw new Error("GLOBAL_CAPACITY_PROCESS_ID_REQUIRED");
  return serialize(async () => {
    const nowMs = finiteMs(now);
    const current = await readRaw(storage);
    const active = current.activeTurns.find((item) => item.processId === id);
    const expectedHash = String(promptHash || "");
    if (active && expectedHash && active.promptHash && active.promptHash !== expectedHash) {
      return {
        released: false,
        reason: "GLOBAL_CAPACITY_RELEASE_PROMPT_MISMATCH",
        scheduler: snapshotOf(current, { capacity, configuredCapacity, reservedWorkerId, now: nowMs }),
        runnableProcessIds: []
      };
    }
    const next = {
      ...current,
      activeTurns: current.activeTurns.filter((item) => item.processId !== id),
      updatedAt: new Date(nowMs).toISOString()
    };
    const readback = await writeReadback(next, storage);
    const snapshot = snapshotOf(readback, {
      capacity,
      configuredCapacity,
      reservedWorkerId,
      now: nowMs
    });
    return {
      released: Boolean(active),
      reason: active ? "GLOBAL_CAPACITY_SLOT_RELEASED" : "GLOBAL_CAPACITY_SLOT_NOT_HELD",
      scheduler: snapshot,
      runnableProcessIds: snapshot.runnableProcessIds
    };
  });
}

export async function cancelGlobalTurnProcess({
  processId,
  capacity = DEFAULT_MAX_ACTIVE_SESSIONS,
  configuredCapacity = capacity,
  reservedWorkerId = "",
  now = Date.now(),
  storage = chrome.storage.local
}) {
  const id = String(processId || "").trim();
  if (!id) throw new Error("GLOBAL_CAPACITY_PROCESS_ID_REQUIRED");
  return serialize(async () => {
    const nowMs = finiteMs(now);
    const current = await readRaw(storage);
    const hadActive = current.activeTurns.some((item) => item.processId === id);
    const hadWaiter = current.waiters.some((item) => item.processId === id);
    const next = {
      ...current,
      activeTurns: current.activeTurns.filter((item) => item.processId !== id),
      waiters: current.waiters.filter((item) => item.processId !== id),
      updatedAt: new Date(nowMs).toISOString()
    };
    const readback = await writeReadback(next, storage);
    const snapshot = snapshotOf(readback, {
      capacity,
      configuredCapacity,
      reservedWorkerId,
      now: nowMs
    });
    return {
      removed: hadActive || hadWaiter,
      hadActive,
      hadWaiter,
      scheduler: snapshot,
      runnableProcessIds: snapshot.runnableProcessIds
    };
  });
}

export async function updateGlobalTurnPriority({
  processId,
  priority,
  capacity = DEFAULT_MAX_ACTIVE_SESSIONS,
  configuredCapacity = capacity,
  reservedWorkerId = "",
  now = Date.now(),
  storage = chrome.storage.local
}) {
  const id = String(processId || "").trim();
  if (!id) throw new Error("GLOBAL_CAPACITY_PROCESS_ID_REQUIRED");
  const normalizedPriority = normalizeGreenfieldPriority(priority);
  return serialize(async () => {
    const nowMs = finiteMs(now);
    const current = await readRaw(storage);
    const next = {
      ...current,
      activeTurns: current.activeTurns.map((item) => (
        item.processId === id
          ? { ...item, priority: normalizedPriority, updatedAtMs: nowMs }
          : item
      )),
      waiters: current.waiters.map((item) => (
        item.processId === id
          ? { ...item, priority: normalizedPriority, updatedAtMs: nowMs }
          : item
      )),
      updatedAt: new Date(nowMs).toISOString()
    };
    const readback = await writeReadback(next, storage);
    const snapshot = snapshotOf(readback, {
      capacity,
      configuredCapacity,
      reservedWorkerId,
      now: nowMs
    });
    return {
      priority: normalizedPriority,
      scheduler: snapshot,
      runnableProcessIds: snapshot.runnableProcessIds
    };
  });
}

export async function reconcileGlobalCapacityScheduler({
  activeTurns = [],
  eligibleWaiters = [],
  capacity = DEFAULT_MAX_ACTIVE_SESSIONS,
  configuredCapacity = capacity,
  reservedWorkerId = "",
  now = Date.now(),
  storage = chrome.storage.local
} = {}) {
  return serialize(async () => {
    const nowMs = finiteMs(now);
    const current = await readRaw(storage);
    const activeMap = new Map(
      (Array.isArray(activeTurns) ? activeTurns : [])
        .map((item) => normalizeActiveTurn({
          ...item,
          acquiredAtMs: item?.acquiredAtMs || nowMs,
          updatedAtMs: nowMs
        }))
        .filter(Boolean)
        .map((item) => [item.processId, item])
    );
    const waiterMap = new Map(
      (Array.isArray(eligibleWaiters) ? eligibleWaiters : [])
        .map((item) => normalizeWaiter({
          ...item,
          readySinceMs: item?.readySinceMs || nowMs,
          updatedAtMs: nowMs
        }))
        .filter(Boolean)
        .map((item) => [item.processId, item])
    );

    const nextActive = [];
    for (const [processId, candidate] of activeMap) {
      const prior = current.activeTurns.find((item) => item.processId === processId);
      nextActive.push(prior
        ? {
            ...prior,
            workerId: candidate.workerId || prior.workerId,
            windowId: candidate.windowId,
            promptHash: candidate.promptHash || prior.promptHash,
            priority: candidate.priority,
            updatedAtMs: nowMs
          }
        : candidate
      );
      waiterMap.delete(processId);
    }

    let ticketSeq = current.ticketSeq;
    const nextWaiters = [];
    for (const [processId, candidate] of waiterMap) {
      const prior = current.waiters.find((item) => item.processId === processId);
      if (prior && (!candidate.promptHash || candidate.promptHash === prior.promptHash)) {
        nextWaiters.push({
          ...prior,
          workerId: candidate.workerId || prior.workerId,
          windowId: candidate.windowId,
          promptHash: candidate.promptHash || prior.promptHash,
          priority: candidate.priority,
          updatedAtMs: nowMs
        });
      } else {
        ticketSeq += 1;
        nextWaiters.push({
          ...candidate,
          readySinceMs: candidate.readySinceMs || nowMs,
          ticketSeq,
          updatedAtMs: nowMs
        });
      }
    }

    const next = {
      ...current,
      ticketSeq,
      activeTurns: nextActive,
      waiters: nextWaiters,
      updatedAt: new Date(nowMs).toISOString()
    };
    const readback = await writeReadback(next, storage);
    const snapshot = snapshotOf(readback, {
      capacity,
      configuredCapacity,
      reservedWorkerId,
      now: nowMs
    });
    return {
      scheduler: snapshot,
      runnableProcessIds: snapshot.runnableProcessIds
    };
  });
}
