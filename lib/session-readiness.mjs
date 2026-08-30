import { nowIso, sanitizeText } from "./common.mjs";

/**
 * "Starta Ny Session" must not act until the ChatGPT/EIC session is really up.
 *
 * v0.6.3 accepted the first probe where `composerFound && !generating` and then
 * submitted immediately. A ChatGPT SPA reports a composer during hydration, before
 * the conversation surface, the send control and the document epoch are stable, so
 * the one-shot start prompt could be delivered into a half-initialised session.
 *
 * This module is pure and deterministic:
 *   1. `evaluateNewSessionReadiness` judges a single DOM probe.
 *   2. `advanceReadinessStability` requires N consecutive good probes with an
 *      unchanged document epoch, url and conversation locator.
 *   3. The `sessionInitGate` state machine keeps autonomous dispatch suspended
 *      until the start prompt is acknowledged AND the session has produced its
 *      first complete response.
 */

export const SESSION_INIT_STATES = Object.freeze({
  PENDING_TAB_READY: "PENDING_TAB_READY",
  PENDING_COMPOSER_STABLE: "PENDING_COMPOSER_STABLE",
  PENDING_PROMPT_ACK: "PENDING_PROMPT_ACK",
  PENDING_FIRST_RESPONSE: "PENDING_FIRST_RESPONSE",
  INITIALIZED: "INITIALIZED",
  FAILED_TIMEOUT: "FAILED_TIMEOUT"
});

export const READINESS_DEFAULTS = Object.freeze({
  requiredStableProbes: 3,
  probeIntervalMs: 400,
  timeoutMs: 45_000,
  contentVersion: ""
});

/**
 * @returns {{ready:boolean, reasons:string[], identity:string}}
 */
export function evaluateNewSessionReadiness(page, {
  requireEmptyConversation = true,
  expectedContentVersion = "",
  allowBusy = false,
  requireSendControl = false
} = {}) {
  const reasons = [];
  if (!page || page.ok === false) {
    return { ready: false, reasons: ["NO_PAGE_STATE"], identity: "" };
  }
  if (!page.supported) reasons.push("PAGE_NOT_SUPPORTED");
  if (!page.composerFound) reasons.push("COMPOSER_MISSING");
  // ChatGPT may render the send control only after text has been inserted. Prepared-session
  // readiness therefore proves the composer/bridge/document identity, while submitPrompt()
  // owns the post-insertion send-button/Enter fallback. Keep the old signal available only
  // for explicit diagnostics; it is not a default prefill gate.
  if (requireSendControl && page.sendFound === false) reasons.push("SEND_CONTROL_MISSING");
  if (!allowBusy && page.generating) reasons.push("GENERATION_IN_PROGRESS");
  if (!allowBusy && page.backgroundSignals?.active) reasons.push("BACKGROUND_WORK_ACTIVE");
  if (!sanitizeText(page.documentEpoch, 180)) reasons.push("DOCUMENT_EPOCH_MISSING");
  if (expectedContentVersion && sanitizeText(page.version, 40) !== sanitizeText(expectedContentVersion, 40)) {
    reasons.push("CONTENT_BRIDGE_VERSION_MISMATCH");
  }
  if (requireEmptyConversation &&
      (Number(page.assistantCount || 0) > 0 || Number(page.userCount || 0) > 0)) {
    reasons.push("CONVERSATION_NOT_EMPTY");
  }
  return {
    ready: reasons.length === 0,
    reasons,
    identity: [
      sanitizeText(page.url, 500),
      sanitizeText(page.documentEpoch, 180),
      sanitizeText(page.conversationKey, 300)
    ].join("|")
  };
}

/**
 * Folds one probe into a stability accumulator. Any changed identity or failed
 * probe resets the streak, so a session that re-navigates during hydration cannot
 * be mistaken for a settled one.
 */
export function advanceReadinessStability(previous, page, {
  requiredStableProbes = READINESS_DEFAULTS.requiredStableProbes,
  requireEmptyConversation = true,
  expectedContentVersion = "",
  allowBusy = false,
  requireSendControl = false
} = {}) {
  const required = Math.max(1, Number(requiredStableProbes) || READINESS_DEFAULTS.requiredStableProbes);
  const evaluation = evaluateNewSessionReadiness(page, {
    requireEmptyConversation,
    expectedContentVersion,
    allowBusy,
    requireSendControl
  });
  if (!evaluation.ready) {
    return {
      stableProbes: 0,
      identity: evaluation.identity,
      settled: false,
      lastReasons: evaluation.reasons,
      required
    };
  }
  const sameIdentity = previous?.identity === evaluation.identity;
  const stableProbes = sameIdentity ? Number(previous?.stableProbes || 0) + 1 : 1;
  return {
    stableProbes,
    identity: evaluation.identity,
    settled: stableProbes >= required,
    lastReasons: [],
    required
  };
}

export function createSessionInitGate({
  mode = "NEW_SESSION",
  state = SESSION_INIT_STATES.PENDING_TAB_READY,
  now = Date.now(),
  timeoutMs = READINESS_DEFAULTS.timeoutMs,
  detail = ""
} = {}) {
  return {
    schema: "eic.session.init.gate.v1",
    mode,
    state,
    detail: sanitizeText(detail, 600),
    openedAt: nowIso(now),
    updatedAt: nowIso(now),
    initializedAt: null,
    stableProbes: 0,
    timeoutMs: Math.max(5_000, Number(timeoutMs) || READINESS_DEFAULTS.timeoutMs),
    lastReasons: []
  };
}

/**
 * A missing gate means a legacy run created before v0.6.4: it is treated as
 * already initialised so an upgrade never freezes an in-flight run.
 */
export function sessionInitHoldsAutonomy(gate) {
  if (!gate || typeof gate !== "object") return false;
  return ![SESSION_INIT_STATES.INITIALIZED, SESSION_INIT_STATES.FAILED_TIMEOUT].includes(gate.state);
}

export function sessionInitBlocksDispatch(gate) {
  if (!gate || typeof gate !== "object") return false;
  // The prompt-ack phase is exactly the one-shot start delivery, which must be
  // allowed through; every other pending phase blocks new prompt dispatch.
  return sessionInitHoldsAutonomy(gate) && gate.state !== SESSION_INIT_STATES.PENDING_PROMPT_ACK;
}

export function advanceSessionInitGate(gateValue, evidence = {}, { now = Date.now() } = {}) {
  if (!gateValue || typeof gateValue !== "object") return null;
  const gate = { ...gateValue, updatedAt: nowIso(now) };
  if (!sessionInitHoldsAutonomy(gate)) return gate;

  const {
    tabReady = false,
    composerSettled = false,
    promptAcked = false,
    firstResponseComplete = false,
    reasons = [],
    detail = ""
  } = evidence;

  gate.lastReasons = (Array.isArray(reasons) ? reasons : []).map((item) => sanitizeText(item, 120)).slice(0, 8);
  if (detail) gate.detail = sanitizeText(detail, 600);

  if (gate.state === SESSION_INIT_STATES.PENDING_TAB_READY && tabReady) {
    gate.state = SESSION_INIT_STATES.PENDING_COMPOSER_STABLE;
  }
  if (gate.state === SESSION_INIT_STATES.PENDING_COMPOSER_STABLE && composerSettled) {
    gate.state = SESSION_INIT_STATES.PENDING_PROMPT_ACK;
  }
  if (gate.state === SESSION_INIT_STATES.PENDING_PROMPT_ACK && promptAcked) {
    gate.state = SESSION_INIT_STATES.PENDING_FIRST_RESPONSE;
  }
  if (gate.state === SESSION_INIT_STATES.PENDING_FIRST_RESPONSE && firstResponseComplete) {
    gate.state = SESSION_INIT_STATES.INITIALIZED;
    gate.initializedAt = nowIso(now);
    gate.lastReasons = [];
  }

  const openedAt = Date.parse(gate.openedAt || "");
  if ([SESSION_INIT_STATES.PENDING_TAB_READY, SESSION_INIT_STATES.PENDING_COMPOSER_STABLE].includes(gate.state) &&
      Number.isFinite(openedAt) &&
      now - openedAt > gate.timeoutMs) {
    // Only structural discovery may time out. Once the one-shot prompt is queued,
    // foreground/background generation may legitimately continue for an unbounded
    // period; the effect journal owns delivery retries and acknowledgements.
    // The gate fails open into an explicit, auditable FAILED_TIMEOUT only before
    // the queued prompt phase exists.
    gate.state = SESSION_INIT_STATES.FAILED_TIMEOUT;
    gate.detail = sanitizeText(
      `Sessionsinitiering nådde inte klart läge inom ${Math.round(gate.timeoutMs / 1000)} s: ${gate.lastReasons.join(", ") || "okänd orsak"}`,
      600
    );
  }
  return gate;
}
