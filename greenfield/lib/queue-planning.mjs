import { text } from "./common.mjs";
import { trimResponseTrace } from "./response-observation.mjs";

const PRIORITY_DISPLAY_SV = Object.freeze({
  LOW: "Låg",
  NORMAL: "Normal",
  HIGH: "Hög",
  URGENT: "Akut"
});

export const GREENFIELD_PROCESS_STATUS_REQUEST = "FULL_NEXT_PROMPT";

function finiteNonNegative(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export function latestResponseRoundTripMs(sessionHealth) {
  const samples = Array.isArray(sessionHealth?.samples) ? sessionHealth.samples : [];
  const latest = samples.length ? samples[samples.length - 1] : null;
  return finiteNonNegative(latest?.totalMs);
}

export function queuePlanningFields(queueContext = {}) {
  const completedInteractions = Math.max(0, Math.floor(Number(queueContext.interactionCount || 0)));
  const maxInteractions = Math.max(1, Math.floor(Number(queueContext.maxInteractions || 1)));
  const interactionInQuantum = Math.min(maxInteractions, completedInteractions + 1);
  const remainingInteractionsIncludingCurrent = Math.max(0, maxInteractions - completedInteractions);
  const priority = String(queueContext.priority || "NORMAL").trim().toUpperCase() || "NORMAL";
  const priorityDisplay = PRIORITY_DISPLAY_SV[priority] || priority;
  const plural = "interaktioner";
  return {
    completedInteractions,
    interactionInQuantum,
    maxInteractions,
    remainingInteractionsIncludingCurrent,
    finalInteractionInQuantum: interactionInQuantum >= maxInteractions,
    operatorDisplay: `${priorityDisplay} · ${maxInteractions} ${plural}/kvant · ${completedInteractions}/${maxInteractions} slutförda i kvanten`,
    planningHint: `This is interaction ${interactionInQuantum} of ${maxInteractions} in the current queue-slot quantum. Plan a bounded slice that fits this interaction and preserve a restart-safe handoff before the quantum ends.`,
    responseRoundTripApproxMs: finiteNonNegative(queueContext.responseRoundTripApproxMs),
    loopRoundTripApproxMs: finiteNonNegative(queueContext.loopRoundTripApproxMs),
    activationCount: Math.max(0, Math.floor(Number(queueContext.activationCount || 0)))
  };
}

export function activatedQueueSlotTelemetry(item = {}, now = Date.now()) {
  const leftAtMs = Number(item.lastLeftAtMs) > 0 ? finiteNonNegative(item.lastLeftAtMs) : null;
  return {
    activationCount: Math.max(0, Math.floor(Number(item.activationCount || 0))) + 1,
    lastLoopRoundTripMs: leftAtMs === null ? null : Math.max(0, Math.round(Number(now) - leftAtMs))
  };
}

export function parkedQueueSlotTelemetry(item = {}, {
  now = Date.now(),
  responseRoundTripMs = null
} = {}) {
  return {
    lastLeftAtMs: Math.max(0, Math.round(Number(now))),
    lastSelfRoundTripMs: finiteNonNegative(responseRoundTripMs) ??
      finiteNonNegative(item.lastSelfRoundTripMs)
  };
}

export function applyQueueParkTransition(items, currentItem, {
  pauseUntilMs = 0,
  resumedQuantumProgress = 0,
  parkedSnapshot = null,
  resume = null,
  outcome = "MISSION_QUEUE_PARKED",
  summary = "",
  now = Date.now(),
  responseRoundTripMs = null
} = {}) {
  const rows = Array.isArray(items) ? items : [];
  const itemId = String(currentItem?.itemId || "");
  const savedMissionId = String(currentItem?.savedMissionId || "").trim();
  const pausing = Number(pauseUntilMs || 0) > 0;
  // v1.8.2: the parked snapshot keeps only the newest observation-trace entries.
  const snapshot = parkedSnapshot && Array.isArray(parkedSnapshot.responseObservationTrace)
    ? { ...parkedSnapshot, responseObservationTrace: trimResponseTrace(parkedSnapshot.responseObservationTrace) }
    : parkedSnapshot;
  return rows.map((candidate) => {
    const sameLogical = candidate?.itemId === itemId ||
      Boolean(savedMissionId && String(candidate?.savedMissionId || "").trim() === savedMissionId);
    if (!sameLogical) return candidate;
    const isCurrentSlot = candidate.itemId === itemId;
    const telemetry = isCurrentSlot
      ? parkedQueueSlotTelemetry(candidate, { now, responseRoundTripMs })
      : {};
    return {
      ...candidate,
      ...telemetry,
      status: pausing ? "PAUSED" : isCurrentSlot ? "READY" : candidate.status,
      readySinceMs: pausing ? Number(pauseUntilMs) : isCurrentSlot ? Number(now) : candidate.readySinceMs,
      pauseUntilMs: pausing ? Number(pauseUntilMs) : isCurrentSlot ? 0 : candidate.pauseUntilMs,
      quantumProgress: isCurrentSlot
        ? Math.max(0, Math.floor(Number(resumedQuantumProgress || 0)))
        : candidate.quantumProgress,
      processSnapshot: snapshot,
      resume,
      lastOutcome: isCurrentSlot ? text(outcome, 200) : candidate.lastOutcome,
      lastSummary: isCurrentSlot ? text(summary, 2000) : candidate.lastSummary,
      updatedAt: new Date(Number(now)).toISOString()
    };
  });
}

export function isSameLogicalQueueMission(candidate, item) {
  const itemId = String(item?.itemId || "");
  const savedMissionId = String(item?.savedMissionId || "").trim();
  return candidate?.itemId === itemId ||
    Boolean(savedMissionId && String(candidate?.savedMissionId || "").trim() === savedMissionId);
}

/**
 * Terminal retirement of one logical GFW. Every queue slot that is the same
 * slot or shares its non-empty savedMissionId moves to history with the
 * terminal status; slots of any other logical mission are untouched. Pure and
 * idempotent: a second application finds no remaining slots to retire.
 */
export function retireLogicalMissionSlots(queue, item, {
  queueStatus,
  completedAt = new Date().toISOString(),
  lastOutcome = "",
  lastSummary = "",
  lastError = null,
  maxHistory = 30
} = {}) {
  const items = Array.isArray(queue?.items) ? queue.items : [];
  const terminalSlots = items.filter((candidate) => isSameLogicalQueueMission(candidate, item));
  const finalizedSlots = terminalSlots.map((candidate) => ({
    ...candidate,
    status: queueStatus,
    completedAt,
    updatedAt: completedAt,
    processSnapshot: null,
    resume: null,
    quantumProgress: 0,
    blockedSinceMs: 0,
    blockedRetryAtMs: 0,
    lastOutcome,
    lastSummary: candidate.itemId === item?.itemId ? lastSummary : candidate.lastSummary,
    lastError: lastError ? JSON.parse(JSON.stringify(lastError)) : null
  }));
  return {
    queue: {
      ...queue,
      items: items.filter((candidate) => !isSameLogicalQueueMission(candidate, item)),
      history: [...(Array.isArray(queue?.history) ? queue.history : []), ...finalizedSlots].slice(-maxHistory)
    },
    finalizedSlots
  };
}
