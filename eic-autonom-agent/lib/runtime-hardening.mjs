import { deepClone, nowIso, sanitizeText, stableStringify } from "./common.mjs";
import { normalizeContinuity } from "./continuity.mjs";

const TERMINAL_RUN_STATES = new Set([
  "PROGRAM_DONE", "PROGRAM_BLOCKED", "STOPPED", "ERROR_TERMINAL"
]);

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function deterministicItemId(prefix, value) {
  const normalized = sanitizeText(value, 900);
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function deriveRunNextAction(run = {}) {
  return sanitizeText(
    run?.pendingObservation?.targetResult?.next ||
    run?.resumePlan?.nextAction ||
    run?.resumePlan?.requestedAction ||
    run?.destructiveness?.classificationInput?.requestedAction ||
    run?.mjolnar?.activeResponse?.next_action ||
    run?.nextAction ||
    "",
    2000
  );
}

export function deriveRunWorkUnit(run = {}) {
  return sanitizeText(
    run?.programDeltaGate?.focus?.boundedCurrentUnit ||
    run?.currentTurn?.turnId ||
    run?.activeWorkUnit ||
    run?.currentStep ||
    run?.workstreamId ||
    "",
    1200
  );
}

export function projectRunIntoContinuity(value, run = null, {
  targetProjectId = null,
  now = Date.now()
} = {}) {
  const continuity = normalizeContinuity(value);
  if (!run || typeof run !== "object") return continuity;

  const nextAction = deriveRunNextAction(run);
  const workUnit = deriveRunWorkUnit(run);
  const turnIndex = Math.max(
    Number(continuity.position?.turnIndex || 0),
    Number(run.turnIndex || 0)
  );
  const conversationKey = sanitizeText(
    run.conversationKey || continuity.scope?.conversationKey || continuity.position?.conversationKey,
    1200
  );
  const taskFingerprint = sanitizeText(
    run.taskFingerprint || run.activeTaskBinding?.taskFingerprint || continuity.position?.taskFingerprint,
    256
  );
  const activeBinding = run.activeTaskBinding ? deepClone(run.activeTaskBinding) : null;
  const resolvedTargetProjectId = positiveInteger(
    targetProjectId || run.targetProjectId || run.activeTaskProjectId
  );

  continuity.scope = {
    ...(continuity.scope || {}),
    kind: "WINDOW_RUN",
    windowId: Number.isInteger(Number(run.windowId))
      ? Number(run.windowId)
      : continuity.scope?.windowId ?? null,
    runId: sanitizeText(run.runId || continuity.scope?.runId, 180),
    conversationKey
  };
  continuity.position = {
    ...(continuity.position || {}),
    phase: TERMINAL_RUN_STATES.has(String(run.state || ""))
      ? String(run.state || "").toLowerCase()
      : workUnit || turnIndex > 0
        ? "active"
        : continuity.position?.phase || "initial",
    workUnit: workUnit || continuity.position?.workUnit || "",
    workUnitId: sanitizeText(run.currentTurn?.turnId || continuity.position?.workUnitId, 240),
    workUnitSource: workUnit ? "runtime-projection" : continuity.position?.workUnitSource || "",
    updatedAt: nowIso(now),
    turnIndex,
    conversationKey,
    taskFingerprint
  };
  if (activeBinding) continuity.activeTaskBinding = activeBinding;

  continuity.targetProject = {
    schema: "eic.autonom.target-project-binding.v1",
    projectId: resolvedTargetProjectId,
    source: sanitizeText(
      run.targetProjectBindingSource ||
      (resolvedTargetProjectId ? "RUN_OR_OPERATOR_CONFIG" : "UNRESOLVED"),
      120
    ),
    mismatch: Boolean(
      resolvedTargetProjectId &&
      activeBinding?.projectId &&
      Number(activeBinding.projectId) !== resolvedTargetProjectId
    ),
    controlProjectId: positiveInteger(activeBinding?.projectId),
    updatedAt: nowIso(now)
  };

  const progressDelta = Math.max(0, Number(run?.programDeltaGate?.directProgramDelta || 0));
  continuity.transition = {
    ...(continuity.transition || {}),
    lastProgressDelta: progressDelta,
    nextDirection: nextAction || continuity.transition?.nextDirection || "",
    updatedAt: nowIso(now)
  };

  if (nextAction) {
    const id = deterministicItemId("runtime-direction", `${run.runId}|${run.currentTurn?.turnId}|${nextAction}`);
    const existing = Array.isArray(continuity.nextDirections) ? continuity.nextDirections : [];
    const item = {
      id,
      turn: turnIndex,
      at: nowIso(now),
      text: nextAction,
      derivedFrom: [sanitizeText(run.currentTurn?.turnId || run.runId, 240)].filter(Boolean)
    };
    continuity.nextDirections = [
      ...existing.filter((entry) => entry?.id !== id),
      item
    ].slice(-12);
  }

  if (!continuity.intent?.text && run?.programDeltaGate?.focus?.primaryProgramGoal) {
    continuity.intent = {
      text: sanitizeText(run.programDeltaGate.focus.primaryProgramGoal, 6000),
      setBy: "runtime-owner-projection",
      at: nowIso(now)
    };
  }

  if (run.currentTurn?.effectState === "ACKED" && run.currentTurn?.turnId) {
    const factId = deterministicItemId("runtime-fact", `${run.runId}|${run.currentTurn.turnId}|ACKED`);
    const fact = {
      id: factId,
      turn: turnIndex,
      at: nowIso(now),
      claim: `Turn ${sanitizeText(run.currentTurn.turnId, 240)} har owner-readback ACKED.`,
      status: "VERIFIED",
      provenance: "LOCAL_EFFECT_JOURNAL"
    };
    const facts = Array.isArray(continuity.verifiedFacts) ? continuity.verifiedFacts : [];
    continuity.verifiedFacts = [...facts.filter((entry) => entry?.id !== factId), fact].slice(-40);
  }

  continuity.updatedAt = nowIso(now);
  return continuity;
}

export function continuitySemanticValue(value) {
  const normalized = normalizeContinuity(value);
  delete normalized.integrity;
  delete normalized.updatedAt;
  if (normalized.position) delete normalized.position.updatedAt;
  if (normalized.transition) delete normalized.transition.updatedAt;
  if (normalized.targetProject) delete normalized.targetProject.updatedAt;
  for (const key of [
    "verifiedFacts", "constraints", "targetClaims", "inferences", "decisions",
    "attempts", "failures", "blockers", "nextDirections", "evidenceRequirements"
  ]) {
    normalized[key] = (normalized[key] || []).map((item) => {
      const copy = { ...item };
      delete copy.at;
      return copy;
    });
  }
  return normalized;
}

export function continuitySemanticallyEqual(left, right) {
  return stableStringify(continuitySemanticValue(left)) ===
    stableStringify(continuitySemanticValue(right));
}

export function shouldDeferSessionCapture({
  automatic = false,
  run = null,
  nanoHostTelemetry = null
} = {}) {
  const activeRequest = Boolean(run?.pendingNanoRequest);
  const assessing = String(run?.state || "") === "ASSESSING";
  const hostBusy = nanoHostTelemetry?.busy === true;
  if (activeRequest || assessing || hostBusy) {
    return {
      defer: true,
      reason: automatic ? "MISSION_NANO_HAS_PRIORITY" : "NANO_ACTIVE_CAPTURE_REJECTED",
      retryable: automatic
    };
  }
  return { defer: false, reason: "CAPTURE_ALLOWED", retryable: false };
}

export function normalizeNanoHostTelemetry(previous = {}, payload = {}, {
  now = Date.now()
} = {}) {
  const has = (key) => Object.prototype.hasOwnProperty.call(payload || {}, key);
  const numberOr = (key, fallback = null) => {
    if (!has(key)) return fallback;
    const value = Number(payload[key]);
    return Number.isFinite(value) ? value : fallback;
  };
  const boolOr = (key, fallback = false) => has(key) ? Boolean(payload[key]) : Boolean(fallback);
  const textOr = (key, fallback = "", max = 160) =>
    has(key) ? sanitizeText(payload[key], max) : sanitizeText(fallback, max);

  const cloneUsed = boolOr("cloneUsed", previous.cloneUsed);
  const cloneSupported = boolOr("cloneSupported", previous.cloneSupported) || cloneUsed;
  return {
    ...deepClone(previous || {}),
    schema: "eic.autonom.nano-host-telemetry.v4",
    hostId: textOr("hostId", previous.hostId),
    modelKind: textOr("modelKind", previous.modelKind, 120),
    providerContract: textOr("providerContract", previous.providerContract),
    providerPolicy: textOr("providerPolicy", previous.providerPolicy),
    status: textOr("status", previous.status || "unknown", 80) || "unknown",
    availability: textOr("availability", previous.availability || "unknown", 80) || "unknown",
    progress: has("progress") ? Math.min(1, Math.max(0, Number(payload.progress || 0))) : previous.progress ?? null,
    busy: boolOr("busy", previous.busy),
    stale: boolOr("stale", previous.stale),
    staleReason: textOr("staleReason", previous.staleReason),
    staleDetail: textOr("staleDetail", previous.staleDetail, 600),
    contextUsage: numberOr("contextUsage", previous.contextUsage ?? null),
    contextWindow: numberOr("contextWindow", previous.contextWindow ?? null),
    cloneSupported,
    cloneUsed,
    taskAttempt: Math.max(0, numberOr("taskAttempt", previous.taskAttempt || 0) || 0),
    reasonCode: textOr("reasonCode", previous.reasonCode, 120),
    event: textOr("event", previous.event, 120),
    updatedAt: nowIso(now)
  };
}


function normalizedAction(value) {
  return sanitizeText(value, 2400)
    .toLocaleLowerCase("sv")
    .replace(/[.,;:!?()[\]{}"'`´“”‘’]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function evaluateNanoDiscrimination({
  targetNext = "",
  nanoNext = "",
  reason = "",
  alternatives = []
} = {}) {
  const target = sanitizeText(targetNext, 2400);
  const selected = sanitizeText(nanoNext, 2400);
  const normalizedTarget = normalizedAction(target);
  const normalizedSelected = normalizedAction(selected);
  const distinctAlternatives = [...new Set(
    (Array.isArray(alternatives) ? alternatives : [])
      .map((item) => sanitizeText(item, 1200))
      .filter((item) => {
        const normalized = normalizedAction(item);
        return normalized &&
          normalized !== normalizedSelected &&
          normalized !== normalizedTarget;
      })
  )].slice(0, 4);
  const verdict = !normalizedTarget
    ? "NO_TARGET_NEXT"
    : normalizedTarget === normalizedSelected
      ? "TARGET_NEXT_ACCEPTED"
      : "TARGET_NEXT_CHANGED";
  const challengeDemonstrated = verdict === "TARGET_NEXT_CHANGED" ||
    (verdict === "TARGET_NEXT_ACCEPTED" &&
      distinctAlternatives.length > 0 &&
      sanitizeText(reason, 1200).length >= 24);
  return {
    schema: "eic.autonom.nano-discrimination.v1",
    verdict,
    challengeDemonstrated,
    independentPlanningClaimed: false,
    targetNext: target,
    nanoNext: selected,
    reason: sanitizeText(reason, 1200),
    alternatives: distinctAlternatives
  };
}
