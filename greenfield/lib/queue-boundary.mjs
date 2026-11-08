// v1.8.14 queue boundary without analysis.
//
// Operator request 2026-10-05: when a queue slot's quantum is complete (1/1,
// 15/15, ...) the next prompt goes to the next GFW in the queue, so analysing
// the answer (Nano observer + Hjalmar D2) to plan a follow-up prompt for this
// GFW adds nothing. The same holds when the EIC answer itself hands the slot
// back to the queue (YIELD_TO_QUEUE, PAUSE_PROCESS, BACKGROUND_SLEEP).
//
// Analysis still runs whenever it can change what happens next:
//  - no structured A2A control in the answer (the answer's own next step and
//    status are unknown);
//  - status other than CONTINUE (DONE, BLOCKED, ...) or a terminal request
//    (STOP_PROCESS, runtimeControl COMPLETE_MISSION);
//  - a NANO_TASK requested in nextSuggestedAction (an explicit AI request
//    whose result belongs to this GFW's next prompt);
//  - an operator instruction waiting for this GFW (checked by the caller);
//  - no other queue slot can take over (the slot continues, and its next
//    prompt needs the analysis; checked by the caller).
// Pure.

import { GREENFIELD_ACTIONS, GREENFIELD_STATES } from "./greenfield-control.mjs";
import { normalizeMissionQuantumInteractions } from "./mission-work-queue.mjs";
import { QUEUE_AFTER_RESPONSE, queueAfterResponseAction } from "./queue-control-policy.mjs";

export const QUEUE_BOUNDARY_SOURCE = "QUEUE_BOUNDARY_NO_ANALYSIS";

function upper(value, fallback = "") {
  return String(value ?? fallback).trim().toUpperCase() || fallback;
}

export function runtimeControlRequestsCompletion(request) {
  return Boolean(Array.isArray(request?.actions) &&
    request.actions.some((action) => upper(action?.op) === "COMPLETE_MISSION"));
}

export function queueBoundaryAnalysisDecision({
  queueManaged = false,
  controlValid = false,
  targetDisposition = "UNKNOWN",
  sessionAction = "KEEP",
  nanoTaskRequested = false,
  completionRequested = false,
  interactionCount = 0,
  maxInteractions = 1,
  pauseSeconds = null
} = {}) {
  const analyze = (code) => ({ action: "ANALYZE", code });
  const session = upper(sessionAction, "KEEP");
  if (queueManaged !== true) return analyze("NOT_QUEUE_MANAGED");
  if (controlValid !== true) return analyze("NO_STRUCTURED_CONTROL");
  if (upper(targetDisposition, "UNKNOWN") !== "CONTINUE") return analyze("TARGET_STATUS_NOT_CONTINUE");
  if (session === "STOP_PROCESS" || completionRequested === true) return analyze("TERMINAL_REQUESTED");
  if (nanoTaskRequested === true) return analyze("NANO_TASK_REQUESTED");
  const completed = Math.max(0, Number(interactionCount || 0)) + 1;
  const quantum = normalizeMissionQuantumInteractions(maxInteractions);
  const quantumReached = completed >= quantum;
  const queueAction = queueAfterResponseAction({
    queueManaged: true,
    queueQuantumReached: quantumReached,
    sessionAction: session,
    scheduleBlocked: false
  });
  if (queueAction !== QUEUE_AFTER_RESPONSE.PARK_AND_SWITCH) return analyze("NOT_A_QUEUE_BOUNDARY");
  // Same precedence as the park after analysis.
  const outcome = session === "BACKGROUND_SLEEP"
    ? "EIC_BACKGROUND_SLEEP"
    : session === "YIELD_TO_QUEUE"
      ? "EIC_YIELD_TO_QUEUE"
      : session === "PAUSE_PROCESS"
        ? "EIC_PAUSE_PARKED"
        : "QUANTUM_EXHAUSTED";
  const timed = session === "PAUSE_PROCESS" || session === "BACKGROUND_SLEEP";
  const seconds = Number(pauseSeconds);
  return {
    action: "SKIP",
    code: "QUEUE_BOUNDARY",
    outcome,
    quantumReached,
    completedInteractions: completed,
    maxInteractions: quantum,
    sessionAction: session,
    pauseSeconds: timed && Number.isFinite(seconds) && seconds > 0 ? seconds : null
  };
}

// What the parked slot carries instead of a Hjalmar verdict: the answer's own
// next step, clearly marked as not analysed.
export function queueBoundaryControl({ nextStep = "", fallbackObjective = "", targetDisposition = "CONTINUE", outcome = "" } = {}) {
  const effectiveNextPrompt = String(nextStep || "").trim() || String(fallbackObjective || "").trim();
  return {
    effectiveNextPrompt,
    greenfieldControl: {
      state: GREENFIELD_STATES.ACTIVE,
      action: GREENFIELD_ACTIONS.NEXT,
      reason: QUEUE_BOUNDARY_SOURCE,
      hardStop: false,
      effectiveDisposition: "CONTINUE",
      effectiveNextPrompt,
      controllerOverride: false
    },
    decision: {
      source: QUEUE_BOUNDARY_SOURCE,
      disposition: "CONTINUE",
      targetDisposition: upper(targetDisposition, "CONTINUE"),
      objectiveStatus: "PENDING",
      nanoTaskAssessment: "NOT_REQUESTED",
      progressEvidence: "",
      analysis: `Queue boundary (${outcome || "QUEUE_BOUNDARY"}): the next queue slot runs next, so this answer was not analysed; the slot resumes from the answer's own next step.`,
      nextPrompt: effectiveNextPrompt,
      materialAmbiguity: "NONE",
      humanAuthorityRequired: false,
      confidence: ""
    }
  };
}
