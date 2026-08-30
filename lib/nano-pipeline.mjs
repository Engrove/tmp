import {
  deepClone,
  nowIso,
  sanitizeText,
  stableStringify
} from "./common.mjs";
import { NANO_WALL_TIMEOUT_MS } from "./contracts.mjs";
import {
  continuityIsGrounded,
  validateDecisionGrounding
} from "./decision-grounding.mjs";
import { boundProjectionToChars } from "./continuity.mjs";
import {
  allocateNanoSectionBudget,
  NANO_BUDGET_DEFAULTS
} from "./nano-input-budget.mjs";
import {
  redactSensitiveTransport
} from "./delivery-kernel.mjs";
import {
  MAIN_TASK_BASELINE_REQUEST_PROMPT,
  baselineRoutingSummary,
  validateTrackControl
} from "./main-task-guard.mjs";
import {
  compactMicroActionCatalog,
  shouldSuppressRepeatedLocalStateRead
} from "./execution-routing.mjs";

export const NANO_REQUEST_STATUS = Object.freeze({
  PENDING: "PENDING",
  DETERMINISTIC_PENDING: "DETERMINISTIC_PENDING",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED"
});

export const NANO_REQUEST_MODE = Object.freeze({
  CONTINUATION: "CONTINUATION_ANALYSIS",
  TAKEOVER_BOOTSTRAP: "TAKEOVER_BOOTSTRAP",
  OPERATOR_RESUME: "OPERATOR_RESUME"
});

export const NANO_ANALYSIS_MODES = Object.freeze({
  TAKEOVER_BOOTSTRAP: "TAKEOVER_BOOTSTRAP",
  CONTINUATION_ANALYSIS: "CONTINUATION_ANALYSIS",
  OPERATOR_RESUME: "OPERATOR_RESUME"
});

export const NANO_DECISION_SOURCE = Object.freeze({
  NANO: "NANO",
  DETERMINISTIC_FALLBACK: "DETERMINISTIC_FALLBACK",
  DETERMINISTIC_PROTOCOL: "DETERMINISTIC_PROTOCOL",
  DETERMINISTIC_RECOVERY: "DETERMINISTIC_RECOVERY"
});

export const NANO_CLAIM_LEASE_STATE = Object.freeze({
  ACTIVE: "ACTIVE",
  EXPIRED: "EXPIRED",
  INVALID: "INVALID"
});

const DEFAULT_CLAIM_LEASE_MS = NANO_WALL_TIMEOUT_MS;

const ARCHAEOLOGY_NANO_RUNTIME_RULES = Object.freeze([
  "ARCHAEOLOGY_LONG is exclusively for analysis, reverse engineering and research.",
  "Never propose implementation, patch, commit, merge, release, deploy, permission, schema, data or target mutation as research progress.",
  "Advance exactly one research unit through observation, hypothesis, falsification, contradiction or owner-readable evidence.",
  "Use Workspace actively as a capability surface: name the relevant capability family and require EIC AI to discover the exact current opcode with workspace.help, workspace.capabilities.resolve or workspace.op.describe before use.",
  "Never infer Workspace availability or success from this prompt; EIC AI must probe the exact operation and preserve owner-route readback.",
  "USER_PAUSE remains a strict level-10 operator decision and may not be auto-resolved."
]);

function archaeologyNanoRuntimeRules(run) {
  if (run?.mode !== "ARCHAEOLOGY_LONG") return [];
  return [...ARCHAEOLOGY_NANO_RUNTIME_RULES];
}

export function hasGroundedContext(projection = {}) {
  return continuityIsGrounded(projection);
}

function activeClaimCheck(request, claimId, now) {
  if (!request || request.status !== NANO_REQUEST_STATUS.RUNNING) {
    return { ok: false, reason: "NOT_RUNNING" };
  }
  if (!request.claimId || !claimId) {
    return { ok: false, reason: "CLAIM_ID_MISSING" };
  }
  if (request.claimId !== claimId) {
    return { ok: false, reason: "CLAIM_ID_MISMATCH" };
  }
  if (request.mode !== NANO_REQUEST_MODE.TAKEOVER_BOOTSTRAP) {
    const deadline = Date.parse(request.deadlineAt || "");
    if (Number.isFinite(deadline) && now >= deadline) {
      return { ok: false, reason: "REQUEST_DEADLINE_EXPIRED" };
    }
  }
  const leaseUntil = Date.parse(request.claimLeaseUntil || "");
  if (!Number.isFinite(leaseUntil) || now >= leaseUntil) {
    return { ok: false, reason: "CLAIM_LEASE_EXPIRED" };
  }
  return { ok: true };
}

export function validateActiveNanoClaim(request, {
  claimId,
  now = Date.now()
} = {}) {
  return activeClaimCheck(request, claimId, now);
}

export function nanoClaimLeaseState(request, {
  now = Date.now()
} = {}) {
  if (!request || request.status !== NANO_REQUEST_STATUS.RUNNING || !request.claimId) {
    return NANO_CLAIM_LEASE_STATE.INVALID;
  }
  if (request.mode !== NANO_REQUEST_MODE.TAKEOVER_BOOTSTRAP) {
    const deadline = Date.parse(request.deadlineAt || "");
    if (Number.isFinite(deadline) && now >= deadline) return NANO_CLAIM_LEASE_STATE.EXPIRED;
  }
  const leaseUntil = Date.parse(request.claimLeaseUntil || "");
  if (!Number.isFinite(leaseUntil)) {
    return NANO_CLAIM_LEASE_STATE.INVALID;
  }
  if (now >= leaseUntil) return NANO_CLAIM_LEASE_STATE.EXPIRED;
  // Heartbeat age is observability only. Correctness is owned by the renewable
  // claim lease so a quiet/slow local model is not interrupted after 45 seconds.
  return NANO_CLAIM_LEASE_STATE.ACTIVE;
}

export function nanoTerminalDeliveryAlreadyFinalized(runValue, payload = {}) {
  const requestId = sanitizeText(payload?.requestId, 180);
  if (!requestId) return false;
  const claimId = sanitizeText(payload?.claimId, 240);
  const inputDigest = sanitizeText(payload?.inputDigest, 128).toLowerCase();
  const traces = [
    runValue?.lastNanoAttemptTrace,
    runValue?.lastDeterministicRecoveryTrace
  ];
  return traces.some((trace) => {
    if (!trace || sanitizeText(trace.requestId, 180) !== requestId) return false;
    if (![NANO_REQUEST_STATUS.COMPLETED, NANO_REQUEST_STATUS.FAILED]
      .includes(String(trace.status || ""))) return false;
    const traceClaimId = sanitizeText(trace.claimId, 240);
    if (claimId && traceClaimId && claimId !== traceClaimId) return false;
    const traceInputDigest = sanitizeText(trace.inputDigest, 128).toLowerCase();
    if (inputDigest && traceInputDigest && inputDigest !== traceInputDigest) return false;
    return true;
  });
}

export function finalizeNanoTerminalOwnershipState(runValue, {
  preserveObservation = false,
  retireWaitingObservation = false,
  runtimeDecisionStatus = "",
  nanoTelemetryStatus = ""
} = {}) {
  const run = deepClone(runValue || {});
  run.pendingNanoRequest = null;

  // v0.12.5 — terminal Nano ownership is retired atomically. `decisionOwner`
  // describes the live owner, not provenance; historical ownership remains in
  // the recorded decision trace. A terminal failure must not leave the same
  // observation simultaneously eligible as pending/waiting input.
  run.decisionOwner = "";
  if (!preserveObservation) run.pendingObservation = null;
  if (retireWaitingObservation) run.waitingObservation = null;

  if (runtimeDecisionStatus) run.runtimeDecisionStatus = sanitizeText(runtimeDecisionStatus, 160);
  run.nanoTelemetry ||= {};
  if (nanoTelemetryStatus) {
    run.nanoTelemetry.lastStatus = sanitizeText(nanoTelemetryStatus, 160);
  }
  return run;
}

function extendClaimLease(request, now, leaseMs = DEFAULT_CLAIM_LEASE_MS) {
  let leaseUntil = now + Math.max(30_000, Number(leaseMs || DEFAULT_CLAIM_LEASE_MS));
  if (request?.mode !== NANO_REQUEST_MODE.TAKEOVER_BOOTSTRAP) {
    const deadline = Date.parse(request?.deadlineAt || "");
    if (Number.isFinite(deadline)) leaseUntil = Math.min(leaseUntil, deadline);
  }
  request.claimLeaseUntil = nowIso(leaseUntil);
}

export function compactContextText(value, maxLength = 4000, {
  label = "CONTEXT",
  headRatio = 0.42
} = {}) {
  const source = String(value ?? "").replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim();
  const requested = Number(maxLength);
  const limit = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 4000;
  if (limit === 0) {
    return {
      text: "",
      originalLength: source.length,
      strategy: source ? `DROPPED_FOR_BUDGET:${label}` : "FULL"
    };
  }
  if (source.length <= limit) {
    return { text: source, originalLength: source.length, strategy: "FULL" };
  }
  const marker = "\n\n[… middle omitted by deterministic head-tail compaction …]\n\n";
  if (limit <= marker.length) {
    return {
      text: source.slice(0, limit),
      originalLength: source.length,
      strategy: `HEAD_ONLY:${label}`
    };
  }
  const available = limit - marker.length;
  const ratio = Math.min(0.75, Math.max(0.2, Number(headRatio) || 0.42));
  const head = Math.floor(available * ratio);
  const tail = available - head;
  return {
    text: `${source.slice(0, head)}${marker}${source.slice(-tail)}`,
    originalLength: source.length,
    strategy: `HEAD_TAIL:${label}:${ratio.toFixed(2)}`
  };
}

export function classifyNanoAnalysisMode({
  run,
  continuityProjection,
  observation
} = {}) {
  if (run?.pendingNanoRequest?.operatorResumeDecision ||
      observation?.targetResult?.reason === "OPERATOR_RESUME") {
    return NANO_ANALYSIS_MODES.OPERATOR_RESUME;
  }
  const hasIntent = Boolean(sanitizeText(continuityProjection?.intent, 6000));
  const hasPosition = Boolean(sanitizeText(continuityProjection?.position?.workUnit, 2400));
  const hasContext = Boolean(
    (continuityProjection?.verifiedFacts || []).length ||
    (continuityProjection?.targetClaims || []).length ||
    (continuityProjection?.inferences || []).length
  );
  if (run?.takeoverBootstrapRequired || (!hasIntent && !hasPosition && !hasContext)) {
    return NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP;
  }
  return NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS;
}

/**
 * Deterministically extracts load-bearing text anchors from the observation the local
 * controller actually read. These are *not* model output and never become verified
 * facts: they are literal fragments of the untrusted target surface, which is exactly
 * what `contextEvidence` is defined to be.
 *
 * v0.6.9 relied entirely on Gemini Nano to restate the observation into
 * `contextEvidence`/`targetClaims`. The response constraint permitted empty arrays, so
 * the model satisfied the schema and then failed the semantic gate with
 * TAKEOVER_CONTEXT_EMPTY on every single takeover attempt (field incident 2026-08-02,
 * both observation generations). Deriving the anchors locally removes the model from
 * the critical path for a fact the controller already possesses.
 */
export function deriveObservationAnchors(observation = {}, {
  max = 6,
  maxLength = 400
} = {}) {
  const anchors = [];
  const add = (label, value) => {
    const text = sanitizeText(value, maxLength);
    if (!text) return;
    const candidate = `${label}: ${text}`;
    if (!anchors.includes(candidate)) anchors.push(candidate);
  };

  // v0.9.3 never copies free-form target responses or conversation excerpts into
  // the next Nano prompt. Only compact structured observation identity/delta is
  // carried; target text remains untrusted and must be re-read if needed.
  add("RESPONSE_HASH", observation?.responseHash);
  add("TARGET_STATUS", observation?.targetResult?.status);
  add("TARGET_REASON", observation?.targetResult?.reason);
  add("TARGET_TURN", observation?.targetResult?.turnId);
  for (const locator of Array.isArray(observation?.ownerLocators) ? observation.ownerLocators : []) {
    add("OWNER_LOCATOR", locator);
    if (anchors.length >= max) break;
  }
  return anchors.slice(0, max);
}

/**
 * Local, deterministic grounding repair. It only ever fills context that the
 * controller observed itself; intent, work unit and the requested action stay owned by
 * Nano, so a generic or ungrounded target prompt is still impossible.
 */
export function groundDecisionFromObservation(decisionValue = {}, {
  observation = {},
  analysisMode = NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS,
  max = 6
} = {}) {
  const decision = { ...decisionValue };
  const existing = [
    ...(Array.isArray(decision.contextEvidence) ? decision.contextEvidence : []),
    ...(Array.isArray(decision.evidenceAnchors) ? decision.evidenceAnchors : []),
    ...(Array.isArray(decision.targetClaims) ? decision.targetClaims : []),
    ...(Array.isArray(decision.inferences) ? decision.inferences : [])
  ].map((item) => sanitizeText(typeof item === "string" ? item : item?.text || item?.claim, 1600)).filter(Boolean);
  if (existing.length) return { decision, applied: false, anchors: [], reason: "CONTEXT_ALREADY_PRESENT" };

  const anchors = deriveObservationAnchors(observation, { max });
  if (!anchors.length) {
    return { decision, applied: false, anchors: [], reason: "OBSERVATION_HAS_NO_ANCHORS" };
  }
  decision.contextEvidence = anchors;
  decision.evidenceAnchors = anchors;
  decision.targetClaims = anchors.map((anchor) => `Målsessionen visade: ${anchor}`);
  decision.localGroundingRepair = {
    code: "OBSERVATION_ANCHORS",
    analysisMode,
    anchorCount: anchors.length
  };
  return { decision, applied: true, anchors, reason: "OBSERVATION_ANCHORS" };
}

export function validateNanoDecisionGrounding(decision = {}, {
  analysisMode,
  continuityProjection = {},
  observation = {}
} = {}) {
  // v0.12.6: ordinary Nano v4 output is advice. It must not be forced through
  // the legacy target-prompt authoring contract, because local/wait advice does
  // not itself author a target effect. Runtime binding in background.js owns
  // action membership and actor/effect semantics.
  if (decision?.nanoAdvisory?.schema === "eic.nano.advisory.v4") {
    const errors = [];
    const actionId = sanitizeText(decision?.microActionId, 120).toUpperCase();
    const requestedAction = sanitizeText(decision?.requestedAction, 5000);
    const reason = sanitizeText(decision?.reason, 2000);
    if (!actionId) errors.push("ADVISORY_ACTION_ID_EMPTY");
    if (!requestedAction) errors.push("ADVISORY_PROPOSED_ACTION_EMPTY");
    if (!reason) errors.push("ADVISORY_RATIONALE_EMPTY");
    return {
      valid: errors.length === 0,
      errors,
      action: "CONTINUE",
      authorsTargetPrompt: false,
      taskIntent: requestedAction,
      workUnit: requestedAction,
      requestedAction,
      groundedContextCount: 0,
      advisory: true
    };
  }

  const normalized = {
    ...decision,
    taskIntent: decision.taskIntent || decision.intent,
    contextEvidence: decision.contextEvidence || decision.evidenceAnchors || []
  };
  const base = validateDecisionGrounding(normalized, continuityProjection, {
    takeover: analysisMode === NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP
  });
  const errors = [...base.errors];

  if (analysisMode === NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP) {
    // Only a prompt-authoring action needs a non-empty observation to be grounded in.
    // A PAUSE that reports a missing Nano host is legitimate with or without one.
    if (base.authorsTargetPrompt &&
        !sanitizeText(observation?.responseText, 2000) &&
        !sanitizeText(observation?.conversationExcerpt, 2000)) {
      errors.push("TAKEOVER_OBSERVATION_EMPTY");
    }
    if (String(decision.analysisMode || analysisMode) !== NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP) {
      errors.push("TAKEOVER_MODE_MISMATCH");
    }
  }
  const baselinePresent = Boolean(continuityProjection?.mainTaskBaseline);
  if (decision?.trackControl) {
    const trackValidation = validateTrackControl(decision.trackControl, { baselinePresent });
    errors.push(...trackValidation.errors);
  }

  return {
    ...base,
    valid: errors.length === 0,
    errors: [...new Set(errors)]
  };
}

function prepareNanoProjection(value = {}) {
  const source = deepClone(value || {});
  const antiLoop = source.antiLoop || {};
  const position = source.position || {};
  const concise = {
    activeTaskBinding: source.activeTaskBinding ? deepClone(source.activeTaskBinding) : null,
    mainTaskBaseline: baselineRoutingSummary(source.mainTaskBaseline),
    trackControl: source.trackControl ? deepClone(source.trackControl) : null,
    intent: sanitizeText(source.intent?.text || source.intent, 2400),
    position: {
      workUnit: sanitizeText(position.workUnit, 1600),
      phase: sanitizeText(position.phase, 120),
      turnIndex: Number(position.turnIndex || 0),
      workUnitSource: sanitizeText(position.workUnitSource, 160)
    },
    verifiedFacts: Array.isArray(source.verifiedFacts) ? source.verifiedFacts : [],
    constraints: Array.isArray(source.constraints) ? source.constraints : [],
    targetClaims: Array.isArray(source.targetClaims) ? source.targetClaims : [],
    inferences: Array.isArray(source.inferences) ? source.inferences : [],
    blockers: (Array.isArray(source.blockers) ? source.blockers : []).map((item) => ({
      statement: sanitizeText(item?.statement || item?.text || item, 900),
      unlockedBy: sanitizeText(item?.unlockedBy, 500)
    })).filter((item) => item.statement),
    recentAttempts: Array.isArray(source.recentAttempts) ? source.recentAttempts : [],
    nextDirections: Array.isArray(source.nextDirections) ? source.nextDirections : [],
    stagnationCycles: Math.max(0, Number(antiLoop.stagnationCycles || source.stagnationCycles || 0))
  };
  return concise;
}

function compactTargetResult(value = {}) {
  return {
    valid: Boolean(value?.valid),
    reason: sanitizeText(value?.reason, 120),
    status: sanitizeText(value?.status, 40),
    next: compactContextText(value?.next, 480, { label: "TARGET NEXT" }).text,
    nextActor: sanitizeText(value?.nextActor, 80),
    completionState: sanitizeText(value?.completionState, 80),
    completionEvidence: compactContextText(value?.completionEvidence, 480, {
      label: "TARGET COMPLETION EVIDENCE"
    }).text,
    fullStopReason: sanitizeText(value?.fullStopReason, 40),
    turnId: sanitizeText(value?.turnId, 180)
  };
}

function compactRunEnvelope(run, request, observation, analysisMode) {
  return {
    runId: sanitizeText(run?.runId, 180),
    mode: sanitizeText(run?.mode, 80),
    state: sanitizeText(run?.state, 80),
    turnIndex: Number(run?.turnIndex || 0),
    checkpointIndex: Number(run?.checkpointIndex || 0),
    maxAutonomousMode: Boolean(run?.maxAutonomousMode),
    currentTurnId: sanitizeText(run?.currentTurn?.turnId, 180),
    currentTurnKind: sanitizeText(run?.currentTurn?.kind, 120),
    requestId: sanitizeText(request?.requestId, 180),
    analysisMode,
    repairAttempt: Number(request?.repairAttempt || 0),
    operatorResumeDecision: request?.operatorResumeDecision || null,
    localExecutionReceipt: run?.localExecutionReceipt
      ? {
          actionId: sanitizeText(run.localExecutionReceipt.actionId, 120),
          sourceTurnKind: sanitizeText(run.localExecutionReceipt.sourceTurnKind, 120),
          at: sanitizeText(run.localExecutionReceipt.at, 80),
          rearmAllowed: run.localExecutionReceipt.rearmAllowed === true,
          rearmReason: sanitizeText(run.localExecutionReceipt.rearmReason, 120),
          materialStateDigest: sanitizeText(run.localExecutionReceipt.materialStateDigest, 128)
        }
      : null
  };
}

/**
 * Budget-aware prompt assembly.
 *
 * @returns {{prompt:string, budget:object}} the prompt plus the proof of which
 * sections were compacted, so telemetry can show that the input was bounded
 * rather than silently rejected by the model host.
 */
export function buildNanoDecisionPromptDetailed({
  run,
  request,
  observation,
  config,
  continuityProjection,
  repairErrors = [],
  maxPromptChars = 0
} = {}) {
  const analysisMode = request?.mode || classifyNanoAnalysisMode({
    run,
    continuityProjection,
    observation
  });
  const projection = prepareNanoProjection(continuityProjection || {});
  const anchors = deriveObservationAnchors(observation, { max: 6, maxLength: 360 });
  const mandateVersion = sanitizeText(
    run?.activeTaskBinding?.mandateVersion || config?.targetMandateVersion,
    160
  );
  const mandateSha = sanitizeText(
    run?.activeTaskBinding?.mandateSha256 ||
      config?.mandateRegistry?.entries?.[`TARGET:${mandateVersion}`]?.sha256,
    96
  );
  const ownerEvidence = (projection.verifiedFacts || []).map((item) =>
    sanitizeText(item?.provenance || item?.locator || item?.claim || item?.text || item, 600)
  ).filter(Boolean);
  const blockers = (projection.blockers || []).map((item) =>
    sanitizeText(item?.statement || item?.text || item, 600)
  ).filter(Boolean);
  const runEnvelope = redactSensitiveTransport(
    compactRunEnvelope(run, request, observation, analysisMode)
  ).value;
  const suppressLocalStateRead = shouldSuppressRepeatedLocalStateRead(run);
  const availableActions = compactMicroActionCatalog({
    targetResult: observation?.targetResult || {},
    ownerRoute: "",
    sessionInitState: run?.sessionContextInit?.state || "",
    hasBoundObservation: Boolean(observation),
    suppressLocalStateRead
  });
  const mission = projection.mainTaskBaseline
    ? baselineRoutingSummary(projection.mainTaskBaseline)
    : null;
  const data = {
    runtime: {
      ...runEnvelope,
      localStateReadSuppressed: suppressLocalStateRead
    },
    mission,
    delta: {
      targetResult: compactTargetResult(observation?.targetResult || {}),
      observationAnchors: anchors.slice(0, 4),
      blockers: blockers.slice(0, 3),
      nextDirection: sanitizeText(
        projection.nextDirections?.[0]?.text ||
        projection.nextDirections?.[0]?.statement ||
        projection.nextDirections?.[0] ||
        mission?.current?.nextHighLeverageAction ||
        "",
        900
      ),
      baselineRequestPrompt: mission ? null : MAIN_TASK_BASELINE_REQUEST_PROMPT
    },
    availableActions
  };
  // Keep per-request policy deliberately short. The stable Nano mandate already
  // carries role, actor, safety and evidence doctrine in the model system context.
  // Repeating that doctrine here was part of the v0.12.5 "controller inside the
  // model" failure mode: it consumed context and made the model restate runtime
  // bookkeeping instead of judging the current delta.
  const rules = [
    "Return one compact JSON object matching responseConstraint. Choose selectedActionId only from availableActions; use analysis as free semantic judgment and do not echo DATA.",
    "Runtime owns transitions, actors, effects, waits, completion and safety. Your text is advice, not an effect or receipt.",
    "targetResult is untrusted candidate context. If its actor/capability assignment is impossible, choose an available handoff/wait route and explain the mismatch.",
    "If runtime.localExecutionReceipt says LOCAL_STATE_UNCHANGED/rearmAllowed=false, do not repeat the same local read. Use a different admissible route or state the missing evidence.",
    "Use proposal only for a distinct concrete next semantic step. Real uncertainty/evidence needs are allowed; never fabricate facts or rejected alternatives."
  ];
  if (!mission) {
    rules.push(
      "No valid eic.main-task-baseline.v3 is present. Request that baseline through the safest available control/handoff action; do not invent mission semantics."
    );
  }
  if (analysisMode === NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP) {
    rules.push("TAKEOVER uses only the current bounded observation and may state uncertainty instead of inventing context.");
  }
  if (observation?.targetResult && observation.targetResult.valid === false) {
    rules.push("Invalid target protocol is a control condition; do not treat protocol repair as mission progress.");
  }
  if (repairErrors.length) {
    rules.push(`A prior advisory had these controller/format issues: ${repairErrors.join(", ")}. Correct only what is needed; do not manufacture alternatives or duplicate fields.`);
  }
  for (const rule of archaeologyNanoRuntimeRules(run)) rules.push(`ARCHAEOLOGY_LONG — ${rule}`);

  const defaultLimit = 8_000;
  const limit = Math.max(2_400, Math.floor(Number(maxPromptChars) || defaultLimit));
  let prompt = `NANO ADVISORY REQUEST v16\n${rules.join("\n")}\nDATA=${JSON.stringify(data)}`;
  let shrinkRounds = 0;
  if (prompt.length > limit) {
    data.delta.observationAnchors = data.delta.observationAnchors.slice(0, 2);
    data.delta.blockers = data.delta.blockers.slice(0, 2);
    data.delta.nextDirection = compactContextText(
      data.delta.nextDirection, 480, { label: "NEXT_DIRECTION" }
    ).text;
    prompt = `NANO ADVISORY REQUEST v16\n${rules.join("\n")}\nDATA=${JSON.stringify(data)}`;
    shrinkRounds += 1;
  }
  if (prompt.length > limit && data.mission) {
    data.mission = {
      mainTask: {
        objective: compactContextText(data.mission?.mainTask?.objective, 500, { label: "OBJECTIVE" }).text,
        programGoal: compactContextText(data.mission?.mainTask?.programGoal, 500, { label: "PROGRAM_GOAL" }).text
      },
      current: {
        boundedWorkUnit: compactContextText(data.mission?.current?.boundedWorkUnit, 500, { label: "WORK_UNIT" }).text,
        nextHighLeverageAction: compactContextText(data.mission?.current?.nextHighLeverageAction, 500, { label: "NEXT" }).text
      },
      blockers: Array.isArray(data.mission?.blockers) ? data.mission.blockers.slice(0, 2) : []
    };
    prompt = `NANO ADVISORY REQUEST v16\n${rules.join("\n")}\nDATA=${JSON.stringify(data)}`;
    shrinkRounds += 1;
  }
  if (prompt.length > limit) {
    // Keep the JSON body complete. Shrink natural-language rules rather than
    // slicing the final prompt mid-JSON, which previously could make the input
    // itself structurally ambiguous.
    const essentialRules = rules.slice(0, 8);
    prompt = `NANO ADVISORY REQUEST v16\n${essentialRules.join("\n")}\nDATA=${JSON.stringify(data)}`;
    shrinkRounds += 1;
  }
  if (prompt.length > limit) {
    data.delta.observationAnchors = [];
    data.delta.blockers = [];
    prompt = `NANO ADVISORY REQUEST v16\n${rules.slice(0, 5).join("\n")}\nDATA=${JSON.stringify(data)}`;
    shrinkRounds += 1;
  }
  if (prompt.length > limit) {
    // Hard structured compaction. Never slice the final prompt: a complete small
    // JSON object is more useful than a larger syntactically broken one.
    data.runtime = {
      state: sanitizeText(data.runtime?.state, 80),
      currentTurnKind: sanitizeText(data.runtime?.currentTurnKind, 120),
      analysisMode: sanitizeText(data.runtime?.analysisMode, 80),
      localStateReadSuppressed: data.runtime?.localStateReadSuppressed === true,
      localExecutionReceipt: data.runtime?.localExecutionReceipt
        ? {
            actionId: sanitizeText(data.runtime.localExecutionReceipt.actionId, 120),
            rearmAllowed: data.runtime.localExecutionReceipt.rearmAllowed === true,
            rearmReason: sanitizeText(data.runtime.localExecutionReceipt.rearmReason, 120)
          }
        : null
    };
    data.mission = data.mission
      ? {
          objective: compactContextText(
            data.mission?.mainTask?.objective || data.mission?.objective,
            260,
            { label: "OBJECTIVE" }
          ).text,
          workUnit: compactContextText(
            data.mission?.current?.boundedWorkUnit || data.mission?.workUnit,
            260,
            { label: "WORK_UNIT" }
          ).text,
          next: compactContextText(
            data.mission?.current?.nextHighLeverageAction || data.mission?.next,
            260,
            { label: "NEXT" }
          ).text
        }
      : null;
    data.delta = {
      targetResult: {
        valid: Boolean(data.delta?.targetResult?.valid),
        status: sanitizeText(data.delta?.targetResult?.status, 40),
        next: compactContextText(data.delta?.targetResult?.next, 260, {
          label: "TARGET_NEXT"
        }).text,
        nextActor: sanitizeText(data.delta?.targetResult?.nextActor, 80),
        completionState: sanitizeText(data.delta?.targetResult?.completionState, 80)
      },
      nextDirection: compactContextText(data.delta?.nextDirection, 220, {
        label: "NEXT_DIRECTION"
      }).text,
      baselineRequestPrompt: data.delta?.baselineRequestPrompt
        ? "eic.main-task-baseline.v3 required"
        : null
    };
    data.availableActions = data.availableActions.map((item) => ({
      actionId: sanitizeText(item?.actionId, 120),
      executionDisposition: sanitizeText(item?.executionDisposition, 120),
      executorActor: sanitizeText(item?.executorActor, 80),
      description: compactContextText(item?.description, 120, { label: "ACTION" }).text
    }));
    prompt = `NANO ADVISORY REQUEST v16\n${rules.slice(0, 4).join("\n")}\nDATA=${JSON.stringify(data)}`;
    shrinkRounds += 1;
  }
  if (prompt.length > limit) {
    // Emergency compact form remains complete and deterministic. The minimum
    // supported limit is 2,400 chars, so this shape has ample headroom.
    data.mission = data.mission
      ? {
          objective: compactContextText(data.mission.objective, 140, { label: "GOAL" }).text,
          workUnit: compactContextText(data.mission.workUnit, 140, { label: "UNIT" }).text,
          next: compactContextText(data.mission.next, 140, { label: "NEXT" }).text
        }
      : null;
    data.delta = {
      targetResult: {
        valid: Boolean(data.delta?.targetResult?.valid),
        status: sanitizeText(data.delta?.targetResult?.status, 40),
        next: compactContextText(data.delta?.targetResult?.next, 140, { label: "TARGET_NEXT" }).text,
        nextActor: sanitizeText(data.delta?.targetResult?.nextActor, 80)
      }
    };
    data.availableActions = data.availableActions.map((item) => ({
      actionId: sanitizeText(item?.actionId, 120),
      executorActor: sanitizeText(item?.executorActor, 80)
    }));
    prompt = `NANO ADVISORY REQUEST v16\n${rules.slice(0, 2).join("\n")}\nDATA=${JSON.stringify(data)}`;
    shrinkRounds += 1;
  }

  return {
    prompt,
    budget: {
      maxPromptChars: limit,
      promptChars: prompt.length,
      withinBudget: prompt.length <= limit,
      shrinkRounds,
      allocation: {
        strategy: "REFERENCE_PLUS_DELTA",
        fullMandateChars: 0,
        fullConversationChars: 0,
        priorAssistantProseChars: 0
      },
      sections: {
        runtime: { chars: JSON.stringify(data.runtime).length },
        mission: { chars: JSON.stringify(data.mission).length },
        targetResult: { chars: JSON.stringify(data.delta.targetResult).length },
        observationAnchors: { count: Array.isArray(data.delta?.observationAnchors) ? data.delta.observationAnchors.length : 0 },
        availableActions: { count: data.availableActions.length }
      }
    }
  };
}

/**
 * Current-version-only string API. v0.9.3 always uses the compact reference-plus-delta prompt.
 */
export function buildNanoDecisionPrompt(args = {}) {
  return buildNanoDecisionPromptDetailed(args).prompt;
}

export { NANO_BUDGET_DEFAULTS };

export function createNanoRequest({
  requestId,
  observationId,
  mode = NANO_REQUEST_MODE.CONTINUATION,
  graceMs = 180_000,
  now = Date.now()
} = {}) {
  if (!requestId || !observationId) throw new TypeError("requestId och observationId krävs.");
  return {
    requestId: String(requestId),
    observationId: String(observationId),
    mode,
    status: NANO_REQUEST_STATUS.PENDING,
    createdAt: nowIso(now),
    claimAvailableAt: nowIso(now),
    deadlineAt: mode === NANO_REQUEST_MODE.TAKEOVER_BOOTSTRAP ? null : nowIso(now + graceMs),
    unclaimedRearmCount: 0,
    claimId: null,
    claimedAt: null,
    startedAt: null,
    heartbeatAt: null,
    claimLeaseUntil: null,
    firstTokenAt: null,
    completedAt: null,
    durationMs: null,
    outputChars: 0,
    chunkCount: 0,
    decisionSource: null,
    repairAttempt: 0,
    validationErrors: [],
    lastError: ""
  };
}

export function claimNanoRequestState(requestValue, {
  claimId,
  modelKind = "unknown",
  inputDigest = "",
  inputChars = 0,
  leaseMs = DEFAULT_CLAIM_LEASE_MS,
  now = Date.now()
} = {}) {
  const request = deepClone(requestValue);
  if (!request || request.status !== NANO_REQUEST_STATUS.PENDING) {
    return { ok: false, reason: "NOT_PENDING", request };
  }
  if (!claimId) return { ok: false, reason: "CLAIM_ID_MISSING", request };
  if (request.mode !== NANO_REQUEST_MODE.TAKEOVER_BOOTSTRAP) {
    const deadline = Date.parse(request.deadlineAt || "");
    if (Number.isFinite(deadline) && now >= deadline) {
      return { ok: false, reason: "REQUEST_DEADLINE_EXPIRED", request };
    }
  }
  const at = nowIso(now);
  request.status = NANO_REQUEST_STATUS.RUNNING;
  request.claimId = sanitizeText(claimId, 240);
  request.claimedAt = at;
  request.unclaimedRearmCount = 0;
  request.startedAt = at;
  request.heartbeatAt = at;
  request.modelKind = sanitizeText(modelKind, 120);
  request.inputDigest = sanitizeText(inputDigest, 128);
  request.inputChars = Math.max(0, Number(inputChars || 0));
  request.initialInputDigest = request.inputDigest;
  request.initialInputChars = request.inputChars;
  extendClaimLease(request, now, leaseMs);
  return { ok: true, request };
}

export function updateNanoProgressState(requestValue, {
  claimId,
  outputChars = 0,
  chunkCount = 0,
  inputDigest = "",
  inputChars = null,
  leaseMs = DEFAULT_CLAIM_LEASE_MS,
  now = Date.now()
} = {}) {
  const request = deepClone(requestValue);
  const claim = activeClaimCheck(request, claimId, now);
  if (!claim.ok) return { ok: false, reason: claim.reason, request };
  request.heartbeatAt = nowIso(now);
  request.outputChars = Math.max(Number(request.outputChars || 0), Number(outputChars || 0));
  request.chunkCount = Math.max(Number(request.chunkCount || 0), Number(chunkCount || 0));
  const nextInputDigest = sanitizeText(inputDigest, 128);
  if (nextInputDigest) request.inputDigest = nextInputDigest;
  if (inputChars !== null && inputChars !== undefined) {
    request.inputChars = Math.max(0, Number(inputChars || 0));
  }
  request.firstTokenAt ||= request.outputChars > 0 ? request.heartbeatAt : null;
  extendClaimLease(request, now, leaseMs);
  return { ok: true, request };
}

export function nanoFallbackDue(request, { now = Date.now() } = {}) {
  if (!request || request.mode === NANO_REQUEST_MODE.TAKEOVER_BOOTSTRAP) return false;
  if (request.status !== NANO_REQUEST_STATUS.PENDING) return false;
  const deadline = Date.parse(request.deadlineAt || "");
  return Number.isFinite(deadline) && now >= deadline;
}

export function completeNanoRequestState(requestValue, {
  claimId,
  source = NANO_DECISION_SOURCE.NANO,
  now = Date.now()
} = {}) {
  const request = deepClone(requestValue);
  if (!request) return { ok: false, reason: "NOT_ACTIVE", request };
  if (source === NANO_DECISION_SOURCE.NANO) {
    const claim = activeClaimCheck(request, claimId, now);
    if (!claim.ok) return { ok: false, reason: claim.reason, request };
  } else if (source === NANO_DECISION_SOURCE.DETERMINISTIC_FALLBACK) {
    if (!nanoFallbackDue(request, { now })) return { ok: false, reason: "FALLBACK_NOT_DUE", request };
  } else if (source === NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL) {
    if (request.status !== NANO_REQUEST_STATUS.DETERMINISTIC_PENDING ||
        request.deterministicSource !== NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL) {
      return { ok: false, reason: "PROTOCOL_FAST_PATH_NOT_PENDING", request };
    }
  } else if (source === NANO_DECISION_SOURCE.DETERMINISTIC_RECOVERY) {
    if (request.status !== NANO_REQUEST_STATUS.DETERMINISTIC_PENDING ||
        request.deterministicSource !== NANO_DECISION_SOURCE.DETERMINISTIC_RECOVERY) {
      return { ok: false, reason: "RECOVERY_FAST_PATH_NOT_PENDING", request };
    }
  } else {
    return { ok: false, reason: "DECISION_SOURCE_INVALID", request };
  }
  request.status = NANO_REQUEST_STATUS.COMPLETED;
  request.completedAt = nowIso(now);
  request.decisionSource = source;
  return { ok: true, request };
}

export function failNanoRequestState(requestValue, {
  claimId,
  errorCode = "NANO_ERROR",
  errorDetail = "Nano-analysen misslyckades.",
  durationMs = 0,
  repairUsed = false,
  now = Date.now()
} = {}) {
  const request = deepClone(requestValue);
  const claim = activeClaimCheck(request, claimId, now);
  if (!claim.ok) return { ok: false, reason: claim.reason, request };
  request.status = NANO_REQUEST_STATUS.FAILED;
  request.completedAt = nowIso(now);
  request.durationMs = Math.max(0, Number(durationMs || 0));
  request.errorCode = sanitizeText(errorCode, 160);
  request.lastError = sanitizeText(errorDetail, 1600);
  request.repairUsed = Boolean(repairUsed);
  request.resultSummary = `${request.errorCode}: ${request.lastError}`;
  return { ok: true, request };
}

export function nanoRequestDigest(request) {
  return stableStringify({
    requestId: request?.requestId,
    observationId: request?.observationId,
    mode: request?.mode,
    createdAt: request?.createdAt
  });
}
