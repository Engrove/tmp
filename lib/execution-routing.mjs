import { sanitizeText, stableStringify } from "./common.mjs";
import { AUTONOM_AGENT_LOCAL_SESSION_STATE, TARGET_SESSION_OWNER } from "./session-init-control.mjs";

export const EIC_EXECUTION_ACTORS = Object.freeze({
  EIC_AI_SESSION: "EIC_AI_SESSION",
  AGENT: "AGENT",
  NANO: "NANO",
  OPERATOR_ACTION: "OPERATOR_ACTION",
  OPERATOR_DECISION: "OPERATOR_DECISION",
  EXTERNAL_SYSTEM: "EXTERNAL_SYSTEM",
  NONE: "NONE"
});

export const ACTOR_CAPABILITY_TOPOLOGY = Object.freeze({
  [EIC_EXECUTION_ACTORS.EIC_AI_SESSION]: Object.freeze({
    actor: EIC_EXECUTION_ACTORS.EIC_AI_SESSION,
    capabilityClass: "EIC_OWNER_ROUTES_EXPOSED_TO_SESSION",
    scope: "Connected ChatGPT EIC session only; route exposure and owner readback determine actual capability.",
    forbiddenAssumptions: Object.freeze([
      "Agent-local browser capability is not implied.",
      "External producer capability is not implied."
    ])
  }),
  [EIC_EXECUTION_ACTORS.AGENT]: Object.freeze({
    actor: EIC_EXECUTION_ACTORS.AGENT,
    capabilityClass: "AGENT_LOCAL_RUNTIME",
    scope: "Chrome extension controller/session/browser lifecycle, local Capture/Memory, chat-control transport and Nano host.",
    forbiddenAssumptions: Object.freeze([
      "No implicit EIC Backend/project/memory-domain/artifact/APIG/Git/Workspace/repository access.",
      "No capability is gained from task domain or target prose.",
      "AGENT does not create, choose, or attest an independent fresh ChatGPT evaluator session merely because target prose assigns that work to AGENT; the connected EIC_AI_SESSION/operator must create/select/link such a target."
    ])
  }),
  [EIC_EXECUTION_ACTORS.NANO]: Object.freeze({
    actor: EIC_EXECUTION_ACTORS.NANO,
    capabilityClass: "NANO_BOUNDED_REASONING",
    scope: "Reasoning over explicitly supplied bounded context only; never an EIC-AA/5 execution actor.",
    forbiddenAssumptions: Object.freeze([
      "No implicit EIC identity, owner routes, project/repository/artifact/source access, hidden EIC state or source-code introspection."
    ])
  }),
  [EIC_EXECUTION_ACTORS.EXTERNAL_SYSTEM]: Object.freeze({
    actor: EIC_EXECUTION_ACTORS.EXTERNAL_SYSTEM,
    capabilityClass: "EXTERNAL_PRODUCER",
    scope: "A real producer outside EIC_AI_SESSION, AGENT and NANO.",
    forbiddenAssumptions: Object.freeze([
      "Never alias EIC_AI_SESSION work to EXTERNAL_SYSTEM.",
      "Never bounce a true external dependency back to the same EIC chat."
    ])
  }),
  [EIC_EXECUTION_ACTORS.OPERATOR_ACTION]: Object.freeze({
    actor: EIC_EXECUTION_ACTORS.OPERATOR_ACTION,
    capabilityClass: "HUMAN_MECHANICAL_ACTION",
    scope: "Explicit operator action only.",
    forbiddenAssumptions: Object.freeze(["No autonomous execution capability is implied."])
  }),
  [EIC_EXECUTION_ACTORS.OPERATOR_DECISION]: Object.freeze({
    actor: EIC_EXECUTION_ACTORS.OPERATOR_DECISION,
    capabilityClass: "HUMAN_DECISION",
    scope: "Explicit operator decision only.",
    forbiddenAssumptions: Object.freeze(["No autonomous execution capability is implied."])
  }),
  [EIC_EXECUTION_ACTORS.NONE]: Object.freeze({
    actor: EIC_EXECUTION_ACTORS.NONE,
    capabilityClass: "NO_EXECUTOR",
    scope: "Terminal/no next actor.",
    forbiddenAssumptions: Object.freeze([])
  })
});

export function compactActorCapabilityTopology() {
  return Object.values(ACTOR_CAPABILITY_TOPOLOGY).map((entry) => ({
    actor: entry.actor,
    capabilityClass: entry.capabilityClass,
    scope: entry.scope,
    forbiddenAssumptions: [...entry.forbiddenAssumptions]
  }));
}

export const EXECUTION_DISPOSITIONS = Object.freeze({
  LOCAL_EXECUTE: "LOCAL_EXECUTE",
  TARGET_DISPATCH: "TARGET_DISPATCH",
  CHAT_CONTROL_CONTINUATION: "CHAT_CONTROL_CONTINUATION",
  EXTERNAL_OWNER_EXECUTE: "EXTERNAL_OWNER_EXECUTE",
  WAIT_EXTERNAL_EVENT: "WAIT_EXTERNAL_EVENT",
  WAIT_OWNER_EVENT: "WAIT_OWNER_EVENT",
  TERMINAL: "TERMINAL"
});

export const MICRO_ACTION_IDS = Object.freeze({
  READ_LOCAL_SESSION_STATE: "READ_LOCAL_SESSION_STATE",
  REANALYZE_CURRENT_RESPONSE: "REANALYZE_CURRENT_RESPONSE",
  REQUEUE_NANO: "REQUEUE_NANO",
  WAIT_OWNER_EVENT: "WAIT_OWNER_EVENT",
  WAIT_EXTERNAL_EVENT: "WAIT_EXTERNAL_EVENT",
  REQUEST_TARGET: "REQUEST_TARGET",
  REQUEST_EXTERNAL_OWNER: "REQUEST_EXTERNAL_OWNER",
  CONTINUE_PROGRAM: "CONTINUE_PROGRAM",
  STOP: "STOP"
});


/**
 * v0.12.6: once the Agent has already performed READ_LOCAL_SESSION_STATE for
 * the same bounded episode, observed no material delta and delivered the
 * resulting CHAT_CONTROL_CONTINUATION, another target reply that simply assigns
 * the same impossible/non-progressing local task to AGENT must not re-open the
 * local read loop. The next admissible route is the side-band owner handoff.
 */
export function shouldSuppressRepeatedLocalStateRead(run = {}) {
  const receipt = run?.localExecutionReceipt;
  const diagnostic = run?.localStateDiagnosticReceipt;
  const currentTurnKind = sanitizeText(run?.currentTurn?.kind, 120).toUpperCase();
  if (!receipt || !diagnostic) return false;
  if (sanitizeText(receipt.actionId, 120).toUpperCase() !== MICRO_ACTION_IDS.READ_LOCAL_SESSION_STATE) {
    return false;
  }
  if (receipt.rearmAllowed === true) return false;
  if (sanitizeText(receipt.rearmReason, 120).toUpperCase() !== "LOCAL_STATE_UNCHANGED") {
    return false;
  }
  return currentTurnKind === "CHAT_CONTROL_CONTINUATION";
}

export function agentLocalCapabilityBoundaryReason() {
  return [
    "AGENT_LOCAL_STATE_EXHAUSTED",
    "EIC Autonom Agent är den redan aktiva lokala Chrome-extensionruntime.",
    "AGENT kan läsa och styra sin lokala controller/session-state men skapar eller väljer inte själv en ny separat ChatGPT evaluator-session.",
    "När ett färskt evaluator-target måste etableras får EIC_AI_SESSION göra det endast via en faktisk exponerad browser/session-route; annars krävs OPERATOR_ACTION för att öppna/välja/länka targeten innan Agenten kan observera ny state.",
    "Upprepa inte READ_LOCAL_SESSION_STATE när föregående läsning gav LOCAL_STATE_UNCHANGED."
  ].join(" ");
}

export const MICRO_ACTION_REGISTRY = Object.freeze({
  [MICRO_ACTION_IDS.READ_LOCAL_SESSION_STATE]: Object.freeze({
    actionId: MICRO_ACTION_IDS.READ_LOCAL_SESSION_STATE,
    executionDisposition: EXECUTION_DISPOSITIONS.LOCAL_EXECUTE,
    ownerSurface: AUTONOM_AGENT_LOCAL_SESSION_STATE,
    executorActor: EIC_EXECUTION_ACTORS.AGENT,
    requiredCapability: "AGENT_LOCAL_RUNTIME",
    effectClass: "LOCAL_STATE_READ",
    idempotent: true,
    description: "Read the controller-owned session/Nano/effect state and return a local receipt without target transport."
  }),
  [MICRO_ACTION_IDS.REANALYZE_CURRENT_RESPONSE]: Object.freeze({
    actionId: MICRO_ACTION_IDS.REANALYZE_CURRENT_RESPONSE,
    executionDisposition: EXECUTION_DISPOSITIONS.LOCAL_EXECUTE,
    ownerSurface: AUTONOM_AGENT_LOCAL_SESSION_STATE,
    executorActor: EIC_EXECUTION_ACTORS.AGENT,
    requiredCapability: "AGENT_LOCAL_RUNTIME",
    effectClass: "LOCAL_NANO_REANALYSIS",
    idempotent: true,
    description: "Re-run Nano against the current bound observation and the newest local receipt."
  }),
  [MICRO_ACTION_IDS.REQUEUE_NANO]: Object.freeze({
    actionId: MICRO_ACTION_IDS.REQUEUE_NANO,
    executionDisposition: EXECUTION_DISPOSITIONS.LOCAL_EXECUTE,
    ownerSurface: AUTONOM_AGENT_LOCAL_SESSION_STATE,
    executorActor: EIC_EXECUTION_ACTORS.AGENT,
    requiredCapability: "AGENT_LOCAL_RUNTIME",
    effectClass: "LOCAL_NANO_REQUEUE",
    idempotent: true,
    description: "Re-arm the current bounded Nano analysis locally without dispatching a target prompt."
  }),
  [MICRO_ACTION_IDS.WAIT_OWNER_EVENT]: Object.freeze({
    actionId: MICRO_ACTION_IDS.WAIT_OWNER_EVENT,
    executionDisposition: EXECUTION_DISPOSITIONS.WAIT_OWNER_EVENT,
    ownerSurface: TARGET_SESSION_OWNER,
    executorActor: EIC_EXECUTION_ACTORS.EIC_AI_SESSION,
    requiredCapability: "EIC_OWNER_ROUTES_EXPOSED_TO_SESSION",
    effectClass: "CHAT_CONTROL_WAIT",
    idempotent: true,
    description: "Wake the connected EIC AI session exactly once for a new bounded owner-routable step; not for a true external producer."
  }),
  [MICRO_ACTION_IDS.WAIT_EXTERNAL_EVENT]: Object.freeze({
    actionId: MICRO_ACTION_IDS.WAIT_EXTERNAL_EVENT,
    executionDisposition: EXECUTION_DISPOSITIONS.WAIT_EXTERNAL_EVENT,
    ownerSurface: "EXTERNAL_SYSTEM",
    executorActor: EIC_EXECUTION_ACTORS.EXTERNAL_SYSTEM,
    requiredCapability: "EXTERNAL_PRODUCER",
    effectClass: "EXTERNAL_EVENT_WAIT",
    idempotent: true,
    description: "Represent a genuine external producer dependency without target/chat-control/local dispatch."
  }),
  [MICRO_ACTION_IDS.REQUEST_TARGET]: Object.freeze({
    actionId: MICRO_ACTION_IDS.REQUEST_TARGET,
    executionDisposition: EXECUTION_DISPOSITIONS.TARGET_DISPATCH,
    ownerSurface: TARGET_SESSION_OWNER,
    executorActor: EIC_EXECUTION_ACTORS.EIC_AI_SESSION,
    requiredCapability: "EIC_OWNER_ROUTES_EXPOSED_TO_SESSION",
    effectClass: "TARGET_PROMPT",
    idempotent: false,
    description: "Dispatch exactly one bounded work unit to the connected EIC AI session."
  }),
  [MICRO_ACTION_IDS.REQUEST_EXTERNAL_OWNER]: Object.freeze({
    actionId: MICRO_ACTION_IDS.REQUEST_EXTERNAL_OWNER,
    executionDisposition: EXECUTION_DISPOSITIONS.EXTERNAL_OWNER_EXECUTE,
    ownerSurface: "EXTERNAL_OWNER",
    executorActor: EIC_EXECUTION_ACTORS.EXTERNAL_SYSTEM,
    requiredCapability: "EXTERNAL_PRODUCER",
    effectClass: "EXTERNAL_OWNER_HANDOFF",
    idempotent: false,
    deprecatedCompatibility: true,
    description: "Legacy compatibility action. Normal actor-aware routing does not expose it to Nano; true external dependencies use WAIT_EXTERNAL_EVENT."
  }),
  [MICRO_ACTION_IDS.CONTINUE_PROGRAM]: Object.freeze({
    actionId: MICRO_ACTION_IDS.CONTINUE_PROGRAM,
    executionDisposition: EXECUTION_DISPOSITIONS.TARGET_DISPATCH,
    ownerSurface: TARGET_SESSION_OWNER,
    executorActor: EIC_EXECUTION_ACTORS.EIC_AI_SESSION,
    requiredCapability: "EIC_OWNER_ROUTES_EXPOSED_TO_SESSION",
    effectClass: "TARGET_CONTINUATION",
    idempotent: false,
    description: "Continue the bounded program by asking the connected EIC AI session to perform its next owned work unit."
  }),
  [MICRO_ACTION_IDS.STOP]: Object.freeze({
    actionId: MICRO_ACTION_IDS.STOP,
    executionDisposition: EXECUTION_DISPOSITIONS.TERMINAL,
    ownerSurface: AUTONOM_AGENT_LOCAL_SESSION_STATE,
    executorActor: EIC_EXECUTION_ACTORS.NONE,
    requiredCapability: "NO_EXECUTOR",
    effectClass: "TERMINAL_STOP",
    idempotent: true,
    description: "Stop the local branch without creating another target prompt."
  })
});


export function normalizedControllerFacts(run = {}) {
  const receipt = run?.sessionContextInit?.baselineDecisionCommit || null;
  const request = run?.pendingNanoRequest || null;
  const effectJournal = Array.isArray(run?.effectJournal) ? run.effectJournal : [];
  const effect = effectJournal.length
    ? effectJournal[effectJournal.length - 1]
    : null;
  const materialEffect = [...effectJournal].reverse().find((item) =>
    !item?.chatControlSideBand && !item?.protocolRepairSideBand
  ) || null;
  const semanticVerdict = sanitizeText(receipt?.semanticVerdict, 80).toUpperCase();
  const requestStatus = sanitizeText(request?.status, 80).toUpperCase();
  const effectStatus = sanitizeText(effect?.status, 80).toUpperCase();
  const materialEffectStatus = sanitizeText(materialEffect?.status, 80).toUpperCase();
  return {
    schema: "eic.autonom.controller-facts.v1",
    baseline: {
      accepted: semanticVerdict === "ACCEPT" && receipt?.normalizedBaselineAccepted === true,
      committed: sanitizeText(receipt?.commitStatus, 80).toUpperCase() === "COMMITTED",
      readyVerified:
        sanitizeText(receipt?.commitStatus, 80).toUpperCase() === "COMMITTED" &&
        sanitizeText(receipt?.readyStatus, 80).toUpperCase() === "READY" &&
        Boolean(receipt?.readyVerifiedAt),
      successEvidencePersisted: Boolean(receipt?.successAuditEmittedAt),
      requestId: sanitizeText(receipt?.requestId, 180)
    },
    nano: {
      requestPresent: Boolean(request?.requestId),
      requestId: sanitizeText(request?.requestId, 180),
      requestStatus,
      claimPresent: Boolean(request?.claimId),
      active: ["PENDING", "RUNNING", "DETERMINISTIC_PENDING", "DISPATCHED"].includes(requestStatus)
    },
    effect: {
      present: Boolean(effect?.effectId),
      effectId: sanitizeText(effect?.effectId, 180),
      turnId: sanitizeText(effect?.turnId, 180),
      status: effectStatus,
      chatControl: Boolean(effect?.chatControlSideBand),
      targetTransportPending: ["PREPARED", "SUBMITTING", "SUBMITTED_UNCONFIRMED"].includes(effectStatus),
      targetTransportAcked: effectStatus === "ACKED",
      materialEffectId: sanitizeText(materialEffect?.effectId, 180),
      materialEffectTurnId: sanitizeText(materialEffect?.turnId, 180),
      materialEffectStatus,
      materialTargetTransportPending:
        ["PREPARED", "SUBMITTING", "SUBMITTED_UNCONFIRMED"].includes(materialEffectStatus),
      materialTargetTransportAcked: materialEffectStatus === "ACKED"
    },
    localReceipt: {
      present: Boolean(run?.localExecutionReceipt?.receiptId),
      receiptId: sanitizeText(run?.localExecutionReceipt?.receiptId, 180),
      actionId: sanitizeText(run?.localExecutionReceipt?.actionId, 120)
    }
  };
}

export function deriveControllerProjection(factsValue = {}) {
  const facts = factsValue?.schema === "eic.autonom.controller-facts.v1"
    ? factsValue
    : normalizedControllerFacts(factsValue);
  let phase = "OBSERVING";
  if (facts.baseline?.readyVerified) {
    phase = facts.nano?.active ? "READY_NANO_ROUTING" : "READY";
  } else if (facts.baseline?.committed) {
    phase = "BASELINE_COMMITTED";
  } else if (facts.baseline?.accepted) {
    phase = "BASELINE_DECIDED";
  } else if (facts.nano?.active) {
    phase = "NANO_ACTIVE";
  } else if (facts.effect?.targetTransportPending) {
    phase = "TARGET_EFFECT_PENDING";
  }
  return {
    schema: "eic.autonom.controller-projection.v1",
    phase,
    ready: facts.baseline?.readyVerified === true,
    targetTransportPending: facts.effect?.targetTransportPending === true,
    nanoActive: facts.nano?.active === true
  };
}

function normalizedOwner(value) {
  return sanitizeText(value, 400).toUpperCase();
}

export function availableMicroActions({
  targetResult = {},
  ownerRoute = "",
  sessionInitState = "",
  hasBoundObservation = true,
  allowCoreRecoveryActions = false,
  suppressLocalStateRead = false
} = {}) {
  const owner = normalizedOwner(ownerRoute);
  const nextActor = sanitizeText(targetResult?.nextActor, 80).toUpperCase();
  const terminal = ["DONE", "USER_PAUSE"].includes(sanitizeText(targetResult?.status, 80).toUpperCase());
  const localOwner = owner === AUTONOM_AGENT_LOCAL_SESSION_STATE ||
    owner === "EIC_STATE_MACHINE" ||
    owner.startsWith("AUTONOM_AGENT_LOCAL");
  const targetOwner = owner.includes("TARGET") || owner.includes("CHATGPT");
  const externalOwner = Boolean(owner) && !localOwner && !targetOwner;
  const actorKnown = Object.values(EIC_EXECUTION_ACTORS).includes(nextActor);

  // v0.12.6: STOP is not a standing ordinary-Nano option. A model suggestion
  // must never manufacture terminality for an otherwise live MISSION unit.
  // Expose STOP only when the runtime/target lifecycle is already terminal or
  // when no continuing runtime transition exists.
  const ids = new Set();
  if (terminal || nextActor === EIC_EXECUTION_ACTORS.NONE) {
    ids.add(MICRO_ACTION_IDS.STOP);
  } else if (nextActor === EIC_EXECUTION_ACTORS.EXTERNAL_SYSTEM) {
    ids.add(MICRO_ACTION_IDS.WAIT_EXTERNAL_EVENT);
  } else if (nextActor === EIC_EXECUTION_ACTORS.AGENT) {
    // WAIT_OWNER_EVENT is the escape/handoff route to the connected EIC AI
    // session. A repeated no-delta local read is explicitly suppressed.
    ids.add(MICRO_ACTION_IDS.WAIT_OWNER_EVENT);
    if (!suppressLocalStateRead) ids.add(MICRO_ACTION_IDS.READ_LOCAL_SESSION_STATE);
  } else if (nextActor === EIC_EXECUTION_ACTORS.EIC_AI_SESSION) {
    ids.add(MICRO_ACTION_IDS.WAIT_OWNER_EVENT);
    if (!terminal) {
      ids.add(MICRO_ACTION_IDS.REQUEST_TARGET);
      ids.add(MICRO_ACTION_IDS.CONTINUE_PROGRAM);
    }
  } else if ([EIC_EXECUTION_ACTORS.OPERATOR_ACTION, EIC_EXECUTION_ACTORS.OPERATOR_DECISION,
              EIC_EXECUTION_ACTORS.NONE].includes(nextActor)) {
    // Human/terminal actors are resolved by their owning lifecycle. Nano must
    // not convert them into local, target or external-system execution.
  } else if (!actorKnown) {
    // Compatibility fallback for older/partial state only. Owner identity may
    // narrow the route, but absence of an owner never grants AGENT capability.
    if (localOwner) {
      ids.add(MICRO_ACTION_IDS.WAIT_OWNER_EVENT);
      if (!suppressLocalStateRead) ids.add(MICRO_ACTION_IDS.READ_LOCAL_SESSION_STATE);
    } else if (externalOwner) {
      ids.add(MICRO_ACTION_IDS.WAIT_EXTERNAL_EVENT);
    } else {
      ids.add(MICRO_ACTION_IDS.WAIT_OWNER_EVENT);
      if (targetOwner && !terminal) {
        ids.add(MICRO_ACTION_IDS.REQUEST_TARGET);
        ids.add(MICRO_ACTION_IDS.CONTINUE_PROGRAM);
      }
    }
  }

  // REANALYZE_CURRENT_RESPONSE and REQUEUE_NANO are Core recovery controls,
  // never ordinary Nano-selected actions. Do not make them available for a
  // true external/human/terminal actor boundary.
  if (hasBoundObservation &&
      allowCoreRecoveryActions &&
      ![
        EIC_EXECUTION_ACTORS.EXTERNAL_SYSTEM,
        EIC_EXECUTION_ACTORS.OPERATOR_ACTION,
        EIC_EXECUTION_ACTORS.OPERATOR_DECISION,
        EIC_EXECUTION_ACTORS.NONE
      ].includes(nextActor)) {
    ids.add(MICRO_ACTION_IDS.REANALYZE_CURRENT_RESPONSE);
    ids.add(MICRO_ACTION_IDS.REQUEUE_NANO);
  }

  if (sanitizeText(sessionInitState, 80).toUpperCase() === "NANO_ANALYZING") {
    ids.delete(MICRO_ACTION_IDS.REQUEST_TARGET);
    ids.delete(MICRO_ACTION_IDS.CONTINUE_PROGRAM);
  }

  // A human/terminal lifecycle is normally consumed before ordinary Nano.
  // If an incomplete/legacy state reaches this function without a continuing
  // route, fail closed to the runtime-owned STOP path rather than inventing a
  // transport.
  if (ids.size === 0) ids.add(MICRO_ACTION_IDS.STOP);

  return [...ids].map((id) => MICRO_ACTION_REGISTRY[id]);
}

export function compactMicroActionCatalog(input = {}) {
  return availableMicroActions({
    ...input,
    allowCoreRecoveryActions: false
  }).map((action) => ({
    actionId: action.actionId,
    executionDisposition: action.executionDisposition,
    ownerSurface: action.ownerSurface,
    executorActor: action.executorActor,
    requiredCapability: action.requiredCapability,
    effectClass: action.effectClass,
    description: action.description
  }));
}

function chooseFallbackAction({ decision = {}, targetResult = {}, available = [] } = {}) {
  const ids = new Set(available.map((action) => action.actionId));
  const owner = normalizedOwner(decision?.ownerRoute);
  const nextActor = sanitizeText(targetResult?.nextActor, 80).toUpperCase();
  const action = sanitizeText(decision?.action, 80).toUpperCase();

  if (action === "DONE" || action === "PAUSE" || nextActor === EIC_EXECUTION_ACTORS.NONE) {
    return MICRO_ACTION_IDS.STOP;
  }
  if (nextActor === EIC_EXECUTION_ACTORS.EXTERNAL_SYSTEM &&
      ids.has(MICRO_ACTION_IDS.WAIT_EXTERNAL_EVENT)) {
    return MICRO_ACTION_IDS.WAIT_EXTERNAL_EVENT;
  }
  if (nextActor === EIC_EXECUTION_ACTORS.AGENT &&
      ids.has(MICRO_ACTION_IDS.READ_LOCAL_SESSION_STATE)) {
    return MICRO_ACTION_IDS.READ_LOCAL_SESSION_STATE;
  }
  if (nextActor === EIC_EXECUTION_ACTORS.EIC_AI_SESSION) {
    if (ids.has(MICRO_ACTION_IDS.CONTINUE_PROGRAM)) return MICRO_ACTION_IDS.CONTINUE_PROGRAM;
    if (ids.has(MICRO_ACTION_IDS.REQUEST_TARGET)) return MICRO_ACTION_IDS.REQUEST_TARGET;
  }

  // Compatibility fallback only when no explicit execution actor was supplied.
  if (!nextActor) {
    if (owner === AUTONOM_AGENT_LOCAL_SESSION_STATE ||
        owner === "EIC_STATE_MACHINE" ||
        owner.startsWith("AUTONOM_AGENT_LOCAL")) {
      if (ids.has(MICRO_ACTION_IDS.READ_LOCAL_SESSION_STATE)) {
        return MICRO_ACTION_IDS.READ_LOCAL_SESSION_STATE;
      }
    }
    if (owner && !owner.includes("TARGET") && !owner.includes("CHATGPT") &&
        ids.has(MICRO_ACTION_IDS.WAIT_EXTERNAL_EVENT)) {
      return MICRO_ACTION_IDS.WAIT_EXTERNAL_EVENT;
    }
    if ((owner.includes("TARGET") || owner.includes("CHATGPT")) &&
        ids.has(MICRO_ACTION_IDS.CONTINUE_PROGRAM)) {
      return MICRO_ACTION_IDS.CONTINUE_PROGRAM;
    }
  }

  if (ids.has(MICRO_ACTION_IDS.WAIT_OWNER_EVENT)) return MICRO_ACTION_IDS.WAIT_OWNER_EVENT;
  if (ids.has(MICRO_ACTION_IDS.WAIT_EXTERNAL_EVENT)) return MICRO_ACTION_IDS.WAIT_EXTERNAL_EVENT;
  return MICRO_ACTION_IDS.STOP;
}

export function resolveExecutionPlan({
  decision = {},
  targetResult = {},
  sessionInitState = "",
  hasBoundObservation = true,
  allowCoreRecoveryActions = false,
  suppressLocalStateRead = false
} = {}) {
  const available = availableMicroActions({
    targetResult,
    ownerRoute: decision?.ownerRoute,
    sessionInitState,
    hasBoundObservation,
    allowCoreRecoveryActions,
    suppressLocalStateRead
  });
  const ids = new Set(available.map((action) => action.actionId));
  const requestedId = sanitizeText(decision?.microActionId, 120).toUpperCase();
  const selectedId = ids.has(requestedId)
    ? requestedId
    : chooseFallbackAction({ decision, targetResult, available });
  const action = MICRO_ACTION_REGISTRY[selectedId] || MICRO_ACTION_REGISTRY[MICRO_ACTION_IDS.WAIT_OWNER_EVENT];
  const targetNextActor = sanitizeText(targetResult?.nextActor, 80).toUpperCase();
  return {
    ...action,
    source: ids.has(requestedId) ? "NANO_SELECTED" : "CORE_FALLBACK",
    requestedMicroActionId: requestedId,
    requestedActionCompatible: !requestedId || ids.has(requestedId),
    targetNextActor,
    actorContractEnforced: Boolean(targetNextActor),
    availableActionIds: [...ids],
    localStateReadSuppressed: suppressLocalStateRead === true,
    capabilityBoundaryReason: suppressLocalStateRead === true && targetNextActor === EIC_EXECUTION_ACTORS.AGENT
      ? agentLocalCapabilityBoundaryReason()
      : ""
  };
}

/**
 * v0.11.20: a SESSION_CONTEXT_BASELINE_REQUEST response owns only the init episode.
 * Once READY is committed, its trailer next/actor are stale transport metadata. Project
 * the accepted baseline's nextHighLeverageAction into a fresh actor-neutral CONTINUE
 * observation so normal actor routing can restart from owner context without re-requesting
 * the baseline.
 */
export function projectPostReadyBaselineHandoffTarget({
  targetResult = {},
  nextHighLeverageAction = ""
} = {}) {
  return {
    ...(targetResult && typeof targetResult === "object" ? targetResult : {}),
    valid: true,
    status: "CONTINUE",
    next: sanitizeText(nextHighLeverageAction, 5000),
    nextActor: "",
    reason: "SESSION_CONTEXT_READY_HANDOFF"
  };
}

/**
 * v0.11.20 control minimization: Nano may describe USER_PAUSE, but that model-authored
 * field is not itself a human-boundary owner. When the target protocol still says
 * CONTINUE and the registered execution route is a no-effect local/passive wait, Core
 * internalizes the model control request instead of manufacturing a level-10 gate.
 *
 * Real target/operator/safety boundaries are not weakened here: OPERATOR_ACTION,
 * OPERATOR_DECISION, target USER_PAUSE, OPERATOR_ACTION_REQUIRED and material transports
 * all return internalize=false.
 */
export function evaluateModelUserPauseControl({
  decision = {},
  targetResult = {},
  executionPlan = null,
  advisoryOnly = false
} = {}) {
  const pauseOrigin = sanitizeText(decision?.pauseOrigin, 120).toUpperCase();
  const targetStatus = sanitizeText(targetResult?.status, 120).toUpperCase();
  const targetNextActor = sanitizeText(targetResult?.nextActor, 120).toUpperCase();
  const disposition = sanitizeText(executionPlan?.executionDisposition, 120).toUpperCase();
  const executorActor = sanitizeText(executionPlan?.executorActor, 120).toUpperCase();
  const routeSource = sanitizeText(executionPlan?.source, 120).toUpperCase();

  const targetOwnsHumanBoundary =
    ["USER_PAUSE", "OPERATOR_ACTION_REQUIRED"].includes(targetStatus) ||
    [EIC_EXECUTION_ACTORS.OPERATOR_ACTION, EIC_EXECUTION_ACTORS.OPERATOR_DECISION].includes(targetNextActor);
  const noEffectDisposition = [
    EXECUTION_DISPOSITIONS.LOCAL_EXECUTE,
    EXECUTION_DISPOSITIONS.WAIT_OWNER_EVENT,
    EXECUTION_DISPOSITIONS.WAIT_EXTERNAL_EVENT,
    EXECUTION_DISPOSITIONS.TERMINAL
  ].includes(disposition);
  const executionOwnsHumanBoundary =
    [EIC_EXECUTION_ACTORS.OPERATOR_ACTION, EIC_EXECUTION_ACTORS.OPERATOR_DECISION].includes(executorActor);

  // v0.12.6: advisory prose is not itself an effect. Free analysis may discuss
  // destructive or blocked possibilities without manufacturing a level-10
  // boundary when the runtime-selected route is local, passive wait or terminal.
  // Real target/operator boundaries still dominate, and material TARGET_DISPATCH
  // remains classified from the actual semantic effect text.
  const advisoryNoEffect = advisoryOnly === true &&
    Boolean(targetResult?.valid) &&
    targetStatus === "CONTINUE" &&
    !targetOwnsHumanBoundary &&
    noEffectDisposition &&
    !executionOwnsHumanBoundary;
  const modelPauseNoEffect = pauseOrigin === "USER_PAUSE" &&
    Boolean(targetResult?.valid) &&
    targetStatus === "CONTINUE" &&
    !targetOwnsHumanBoundary &&
    noEffectDisposition &&
    !executionOwnsHumanBoundary &&
    routeSource === "NANO_SELECTED";
  const internalize = advisoryNoEffect || modelPauseNoEffect;

  return {
    schema: "eic.autonom.control-minimization.v2",
    internalize,
    reasonCode: advisoryNoEffect
      ? "NANO_ADVISORY_NO_EFFECT_ROUTE"
      : modelPauseNoEffect
        ? "MODEL_USER_PAUSE_NON_EFFECT_ROUTE"
        : targetOwnsHumanBoundary
          ? "OWNER_HUMAN_BOUNDARY"
          : !noEffectDisposition
            ? "MATERIAL_ROUTE_REQUIRES_CLASSIFICATION"
            : routeSource !== "NANO_SELECTED" && advisoryOnly !== true
              ? "ROUTE_NOT_NANO_SELECTED"
              : pauseOrigin !== "USER_PAUSE" && advisoryOnly !== true
                ? "NO_MODEL_USER_PAUSE"
                : "CONTROL_MINIMIZATION_NOT_APPLICABLE",
    targetStatus,
    targetNextActor,
    executionDisposition: disposition,
    executorActor,
    routeSource,
    advisoryOnly: advisoryOnly === true,
    riskLevel: internalize ? 1 : null
  };
}

export function executionFamilyKey({
  workUnitId = "",
  ownerSurface = "",
  effectClass = "",
  executionDisposition = "",
  evidenceNeed = ""
} = {}) {
  return stableStringify({
    workUnitId: sanitizeText(workUnitId, 240),
    ownerSurface: sanitizeText(ownerSurface, 240),
    effectClass: sanitizeText(effectClass, 120),
    executionDisposition: sanitizeText(executionDisposition, 120),
    evidenceNeed: sanitizeText(evidenceNeed, 400)
  });
}

export const LOCAL_NANO_REARM_ACTION_IDS = Object.freeze([
  MICRO_ACTION_IDS.READ_LOCAL_SESSION_STATE,
  MICRO_ACTION_IDS.REANALYZE_CURRENT_RESPONSE,
  MICRO_ACTION_IDS.REQUEUE_NANO
]);

const SIDE_BAND_CONTROL_TURN_KINDS = Object.freeze([
  "CHAT_CONTROL_CONTINUATION",
  "PROTOCOL_REPAIR"
]);

function sideBandControlTurn(run = {}) {
  return SIDE_BAND_CONTROL_TURN_KINDS.includes(
    sanitizeText(run?.currentTurn?.kind, 120).toUpperCase()
  );
}

function sideBandTargetSemanticProjection(target = {}) {
  return {
    valid: target?.valid === true,
    reason: sanitizeText(target?.reason, 120),
    status: sanitizeText(target?.status, 80),
    next: sanitizeText(target?.next, 1600),
    nextActor: sanitizeText(target?.nextActor, 80),
    completionState: sanitizeText(target?.completionState, 80),
    fullStopReason: sanitizeText(target?.fullStopReason, 80)
  };
}

function sideBandMaterialAnchor(run = {}, factsValue = null) {
  const facts = factsValue || normalizedControllerFacts(run);
  return {
    runId: sanitizeText(run?.runId, 180),
    taskFingerprint: sanitizeText(run?.taskFingerprint, 180),
    materialEffectTurnId: sanitizeText(facts?.effect?.materialEffectTurnId, 180),
    sessionInitNeedKey: sanitizeText(run?.sessionContextInit?.needKey, 240),
    catchResponseIdentity: sanitizeText(run?.sessionContextInit?.catchResponseIdentity, 240)
  };
}

function localRearmTargetSemanticProjection(target = {}) {
  return {
    valid: target?.valid === true,
    status: sanitizeText(target?.status, 80),
    nextActor: sanitizeText(target?.nextActor, 80),
    completionState: sanitizeText(target?.completionState, 80),
    fullStopReason: sanitizeText(target?.fullStopReason, 80)
  };
}

/**
 * Cross-boundary local-rearm observation identity.
 *
 * v0.11.10: a no-delta local receipt is created before the first side-band
 * wake, while its child response is observed with currentTurn.kind set to
 * CHAT_CONTROL_CONTINUATION/PROTOCOL_REPAIR.  The ordinary observation key
 * deliberately uses different namespaces on those two sides.  Local rearm
 * therefore uses this dedicated semantic bridge identity so the boundary
 * itself cannot manufacture MATERIAL_DELTA.
 *
 * Raw non-side-band response identity remains material in
 * observationMaterialKey/materialDecisionInputKey.  This bridge is used only
 * to suppress the exact local no-delta child transition for the same action
 * family and stable structured control class.
 */
export function localRearmObservationKey(observation = {}, run = {}) {
  const facts = normalizedControllerFacts(run);
  return stableStringify({
    kind: "LOCAL_REARM_SEMANTIC_V1",
    anchor: sideBandMaterialAnchor(run, facts),
    materialControlGeneration: Math.max(0, Number(run?.materialControlGeneration || 0)),
    target: localRearmTargetSemanticProjection(observation?.targetResult || {})
  });
}

/**
 * Cross-boundary material state for local rearm and no-delta wake dedupe.
 *
 * Deliberately excludes raw response identity/hash/current side-band turn
 * identity and free-form EIC_NEXT wording. Structured executor/completion
 * changes, owner-controlled generation, task/init/material-effect anchors and
 * committed baseline/effect state remain material.
 */
export function localRearmMaterialKey({ run = {}, observation = {} } = {}) {
  const facts = normalizedControllerFacts(run);
  return stableStringify({
    observationKey: localRearmObservationKey(observation, run),
    baseline: {
      accepted: facts?.baseline?.accepted === true,
      committed: facts?.baseline?.committed === true,
      readyVerified: facts?.baseline?.readyVerified === true
    },
    sessionInitState: sanitizeText(run?.sessionContextInit?.state, 80),
    effect: {
      turnId: sanitizeText(facts?.effect?.materialEffectTurnId, 180),
      status: sanitizeText(facts?.effect?.materialEffectStatus, 80),
      materialTargetTransportPending: facts?.effect?.materialTargetTransportPending === true,
      materialTargetTransportAcked: facts?.effect?.materialTargetTransportAcked === true
    }
  });
}

/**
 * Identity used by local Nano rearm/failure fencing.
 *
 * v0.11.9+: side-band EIC control replies are semantically keyed. A fresh
 * responseIdentity/responseHash/turnId created only because EIC answered a
 * CHAT_CONTROL_CONTINUATION or PROTOCOL_REPAIR must not manufacture progress.
 * Genuine local-control generation, task/init/material-effect anchor changes,
 * or substantive target control semantics still change the key.
 */
export function observationMaterialKey(observation = {}, run = {}) {
  if (!sideBandControlTurn(run)) {
    return sanitizeText(
      observation?.responseIdentity || observation?.responseHash || observation?.observationId,
      500
    );
  }
  return stableStringify({
    kind: "SIDE_BAND_CONTROL_SEMANTIC",
    anchor: sideBandMaterialAnchor(run),
    materialControlGeneration: Math.max(0, Number(run?.materialControlGeneration || 0)),
    target: sideBandTargetSemanticProjection(observation?.targetResult || {})
  });
}

/**
 * Stable semantic input for the next controller decision.
 *
 * Deliberately excludes volatile housekeeping such as Nano request/claim ids,
 * local receipt ids/timestamps and UI/runtime revision counters.  A fresh
 * receipt that reports the same owner facts must therefore not manufacture a
 * new Nano decision input.
 */
export function materialDecisionInputKey({ run = {}, observation = {} } = {}) {
  const facts = normalizedControllerFacts(run);
  const target = observation?.targetResult || {};
  const currentTurn = run?.currentTurn || {};
  const sideBandCurrentTurn = sideBandControlTurn(run);
  const sideBandAnchor = sideBandMaterialAnchor(run, facts);
  const materialCurrentTurnId = sideBandCurrentTurn
    ? sanitizeText(
        sideBandAnchor.materialEffectTurnId ||
        sideBandAnchor.sessionInitNeedKey ||
        sideBandAnchor.taskFingerprint ||
        sideBandAnchor.runId,
        180
      )
    : sanitizeText(currentTurn?.turnId, 180);
  const materialCurrentTurnEffectState = sideBandCurrentTurn
    ? "ACKED"
    : sanitizeText(currentTurn?.effectState, 80);
  return stableStringify({
    observation: {
      key: observationMaterialKey(observation, run),
      // Raw assistant identity/hash and trailer turn-id are transport identity for
      // side-band control replies, not new program material.
      responseHash: sideBandCurrentTurn ? "" : sanitizeText(observation?.responseHash, 128),
      target: sideBandCurrentTurn
        ? {
            ...sideBandTargetSemanticProjection(target),
            turnId: ""
          }
        : {
            // Preserve the v0.11.8 non-side-band material projection exactly.
            valid: target?.valid === true,
            reason: sanitizeText(target?.reason, 120),
            status: sanitizeText(target?.status, 80),
            next: sanitizeText(target?.next, 1600),
            nextActor: sanitizeText(target?.nextActor, 80),
            completionState: sanitizeText(target?.completionState, 80),
            turnId: sanitizeText(target?.turnId, 180)
          }
    },
    task: {
      taskFingerprint: sanitizeText(run?.taskFingerprint, 180),
      currentTurnId: materialCurrentTurnId,
      currentTurnEffectState: materialCurrentTurnEffectState,
      // Owner-controlled generation advances only for a material local control
      // change (for example an accepted Core Surface Review profile change).
      // Volatile UI timestamps and receipt ids remain deliberately excluded.
      materialControlGeneration: Math.max(0, Number(run?.materialControlGeneration || 0))
    },
    baseline: {
      accepted: facts?.baseline?.accepted === true,
      committed: facts?.baseline?.committed === true,
      readyVerified: facts?.baseline?.readyVerified === true
    },
    sessionInitState: sanitizeText(run?.sessionContextInit?.state, 80),
    effect: {
      // Control/protocol side-band transport is intentionally excluded from the
      // material effect identity. Only the latest non-side-band material effect
      // participates here.
      turnId: sanitizeText(facts?.effect?.materialEffectTurnId, 180),
      status: sanitizeText(facts?.effect?.materialEffectStatus, 80),
      materialTargetTransportPending: facts?.effect?.materialTargetTransportPending === true,
      materialTargetTransportAcked: facts?.effect?.materialTargetTransportAcked === true
    }
  });
}

/**
 * Stable identity for an AI-visible control wake.
 *
 * Unlike the full material decision input, this deliberately excludes the
 * mutable currentTurn/effect state because preparing the control continuation
 * itself changes those fields.  The key is bound to the observed assistant
 * response, owner-controlled material generation and the wait/action family.
 */
export function chatControlWakeKeyInput({
  run = {},
  observation = {},
  reasonCode = "WAIT_OWNER_EVENT",
  sourceActionId = ""
} = {}) {
  const sideBand = sideBandControlTurn(run);
  const normalizedReasonCode = sanitizeText(reasonCode, 160).toUpperCase();
  const localNoDeltaWake = normalizedReasonCode === "LOCAL_STATE_UNCHANGED";
  return stableStringify({
    runId: sanitizeText(run?.runId, 180),
    taskFingerprint: sanitizeText(run?.taskFingerprint, 180),
    materialControlGeneration: Math.max(0, Number(run?.materialControlGeneration || 0)),
    observationKey: localNoDeltaWake
      ? localRearmObservationKey(observation, run)
      : observationMaterialKey(observation, run),
    responseHash: sideBand || localNoDeltaWake
      ? ""
      : sanitizeText(observation?.responseHash, 128),
    reasonCode: normalizedReasonCode,
    sourceActionId: sanitizeText(sourceActionId, 120),
    localMaterialDigest: sanitizeText(
      localNoDeltaWake
        ? run?.localExecutionReceipt?.localRearmMaterialDigest
        : run?.localExecutionReceipt?.materialStateDigest,
      128
    )
  });
}

function localNanoRearmFamily(actionId = "") {
  const id = sanitizeText(actionId, 120).toUpperCase();
  if (id === MICRO_ACTION_IDS.READ_LOCAL_SESSION_STATE) return "LOCAL_STATE_READ";
  if ([MICRO_ACTION_IDS.REANALYZE_CURRENT_RESPONSE, MICRO_ACTION_IDS.REQUEUE_NANO].includes(id)) {
    return "NANO_RETRY";
  }
  return "";
}

/**
 * Decide whether a local action is allowed to create another Nano request.
 *
 * Core may perform a local read, but a new receipt is not itself progress.
 * Re-entry is allowed only when the observation/material decision input has
 * changed.  A terminal Nano-host failure additionally fences the exact failed
 * input so deterministic recovery cannot feed it straight back to Nano.
 */
export function evaluateLocalNanoRearm({
  actionId = "",
  observationKey = "",
  materialStateDigest = "",
  localRearmObservationKey: bridgeObservationKey = "",
  localRearmMaterialDigest: bridgeMaterialStateDigest = "",
  currentTurnKind = "",
  priorReceipt = null,
  failureFence = null
} = {}) {
  const family = localNanoRearmFamily(actionId);
  if (!family) {
    return { rearm: false, reason: "ACTION_DOES_NOT_REARM", rearmFamily: "" };
  }
  // Side-band semantic observation keys are bounded canonical structures and
  // may exceed the historical 500-character raw response-id ceiling. Keep the
  // complete bounded semantic key so a late substantive `EIC_NEXT` change is
  // not erased by truncation.
  const observation = sanitizeText(observationKey, 4000);
  const digest = sanitizeText(materialStateDigest, 128).toLowerCase();

  const fenceObservation = sanitizeText(failureFence?.observationKey, 4000);
  const fenceDigest = sanitizeText(failureFence?.materialStateDigest, 128).toLowerCase();
  if (observation && digest && observation === fenceObservation && digest === fenceDigest) {
    return {
      rearm: false,
      reason: "NANO_FAILURE_INPUT_UNCHANGED",
      rearmFamily: family
    };
  }

  const priorObservation = sanitizeText(
    priorReceipt?.sourceObservationKey ||
    priorReceipt?.sourceObservationHash ||
    priorReceipt?.sourceObservationId,
    4000
  );
  const priorDigest = sanitizeText(priorReceipt?.materialStateDigest, 128).toLowerCase();
  const priorFamily = sanitizeText(priorReceipt?.rearmFamily, 80).toUpperCase();

  const currentSideBand = SIDE_BAND_CONTROL_TURN_KINDS.includes(
    sanitizeText(currentTurnKind, 120).toUpperCase()
  );
  const priorTurnKind = sanitizeText(priorReceipt?.sourceTurnKind, 120).toUpperCase();
  const priorSideBand = SIDE_BAND_CONTROL_TURN_KINDS.includes(priorTurnKind);
  const bridgeObservation = sanitizeText(bridgeObservationKey, 4000);
  const bridgeDigest = sanitizeText(bridgeMaterialStateDigest, 128).toLowerCase();
  const priorBridgeObservation = sanitizeText(
    priorReceipt?.sourceLocalRearmObservationKey,
    4000
  );
  const priorBridgeDigest = sanitizeText(
    priorReceipt?.localRearmMaterialDigest,
    128
  ).toLowerCase();

  // v0.11.10 boundary bridge: the receipt immediately before the first
  // CHAT_CONTROL/PROTOCOL_REPAIR wake was written in the ordinary raw-response
  // namespace. Its child side-band response must not become MATERIAL_DELTA
  // solely because the representation changed. Apply the bridge only while the
  // current turn is side-band and the same local action family + semantic
  // material state remain exact. The bridge is deliberately one-way: once
  // the prior receipt is already side-band, ordinary v0.11.9 semantic keys
  // decide rearm so a substantive EIC_NEXT change remains material.
  if (currentSideBand && !priorSideBand &&
      bridgeObservation && bridgeDigest &&
      bridgeObservation === priorBridgeObservation &&
      bridgeDigest === priorBridgeDigest &&
      family === priorFamily) {
    return {
      rearm: false,
      reason: "LOCAL_STATE_UNCHANGED",
      rearmFamily: family
    };
  }

  if (observation && digest &&
      observation === priorObservation &&
      digest === priorDigest &&
      family === priorFamily) {
    return {
      rearm: false,
      reason: "LOCAL_STATE_UNCHANGED",
      rearmFamily: family
    };
  }

  return {
    rearm: true,
    reason: priorReceipt ? "MATERIAL_DELTA" : "FIRST_LOCAL_READ",
    rearmFamily: family
  };
}

function localStateReceiptProjection(receipt = null) {
  const value = receipt && typeof receipt === "object" ? receipt : {};
  return {
    sourceTurnKind: sanitizeText(value.sourceTurnKind, 120),
    sourceLocalRearmObservationKey: sanitizeText(
      value.sourceLocalRearmObservationKey,
      4000
    ),
    localRearmMaterialDigest: sanitizeText(
      value.localRearmMaterialDigest,
      128
    ).toLowerCase(),
    rearmFamily: sanitizeText(value.rearmFamily, 80),
    rearmReason: sanitizeText(value.rearmReason, 160),
    rearmAllowed: value.rearmAllowed === true
  };
}

/**
 * v0.11.11: one-shot bounded local-state/bridge diagnostic.
 *
 * This is an Agent-owned observability payload, not target-authored program
 * material. It intentionally excludes prompt bodies, free-form EIC_NEXT text,
 * credentials and arbitrary source content. The only response-derived fields
 * are the structured target-control class already used by the local rearm
 * bridge.
 */
export function buildLocalStateBridgeDiagnostic({
  run = {},
  observation = {},
  priorReceipt = null,
  currentReceipt = null,
  candidateWakeKey = "",
  candidateWakeGeneration = 0,
  createdAt = null
} = {}) {
  const facts = normalizedControllerFacts(run);
  const target = observation?.targetResult || {};
  const priorWake = run?.chatControlContinuationReceipt || {};
  return {
    schema: "eic.autonom.local-state-bridge-diagnostic.v1",
    diagnosticKey: "",
    actionId: sanitizeText(currentReceipt?.actionId, 120),
    priorReceipt: localStateReceiptProjection(priorReceipt),
    currentReceipt: localStateReceiptProjection(currentReceipt),
    targetResult: {
      valid: target?.valid === true,
      status: sanitizeText(target?.status, 80),
      nextActor: sanitizeText(target?.nextActor, 80),
      completionState: sanitizeText(target?.completionState, 80),
      fullStopReason: sanitizeText(target?.fullStopReason, 160)
    },
    materialControlGeneration: Math.max(0, Number(run?.materialControlGeneration || 0)),
    sessionContextInit: {
      needKey: sanitizeText(run?.sessionContextInit?.needKey, 300),
      state: sanitizeText(run?.sessionContextInit?.state, 80),
      catchResponseIdentity: sanitizeText(
        run?.sessionContextInit?.catchResponseIdentity,
        500
      )
    },
    materialEffect: {
      turnId: sanitizeText(facts?.effect?.materialEffectTurnId, 180),
      status: sanitizeText(facts?.effect?.materialEffectStatus, 80)
    },
    chatControlReceipt: {
      wakeKey: sanitizeText(priorWake?.wakeKey, 128).toLowerCase(),
      generation: Math.max(0, Number(priorWake?.generation || 0)),
      status: sanitizeText(priorWake?.status, 80)
    },
    candidateWake: {
      wakeKey: sanitizeText(candidateWakeKey, 128).toLowerCase(),
      generation: Math.max(0, Number(candidateWakeGeneration || 0))
    },
    capabilityBoundary: {
      agentCanReadLocalSessionState: true,
      agentCanCreateOrSelectIndependentFreshChatTarget: false,
      handoffActor: EIC_EXECUTION_ACTORS.EIC_AI_SESSION,
      instruction: agentLocalCapabilityBoundaryReason()
    },
    createdAt: sanitizeText(createdAt, 80) || null
  };
}

/**
 * Stable generation identity for the local-state diagnostic.
 *
 * Candidate wake generation and prior wake status are deliberately excluded:
 * they are transport/lifecycle effects of emitting the diagnostic itself and
 * must not create a new diagnostic generation. Genuine bridge material,
 * structured target class, local-control generation and init/material-effect
 * anchors remain included.
 */
export function localStateDiagnosticKeyInput(diagnostic = {}) {
  const value = diagnostic && typeof diagnostic === "object" ? diagnostic : {};
  return stableStringify({
    schema: sanitizeText(
      value.schema || "eic.autonom.local-state-bridge-diagnostic.v1",
      120
    ),
    actionId: sanitizeText(value.actionId, 120),
    currentReceipt: {
      sourceLocalRearmObservationKey: sanitizeText(
        value.currentReceipt?.sourceLocalRearmObservationKey,
        4000
      ),
      localRearmMaterialDigest: sanitizeText(
        value.currentReceipt?.localRearmMaterialDigest,
        128
      ).toLowerCase(),
      rearmFamily: sanitizeText(value.currentReceipt?.rearmFamily, 80),
      rearmReason: sanitizeText(value.currentReceipt?.rearmReason, 160),
      rearmAllowed: value.currentReceipt?.rearmAllowed === true
    },
    targetResult: {
      valid: value.targetResult?.valid === true,
      status: sanitizeText(value.targetResult?.status, 80),
      nextActor: sanitizeText(value.targetResult?.nextActor, 80),
      completionState: sanitizeText(value.targetResult?.completionState, 80),
      fullStopReason: sanitizeText(value.targetResult?.fullStopReason, 160)
    },
    materialControlGeneration: Math.max(
      0,
      Number(value.materialControlGeneration || 0)
    ),
    sessionContextInit: {
      needKey: sanitizeText(value.sessionContextInit?.needKey, 300),
      state: sanitizeText(value.sessionContextInit?.state, 80),
      catchResponseIdentity: sanitizeText(
        value.sessionContextInit?.catchResponseIdentity,
        500
      )
    },
    materialEffect: {
      turnId: sanitizeText(value.materialEffect?.turnId, 180),
      status: sanitizeText(value.materialEffect?.status, 80)
    }
  });
}

export function shouldEmitLocalStateDiagnostic({
  diagnosticKey = "",
  priorReceipt = null
} = {}) {
  const key = sanitizeText(diagnosticKey, 128).toLowerCase();
  const priorKey = sanitizeText(priorReceipt?.diagnosticKey, 128).toLowerCase();
  if (!key) return { emit: false, reason: "DIAGNOSTIC_KEY_MISSING" };
  if (priorKey && priorKey === key) {
    return {
      emit: false,
      reason: "LOCAL_STATE_DIAGNOSTIC_ALREADY_EMITTED"
    };
  }
  return {
    emit: true,
    reason: priorKey ? "NEW_LOCAL_STATE_GENERATION" : "FIRST_LOCAL_STATE_DIAGNOSTIC"
  };
}

/**
 * Build a bounded Agent-owned diagnostic for one terminal Nano failure.
 *
 * The diagnostic intentionally excludes prompt bodies, provider output,
 * credentials, hidden reasoning and arbitrary source content.
 */
export function buildNanoFailureDiagnostic({
  failureFence = null,
  nanoTelemetry = null,
  nanoHostTelemetry = null
} = {}) {
  const fence = failureFence && typeof failureFence === "object" ? failureFence : {};
  const telemetry = nanoTelemetry && typeof nanoTelemetry === "object" ? nanoTelemetry : {};
  const host = nanoHostTelemetry && typeof nanoHostTelemetry === "object" ? nanoHostTelemetry : {};

  return {
    schema: "eic.autonom.nano-failure-diagnostic.v1",
    requestId: sanitizeText(fence.requestId || telemetry.lastRequestId, 180),
    errorCode: sanitizeText(fence.errorCode || telemetry.lastErrorCode, 160),
    errorDetail: sanitizeText(fence.errorDetail || telemetry.lastError, 800),
    resultSummary: sanitizeText(fence.resultSummary || telemetry.lastResultSummary, 1200),
    inputDigest: sanitizeText(fence.inputDigest || telemetry.lastInputDigest, 128).toLowerCase(),
    observationKey: sanitizeText(fence.observationKey, 500),
    materialStateDigest: sanitizeText(fence.materialStateDigest, 128).toLowerCase(),
    taskAttempt: Math.max(0, Number(fence.taskAttempt || 0)),
    failedAt: sanitizeText(fence.at || telemetry.lastCompletedAt, 80) || null,
    host: {
      availability: sanitizeText(host.availability, 80) || "unknown",
      status: sanitizeText(host.status, 80) || "unknown",
      busy: host.busy === true,
      stale: host.stale === true,
      staleReason: sanitizeText(host.staleReason || telemetry.lastStaleReason, 160),
      reasonCode: sanitizeText(host.reasonCode, 160)
    }
  };
}

export function nanoFailureDiagnosticKeyInput(diagnostic = {}) {
  const value = diagnostic && typeof diagnostic === "object" ? diagnostic : {};
  return stableStringify({
    schema: sanitizeText(value.schema, 120),
    requestId: sanitizeText(value.requestId, 180),
    errorCode: sanitizeText(value.errorCode, 160),
    inputDigest: sanitizeText(value.inputDigest, 128).toLowerCase(),
    observationKey: sanitizeText(value.observationKey, 500),
    materialStateDigest: sanitizeText(value.materialStateDigest, 128).toLowerCase(),
    taskAttempt: Math.max(0, Number(value.taskAttempt || 0)),
    failedAt: sanitizeText(value.failedAt, 80)
  });
}

export function shouldEmitNanoFailureDiagnostic({
  diagnosticKey = "",
  priorReceipt = null
} = {}) {
  const key = sanitizeText(diagnosticKey, 128).toLowerCase();
  const priorKey = sanitizeText(priorReceipt?.diagnosticKey, 128).toLowerCase();
  if (!key) return { emit: false, reason: "DIAGNOSTIC_KEY_MISSING" };
  if (priorKey && priorKey === key) {
    return { emit: false, reason: "NANO_FAILURE_DIAGNOSTIC_ALREADY_EMITTED" };
  }
  return {
    emit: true,
    reason: priorKey ? "NEW_FAILURE_GENERATION" : "FIRST_FAILURE_DIAGNOSTIC"
  };
}

