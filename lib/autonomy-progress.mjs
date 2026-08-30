import {
  deepClone,
  normalizeWhitespace,
  nowIso,
  sanitizeText,
  sha256Hex,
  stableStringify
} from "./common.mjs";

export const OBSERVATION_LOOP_SCHEMA = "eic.autonom.observation-loop.v1";
export const NON_PROGRESS_LIMIT = 2;
export const POST_CUTOFF_ACTIONS = Object.freeze([
  "BOUNDED_OWNER_READ",
  "SUBSYSTEM_PIVOT",
  "BOUNDED_STOP"
]);

const VOLATILE_KEYS = new Set([
  "id", "observationId", "requestId", "receiptId", "contextId", "twinCaseId",
  "generation", "observedAt", "createdAt", "updatedAt", "timestamp", "at",
  "responseHash", "responseIdentity", "stateRevision", "wordingRevision"
]);

function assertExactKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} måste vara ett objekt.`);
  }
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new TypeError(`${label} innehåller okända fält: ${unknown.join(", ")}`);
}

function normalizeSemanticText(value) {
  return normalizeWhitespace(String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("sv")
    .replace(/[’‘`´]/g, "'")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[\p{P}\p{S}]+/gu, " "));
}

function normalizeLocator(value) {
  return normalizeWhitespace(String(value ?? "").normalize("NFKC").toLocaleLowerCase("sv"));
}

export function normalizeObservationValue(value, { key = "" } = {}) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    return /(?:locator|owner|route|path|url|ref|sha|digest|hash)$/i.test(key)
      ? normalizeLocator(value)
      : normalizeSemanticText(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const normalized = value
      .map((entry) => normalizeObservationValue(entry, { key }))
      .filter((entry) => entry !== null && entry !== "" && stableStringify(entry) !== "{}");
    return [...new Map(normalized.map((entry) => [stableStringify(entry), entry])).values()]
      .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  }
  if (typeof value === "object") {
    const result = {};
    for (const childKey of Object.keys(value).sort()) {
      if (VOLATILE_KEYS.has(childKey)) continue;
      const normalized = normalizeObservationValue(value[childKey], { key: childKey });
      if (normalized === null || normalized === "" || stableStringify(normalized) === "{}") continue;
      result[childKey] = normalized;
    }
    return result;
  }
  return normalizeSemanticText(value);
}

export async function computeObservationIdentity(input = {}) {
  assertExactKeys(input, new Set([
    "stableGoal", "activeWorkUnit", "ownerLocators", "claimBoundary", "observation"
  ]), "observation identity input");
  const canonical = {
    stableGoal: normalizeSemanticText(input.stableGoal),
    activeWorkUnit: normalizeSemanticText(input.activeWorkUnit),
    ownerLocators: normalizeObservationValue(input.ownerLocators || [], { key: "ownerLocators" }),
    claimBoundary: normalizeObservationValue(input.claimBoundary || {}, { key: "claimBoundary" }),
    observation: normalizeObservationValue(input.observation || {}, { key: "observation" })
  };
  if (!canonical.stableGoal) throw new TypeError("stableGoal krävs.");
  if (!canonical.activeWorkUnit) throw new TypeError("activeWorkUnit krävs.");
  if (!canonical.ownerLocators.length) throw new TypeError("Minst en ownerLocator krävs.");
  return `obs-sha256:${await sha256Hex(stableStringify(canonical))}`;
}

function referencesFor(identity) {
  const suffix = String(identity || "").replace(/^obs-sha256:/, "").slice(0, 24);
  if (!suffix) throw new TypeError("Giltig observation identity krävs.");
  return Object.freeze({
    observationRef: `observation:${suffix}`,
    contextRef: `context:${suffix}`,
    twinRef: `twin:${suffix}`,
    receiptRef: `receipt:${suffix}`
  });
}

export function createObservationLoopState(value = {}) {
  const source = value && typeof value === "object" ? deepClone(value) : {};
  return {
    schema: OBSERVATION_LOOP_SCHEMA,
    identity: sanitizeText(source.identity, 96),
    references: source.references && typeof source.references === "object"
      ? { ...source.references }
      : null,
    uniqueObservationCount: Math.max(0, Number(source.uniqueObservationCount || 0)),
    duplicateObservationCount: Math.max(0, Number(source.duplicateObservationCount || 0)),
    consecutiveNoProgress: Math.max(0, Number(source.consecutiveNoProgress || 0)),
    lastProgressFingerprint: sanitizeText(source.lastProgressFingerprint, 2000),
    cutoffIdentity: sanitizeText(source.cutoffIdentity, 96),
    cutoffEmittedAt: source.cutoffEmittedAt || null,
    postCutoffAction: source.postCutoffAction || null,
    postCutoffActionAt: source.postCutoffActionAt || null,
    activationKey: sanitizeText(source.activationKey, 256),
    activationCount: Math.max(0, Number(source.activationCount || 0)),
    lastVerdict: sanitizeText(source.lastVerdict, 80) || "UNSEEN",
    updatedAt: source.updatedAt || null
  };
}

export function registerObservationIdentity(stateValue, input = {}) {
  assertExactKeys(input, new Set(["identity", "now"]), "register observation input");
  const state = createObservationLoopState(stateValue);
  const identity = sanitizeText(input.identity, 96);
  if (!/^obs-sha256:[a-f0-9]{64}$/.test(identity)) throw new TypeError("Ogiltig observation identity.");
  const same = state.identity === identity && state.references;
  if (same) {
    state.duplicateObservationCount += 1;
  } else {
    state.identity = identity;
    state.references = referencesFor(identity);
    state.uniqueObservationCount += 1;
  }
  state.updatedAt = nowIso(input.now ?? Date.now());
  const cutoffBlocksGrounding = Boolean(state.cutoffIdentity === identity && state.cutoffEmittedAt);
  return {
    state,
    identity,
    duplicate: Boolean(same),
    references: { ...state.references },
    objectsCreated: same ? 0 : 3,
    canStartGrounding: !cutoffBlocksGrounding
  };
}

function normalizeProgressInput(input) {
  assertExactKeys(input, new Set([
    "identity", "ownerEvidence", "artifacts", "stateTransitions", "delivery", "now"
  ]), "observation cycle input");
  const transitions = (Array.isArray(input.stateTransitions) ? input.stateTransitions : [])
    .filter((entry) => {
      if (!entry || typeof entry !== "object") return Boolean(entry);
      return normalizeSemanticText(entry.from) !== normalizeSemanticText(entry.to);
    });
  return normalizeObservationValue({
    ownerEvidence: input.ownerEvidence || [],
    artifacts: input.artifacts || [],
    stateTransitions: transitions,
    delivery: input.delivery || []
  });
}

export function recordObservationCycle(stateValue, input = {}) {
  const state = createObservationLoopState(stateValue);
  const identity = sanitizeText(input.identity, 96);
  if (!identity || identity !== state.identity) throw new TypeError("Cykeln måste matcha registrerad observation identity.");
  const progress = normalizeProgressInput(input);
  const fingerprint = stableStringify(progress);
  const hasMaterialSignal = Object.values(progress || {}).some((value) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value)
  );
  const freshProgress = hasMaterialSignal && fingerprint !== state.lastProgressFingerprint;
  const now = input.now ?? Date.now();

  if (freshProgress) {
    state.consecutiveNoProgress = 0;
    state.lastProgressFingerprint = fingerprint;
    state.cutoffIdentity = "";
    state.cutoffEmittedAt = null;
    state.postCutoffAction = null;
    state.postCutoffActionAt = null;
    state.lastVerdict = "PROGRESS";
  } else {
    state.consecutiveNoProgress += 1;
    if (state.consecutiveNoProgress >= NON_PROGRESS_LIMIT) {
      state.cutoffIdentity = identity;
      state.cutoffEmittedAt ||= nowIso(now);
      state.lastVerdict = "NON_PROGRESSING_LOOP";
    } else {
      state.lastVerdict = "CONTINUE_MONITOR";
    }
  }
  state.updatedAt = nowIso(now);
  return {
    state,
    verdict: state.lastVerdict,
    freshProgress,
    consecutiveNoProgress: state.consecutiveNoProgress,
    canStartAnotherGrounding: !(state.cutoffIdentity === identity && state.cutoffEmittedAt),
    postCutoffActionRequired: state.lastVerdict === "NON_PROGRESSING_LOOP" && !state.postCutoffAction
  };
}

export function consumePostCutoffAction(stateValue, input = {}) {
  assertExactKeys(input, new Set(["identity", "action", "now"]), "post-cutoff action input");
  const state = createObservationLoopState(stateValue);
  const identity = sanitizeText(input.identity, 96);
  const action = String(input.action || "").toUpperCase();
  if (state.cutoffIdentity !== identity || !state.cutoffEmittedAt) {
    return { state, allowed: false, reason: "NON_PROGRESSING_LOOP_NOT_ACTIVE" };
  }
  if (!POST_CUTOFF_ACTIONS.includes(action)) {
    throw new TypeError(`Otillåten post-cutoff action: ${action || "EMPTY"}`);
  }
  if (state.postCutoffAction) {
    return { state, allowed: false, reason: "POST_CUTOFF_ACTION_ALREADY_CONSUMED" };
  }
  state.postCutoffAction = action;
  state.postCutoffActionAt = nowIso(input.now ?? Date.now());
  state.updatedAt = state.postCutoffActionAt;
  return { state, allowed: true, reason: "POST_CUTOFF_ACTION_CONSUMED", action };
}

export async function computeNanoActivationKey(input = {}) {
  assertExactKeys(input, new Set(["trustedSession", "version", "binding"]), "Nano activation input");
  const canonical = normalizeObservationValue({
    trustedSession: input.trustedSession,
    version: input.version,
    binding: input.binding
  });
  if (!canonical.trustedSession || !canonical.version || !canonical.binding) {
    throw new TypeError("trustedSession, version och binding krävs.");
  }
  return `nano-activation:${await sha256Hex(stableStringify(canonical))}`;
}

export function registerNanoActivation(stateValue, input = {}) {
  assertExactKeys(input, new Set(["activationKey", "now"]), "Nano activation registration");
  const state = createObservationLoopState(stateValue);
  const key = sanitizeText(input.activationKey, 256);
  if (!/^nano-activation:[a-f0-9]{64}$/.test(key)) throw new TypeError("Ogiltig Nano activation key.");
  const reused = state.activationKey === key;
  if (!reused) {
    state.activationKey = key;
    state.activationCount += 1;
  }
  state.updatedAt = nowIso(input.now ?? Date.now());
  return { state, activate: !reused, reused };
}

export function resolveProgramTerminality(input = {}) {
  assertExactKeys(input, new Set([
    "subtaskDone", "stableGoalComplete", "programNextAction", "completionEvidence"
  ]), "terminality input");
  const nextAction = sanitizeText(input.programNextAction, 5000);
  const evidence = sanitizeText(input.completionEvidence, 1600);
  const terminal = input.stableGoalComplete === true && !nextAction && Boolean(evidence);
  if (terminal) {
    return {
      subtask: input.subtaskDone === true ? "SUBTASK_DONE" : "SUBTASK_NOT_DECLARED",
      program: "PROGRAM_DONE",
      eicAutonomy: "DONE",
      nextAction: "",
      terminal: true
    };
  }
  return {
    subtask: input.subtaskDone === true ? "SUBTASK_DONE" : "SUBTASK_CONTINUE",
    program: "PROGRAM_CONTINUE",
    eicAutonomy: "CONTINUE",
    nextAction,
    terminal: false
  };
}

export function scoreTwinnedFixtures(input = {}) {
  assertExactKeys(input, new Set(["blockPass", "emitPass"]), "twin score input");
  const blockPass = input.blockPass === true;
  const emitPass = input.emitPass === true;
  return {
    covered: blockPass && emitPass,
    classification: blockPass && emitPass
      ? "TWINNED_UTILITY_COVERED"
      : blockPass
        ? "BLOCK_ONLY_DISCRIMINATING_POWER_UNVERIFIED"
        : emitPass
          ? "EMIT_ONLY_DISCRIMINATING_POWER_UNVERIFIED"
          : "NOT_COVERED"
  };
}

export function createDecisionCapsule(input = {}) {
  assertExactKeys(input, new Set([
    "verdict", "reason", "consequence", "nextAction", "locators"
  ]), "Decision Capsule input");
  const locators = (Array.isArray(input.locators) ? input.locators : [])
    .map((item) => sanitizeText(item, 400))
    .filter(Boolean);
  if (locators.length > 2) throw new RangeError("Decision Capsule tillåter högst två locatorer.");
  return Object.freeze({
    verdict: sanitizeText(input.verdict, 160),
    reason: sanitizeText(input.reason, 1200),
    consequence: sanitizeText(input.consequence, 1200),
    nextAction: sanitizeText(input.nextAction, 1200),
    locators
  });
}
