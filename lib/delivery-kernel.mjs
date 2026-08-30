import {
  deepClone,
  normalizeWhitespace,
  sanitizeText,
  sha256Hex,
  stableStringify
} from "./common.mjs";

export const DELIVERY_KERNEL_SCHEMA = "eic.autonom.delivery-kernel.v1";
export const CONTEXT_ROUTER_SCHEMA = "eic.autonom.context-router.v1";

export const EVIDENCE_CLASSES = Object.freeze({
  OWNER_LIVE: "OWNER_LIVE",
  OWNER_RECEIPT: "OWNER_RECEIPT",
  OWNER_HISTORICAL: "OWNER_HISTORICAL",
  DERIVED_VIEW: "DERIVED_VIEW",
  LOCAL_CANDIDATE: "LOCAL_CANDIDATE",
  ROUTING_CONTEXT: "ROUTING_CONTEXT",
  DRY_RUN: "DRY_RUN"
});

export const COMPLETION_STATES = Object.freeze({
  UNIT_DONE: "UNIT_DONE",
  MILESTONE_CONTINUE: "MILESTONE_CONTINUE",
  PROGRAM_BLOCKED: "PROGRAM_BLOCKED",
  PROGRAM_DONE: "PROGRAM_DONE"
});

export const ADMISSION_CAPABILITIES = Object.freeze([
  "CAN_EDIT",
  "CAN_TEST",
  "CAN_PERSIST",
  "CAN_PUBLISH",
  "CAN_INSTALL",
  "CAN_READ_BACK"
]);

export const SENSITIVE_TRANSPORT_KEYS = Object.freeze([
  "session_locator",
  "sessionLocator",
  "lock_token",
  "lockToken",
  "confirmation_token",
  "confirmationToken",
  "preflight_receipt",
  "preflightReceipt",
  "credential_ref",
  "credentialRef",
  "secret_ref",
  "secretRef"
]);

const SENSITIVE_KEY_PATTERN = /(?:session[_-]?locator|lock[_-]?token|confirmation[_-]?token|preflight[_-]?receipt|credential[_-]?ref|secret[_-]?ref|authorization|cookie|password|api[_-]?key|access[_-]?token|refresh[_-]?token)/iu;
const HANDLE_PREFIX = "$EIC_SECRET_HANDLE_";

function normalized(value) {
  return normalizeWhitespace(String(value ?? "").normalize("NFKC")).toLocaleLowerCase("sv");
}

function toList(value, max = 8) {
  return (Array.isArray(value) ? value : [])
    .map((item) => sanitizeText(typeof item === "string" ? item : item?.locator || item?.id || item?.text, 800))
    .filter(Boolean)
    .slice(0, max);
}

function assertRequired(value, field) {
  const text = sanitizeText(value, 3000);
  if (!text) throw new TypeError(`DELIVERY_FIELD_REQUIRED:${field}`);
  return text;
}

export function redactSensitiveTransport(value, {
  handlePrefix = HANDLE_PREFIX,
  maxDepth = 8
} = {}) {
  const handles = new Map();
  let counter = 0;
  const redact = (input, key = "", depth = 0) => {
    if (depth > maxDepth) return "[TRUNCATED]";
    if (SENSITIVE_KEY_PATTERN.test(String(key || ""))) {
      const canonical = typeof input === "string" ? input : stableStringify(input);
      if (!handles.has(canonical)) handles.set(canonical, `${handlePrefix}${++counter}`);
      return handles.get(canonical);
    }
    if (input === null || input === undefined) return input ?? null;
    if (typeof input === "string") {
      return input
        .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]{8,}\b/giu, "[REDACTED_AUTH]")
        .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu, "[REDACTED_JWT]");
    }
    if (typeof input === "number" || typeof input === "boolean") return input;
    if (Array.isArray(input)) return input.slice(0, 200).map((item) => redact(item, key, depth + 1));
    if (typeof input === "object") {
      const output = {};
      for (const [childKey, childValue] of Object.entries(input).slice(0, 200)) {
        output[childKey] = redact(childValue, childKey, depth + 1);
      }
      return output;
    }
    return sanitizeText(String(input), 2000);
  };
  return {
    value: redact(value),
    redactedCount: handles.size,
    handles: [...handles.values()]
  };
}

export function classifyEvidence({
  sourceClass = "",
  ownerSurface = "",
  locator = "",
  readback = false,
  current = false,
  durableEffect = false,
  dryRun = false,
  localOnly = false,
  routingOnly = false
} = {}) {
  if (dryRun) return EVIDENCE_CLASSES.DRY_RUN;
  if (routingOnly) return EVIDENCE_CLASSES.ROUTING_CONTEXT;
  if (localOnly) return EVIDENCE_CLASSES.LOCAL_CANDIDATE;
  const hasOwner = Boolean(sanitizeText(ownerSurface, 240) && sanitizeText(locator, 600));
  if (hasOwner && readback && durableEffect) return EVIDENCE_CLASSES.OWNER_RECEIPT;
  if (hasOwner && readback && current) return EVIDENCE_CLASSES.OWNER_LIVE;
  if (hasOwner && readback) return EVIDENCE_CLASSES.OWNER_HISTORICAL;
  if (String(sourceClass || "").toUpperCase() === "OWNER") return EVIDENCE_CLASSES.OWNER_HISTORICAL;
  return EVIDENCE_CLASSES.DERIVED_VIEW;
}

export function assertEvidenceClassForClaim(evidenceClass, {
  currentClaim = false,
  effectClaim = false
} = {}) {
  const value = String(evidenceClass || "");
  if (effectClaim && value !== EVIDENCE_CLASSES.OWNER_RECEIPT) {
    throw new Error("OWNER_RECEIPT_REQUIRED");
  }
  if (currentClaim && ![EVIDENCE_CLASSES.OWNER_LIVE, EVIDENCE_CLASSES.OWNER_RECEIPT].includes(value)) {
    throw new Error("OWNER_LIVE_REQUIRED");
  }
  return true;
}

export function createAdmissionChain(value = {}) {
  const chain = {};
  for (const capability of ADMISSION_CAPABILITIES) {
    const source = value?.[capability];
    chain[capability] = {
      available: source === true || source?.available === true,
      owner: sanitizeText(source?.owner, 240),
      locator: sanitizeText(source?.locator, 600),
      reason: sanitizeText(source?.reason, 600)
    };
  }
  return Object.freeze(chain);
}

export function assertAdmissionChain(chain, required = []) {
  const normalizedChain = createAdmissionChain(chain);
  const missing = (Array.isArray(required) ? required : [])
    .filter((name) => ADMISSION_CAPABILITIES.includes(name))
    .filter((name) => normalizedChain[name].available !== true);
  return {
    allowed: missing.length === 0,
    missing,
    chain: normalizedChain,
    reason: missing.length ? `ADMISSION_CAPABILITY_MISSING:${missing.join(",")}` : "ADMISSION_READY"
  };
}


export const DELIVERY_REGULATOR_DISPOSITIONS = Object.freeze({
  ALLOW: "ALLOW",
  WAIT_FOR_NEW_EVIDENCE: "WAIT_FOR_NEW_EVIDENCE"
});

/**
 * Completes the delivery contract for deterministic, turn-bound CONTINUE decisions.
 *
 * A concrete low-risk continuation is a direct program delta. A continuation that
 * cannot proceed until Hjalmar's local control has a fresh owner read is admitted as
 * the single required control action only when the omission failure and unlock are
 * explicit. Target text remains continuation data and is not promoted to owner proof.
 */
export function deriveContinuationDeliveryContract({
  requestedAction = "",
  targetStatus = "",
  controlVerdict = "",
  exactTarget = "",
  ownerRoute = ""
} = {}) {
  const action = sanitizeText(requestedAction, 5000);
  const status = String(targetStatus || "").toUpperCase();
  const control = String(controlVerdict || "").toUpperCase();
  const target = sanitizeText(exactTarget, 1600) || "det exakta målet";
  const owner = sanitizeText(ownerRoute, 1200) || "den exakta owner-rutten";

  if (status !== "CONTINUE" || !action) {
    return Object.freeze({
      directProgramDelta: 0,
      requiredControl: false,
      omissionFailure: "",
      unlocksNextAction: "",
      boundedStop: true,
      deliveryClass: "NON_DELIVERY"
    });
  }

  if (control === "READ_REQUIRED") {
    return Object.freeze({
      directProgramDelta: 0,
      requiredControl: true,
      omissionFailure: sanitizeText(
        `Utan en färsk route-native owner-read via ${owner} för ${target} kan nästa effekt inte verifieras eller utföras säkert.`,
        1600
      ),
      unlocksNextAction: action,
      boundedStop: false,
      deliveryClass: "REQUIRED_OWNER_CONTROL"
    });
  }

  return Object.freeze({
    directProgramDelta: 1,
    requiredControl: false,
    omissionFailure: "",
    unlocksNextAction: "",
    boundedStop: false,
    deliveryClass: "DIRECT_PROGRAM_DELTA"
  });
}

/**
 * Converts a rejected delivery gate into a stable wait, never an auto-recoverable pause.
 * The caller must consume the current response identity before persisting the wait.
 */
export function resolveDeliveryRegulatorDisposition({
  action = "",
  gate = {},
  protocolRepairOnly = false,
  observationId = "",
  responseIdentity = "",
  requestedAction = "",
  workUnit = "",
  ownerRoute = "",
  omissionFailure = "",
  unlocksNextAction = ""
} = {}) {
  if (String(action || "").toUpperCase() !== "CONTINUE" ||
      gate?.allowed === true ||
      protocolRepairOnly === true) {
    return Object.freeze({
      disposition: DELIVERY_REGULATOR_DISPOSITIONS.ALLOW,
      consumeObservation: false,
      wait: null
    });
  }

  const unlock = sanitizeText(unlocksNextAction || requestedAction, 1600);
  const failure = sanitizeText(
    omissionFailure ||
      "Den aktuella processgrenen saknar både ett direkt programdelta och en komplett owner-/säkerhetsåtgärd.",
    1600
  );
  return Object.freeze({
    disposition: DELIVERY_REGULATOR_DISPOSITIONS.WAIT_FOR_NEW_EVIDENCE,
    consumeObservation: true,
    wait: Object.freeze({
      schema: "eic.autonom.delivery-wait.v1",
      status: "WAITING_OWNER_EVIDENCE",
      reason: sanitizeText(gate?.reason || "DIRECT_PROGRAM_DELTA_ZERO", 160),
      workClass: sanitizeText(gate?.workClass || "NON_DELIVERY", 160),
      observationId: sanitizeText(observationId, 160),
      responseIdentity: sanitizeText(responseIdentity, 160),
      requestedAction: sanitizeText(requestedAction, 1600),
      workUnit: sanitizeText(workUnit, 1200),
      ownerRoute: sanitizeText(ownerRoute, 1200),
      omissionFailure: failure,
      unlocksNextAction: unlock,
      requiresNewResponseIdentity: true
    })
  });
}

export function evaluateDirectProgramDelta({
  primaryProgramGoal,
  activeMilestone,
  boundedCurrentUnit,
  proposedAction,
  directProgramDelta = 0,
  requiredOwnerAction = false,
  requiredSafetyAction = false,
  omissionFailure = "",
  unlocksNextAction = ""
} = {}) {
  const focus = Object.freeze({
    primaryProgramGoal: assertRequired(primaryProgramGoal, "PRIMARY_PROGRAM_GOAL"),
    activeMilestone: assertRequired(activeMilestone, "ACTIVE_MILESTONE"),
    boundedCurrentUnit: assertRequired(boundedCurrentUnit, "BOUNDED_CURRENT_UNIT"),
    proposedAction: assertRequired(proposedAction, "PROPOSED_ACTION")
  });
  const delta = Math.max(0, Math.min(3, Number(directProgramDelta) || 0));
  const requiredControl = Boolean(requiredOwnerAction || requiredSafetyAction);
  const exactUnlock = sanitizeText(unlocksNextAction, 1600);
  const failure = sanitizeText(omissionFailure, 1600);

  if (delta > 0) {
    return {
      allowed: true,
      workClass: "CORE_DELIVERY",
      reason: "DIRECT_PROGRAM_DELTA",
      directProgramDelta: delta,
      focus
    };
  }
  if (requiredControl && failure && exactUnlock) {
    return {
      allowed: true,
      workClass: "REQUIRED_OWNER_OR_SAFETY",
      reason: "REQUIRED_CONTROL_UNLOCKS_DELIVERY",
      directProgramDelta: 0,
      omissionFailure: failure,
      unlocksNextAction: exactUnlock,
      focus
    };
  }
  return {
    allowed: false,
    workClass: "NON_DELIVERY",
    reason: "DIRECT_PROGRAM_DELTA_ZERO",
    directProgramDelta: 0,
    disposition: "BOUNDED_STOP",
    focus
  };
}

export function resolveCompletionState({
  unitDone = false,
  milestoneDone = false,
  programDone = false,
  blocked = false,
  nextAction = "",
  completionEvidence = ""
} = {}) {
  const evidence = sanitizeText(completionEvidence, 1600);
  const next = sanitizeText(nextAction, 1600);
  if (programDone === true && !next && evidence) {
    return Object.freeze({
      unitState: unitDone ? COMPLETION_STATES.UNIT_DONE : "UNIT_NOT_DECLARED",
      programState: COMPLETION_STATES.PROGRAM_DONE,
      autonomy: "DONE",
      terminal: true,
      nextAction: ""
    });
  }
  if (blocked === true) {
    return Object.freeze({
      unitState: unitDone ? COMPLETION_STATES.UNIT_DONE : "UNIT_INCOMPLETE",
      programState: COMPLETION_STATES.PROGRAM_BLOCKED,
      autonomy: "CONTINUE",
      terminal: false,
      nextAction: next
    });
  }
  return Object.freeze({
    unitState: unitDone ? COMPLETION_STATES.UNIT_DONE : "UNIT_CONTINUE",
    milestoneState: milestoneDone ? "MILESTONE_DONE" : COMPLETION_STATES.MILESTONE_CONTINUE,
    programState: COMPLETION_STATES.MILESTONE_CONTINUE,
    autonomy: "CONTINUE",
    terminal: false,
    nextAction: next
  });
}

export function createProgressiveContextRouter({
  activeTaskBinding = null,
  primaryProgramGoal = "",
  activeMilestone = "",
  boundedCurrentUnit = "",
  mandate = null,
  ownerEvidence = [],
  blockers = [],
  nextDirection = "",
  responseHash = "",
  observationAnchors = [],
  requestedSections = []
} = {}) {
  const stable = {
    activeTaskBinding: activeTaskBinding ? deepClone(activeTaskBinding) : null,
    primaryProgramGoal: sanitizeText(primaryProgramGoal, 2400),
    activeMilestone: sanitizeText(activeMilestone, 1200),
    boundedCurrentUnit: sanitizeText(boundedCurrentUnit, 1600),
    mandate: mandate && typeof mandate === "object"
      ? {
          version: sanitizeText(mandate.version, 160),
          sha256: sanitizeText(mandate.sha256, 96),
          ref: sanitizeText(mandate.ref, 400)
        }
      : null
  };
  const delta = {
    ownerEvidence: toList(ownerEvidence, 6),
    blockers: toList(blockers, 4),
    nextDirection: sanitizeText(nextDirection, 1200),
    responseHash: sanitizeText(responseHash, 128),
    observationAnchors: toList(observationAnchors, 6)
  };
  const requested = [...new Set((Array.isArray(requestedSections) ? requestedSections : [])
    .map((item) => sanitizeText(item, 80).toUpperCase())
    .filter(Boolean))].slice(0, 6);
  return {
    schema: CONTEXT_ROUTER_SCHEMA,
    version: 1,
    stable,
    delta,
    progressiveDisclosure: {
      default: "REFERENCE_PLUS_DELTA",
      requestedSections: requested,
      fullAssistantProseIncluded: false,
      fullConversationIncluded: false
    }
  };
}

export async function buildProgressiveContextRouter(input = {}) {
  const router = createProgressiveContextRouter(input);
  return Object.freeze({
    ...router,
    digest: await sha256Hex(stableStringify(router))
  });
}

export function compactRouterForPrompt(router) {
  const redacted = redactSensitiveTransport(router).value;
  return {
    schema: redacted.schema,
    digest: redacted.digest,
    stable: redacted.stable,
    delta: redacted.delta,
    progressiveDisclosure: redacted.progressiveDisclosure
  };
}

export function equivalentActionFingerprint(value) {
  return normalized(value)
    .replace(/\b(?:verify|read|inspect|review|audit|check|proba|läs|granska|kontrollera)\b/giu, "inspect")
    .replace(/\s+/gu, " ")
    .trim();
}
