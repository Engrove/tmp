import { sha256Hex, stableStringify } from "./common.mjs";

export const NANO_AUTO_RESTART_COOLDOWN_MS = 10 * 60 * 1000;
export const AUTO_CAPTURE_DEBOUNCE_MS = 2500;
export const AUTO_CAPTURE_CANCEL_GRACE_MS = 1500;
export const AUTO_CAPTURE_DEFER_BACKOFF_MAX_MS = 30_000;

/**
 * v0.10.11: bounded backoff for the automatic-capture self-retry chain.
 *
 * A deferred automatic capture re-schedules itself, and the deferral condition
 * (`pendingNanoRequest` or an ASSESSING run) can legitimately hold for a long
 * time. In v0.10.10 that produced a fixed 2.5 s retry with no backoff: a single
 * stalled mission request generated 20 cancelled capture cycles in 50 s, each
 * costing three storage writes and one content-script page read.
 *
 * The delay doubles per consecutive deferral and saturates at 30 s. There is no
 * hard attempt ceiling on purpose — the 30 s watchdog tick re-triggers capture
 * anyway, so a cap could only ever lose a capture, never save work.
 */
export function autoCaptureDeferDelayMs(consecutiveDefers = 0, {
  baseMs = AUTO_CAPTURE_DEBOUNCE_MS,
  maxMs = AUTO_CAPTURE_DEFER_BACKOFF_MAX_MS
} = {}) {
  const defers = Math.max(0, Math.floor(Number(consecutiveDefers) || 0));
  const base = Math.max(1, Number(baseMs) || AUTO_CAPTURE_DEBOUNCE_MS);
  const max = Math.max(base, Number(maxMs) || AUTO_CAPTURE_DEFER_BACKOFF_MAX_MS);
  const scaled = base * (2 ** Math.min(defers, 20));
  return Math.min(max, scaled);
}

const MANUAL_ONLY_REASONS = new Set([
  "DOWNLOAD_REQUIRED",
  "DOWNLOAD_STALLED",
  "EXTERNAL_MODEL_ASSET_BLOCKER",
  "CREATE_TIMEOUT",
  "CREATE_ABORTED",
  "CREATE_FAILED"
]);

export async function createNanoRestartFingerprint({
  appVersion = "",
  windowId = 0,
  mandateVersion = "",
  mandateSha256 = "",
  profileId = "",
  systemPrompt = ""
} = {}) {
  return sha256Hex(stableStringify({
    appVersion: String(appVersion),
    windowId: Number(windowId || 0),
    mandateVersion: String(mandateVersion),
    mandateSha256: String(mandateSha256),
    profileId: String(profileId),
    systemPrompt: String(systemPrompt)
  }));
}

export function evaluateAutoRestart({
  enabled = true,
  stale = false,
  staleReason = "",
  availability = "",
  priorCanaryVerified = false,
  busy = false,
  guard = null,
  fingerprint = "",
  now = Date.now(),
  cooldownMs = NANO_AUTO_RESTART_COOLDOWN_MS
} = {}) {
  if (!enabled) return { allowed: false, reason: "DISABLED" };
  if (!stale) return { allowed: false, reason: "NOT_STALE" };
  if (busy) return { allowed: false, reason: "BUSY" };
  if (MANUAL_ONLY_REASONS.has(String(staleReason || ""))) {
    return { allowed: false, reason: "MANUAL_ONLY_REASON" };
  }
  if (String(availability || "").toLowerCase() !== "available") {
    return { allowed: false, reason: "MODEL_NOT_AVAILABLE" };
  }
  if (!priorCanaryVerified) return { allowed: false, reason: "NO_VERIFIED_BASE" };
  const lastAt = Date.parse(String(guard?.attemptedAt || ""));
  if (guard?.fingerprint === fingerprint && Number.isFinite(lastAt) &&
      now - lastAt < Number(cooldownMs || NANO_AUTO_RESTART_COOLDOWN_MS)) {
    return {
      allowed: false,
      reason: "COOLDOWN",
      retryAt: new Date(lastAt + Number(cooldownMs || NANO_AUTO_RESTART_COOLDOWN_MS)).toISOString()
    };
  }
  return { allowed: true, reason: "ELIGIBLE" };
}

export function createAutoRestartGuard({
  fingerprint,
  status = "ATTEMPTED",
  now = Date.now(),
  error = ""
} = {}) {
  return {
    schema: "eic.autonom.nano-auto-restart-guard.v1",
    fingerprint: String(fingerprint || ""),
    status: String(status || "ATTEMPTED"),
    attemptedAt: new Date(now).toISOString(),
    error: String(error || "").slice(0, 1000)
  };
}



const AUTO_CAPTURE_TERMINAL_STATES = new Set([
  "COMPLETE_STABLE",
  "COMPLETE_PROTOCOL_OVERRIDE"
]);

export function isAutoCaptureTerminalResponse({
  responseState = "",
  latestMessageRole = "",
  latestAssistantCandidate = false
} = {}) {
  return AUTO_CAPTURE_TERMINAL_STATES.has(String(responseState || "")) &&
    String(latestMessageRole || "") === "assistant" &&
    latestAssistantCandidate === true;
}

export function createCaptureFingerprint({
  conversationKey = "",
  latestMessageHash = "",
  assistantCount = 0
} = {}) {
  // Rendered message counts and document epochs are intentionally excluded.
  // ChatGPT virtualizes its DOM, so those values can regress without a semantic
  // transcript change. The latest semantic message hash is the stable identity.
  void assistantCount;
  return `${String(conversationKey)}|${String(latestMessageHash)}`;
}

export function runBlocksAutomaticCapture(run = null) {
  if (!run) return false;
  return [
    "SOFT_PAUSED",
    "STOPPED",
    "AWAITING_OPERATOR_ACTION",
    "AWAITING_OPERATOR_DECISION",
    "PROGRAM_BLOCKED",
    "PROGRAM_DONE",
    "ERROR_TERMINAL"
  ].includes(String(run.state || ""));
}

export function createAutoCaptureGuard({
  fingerprint = "",
  requestId = "",
  status = "STARTED",
  now = Date.now(),
  error = ""
} = {}) {
  return {
    schema: "eic.autonom.auto-capture-guard.v1",
    fingerprint: String(fingerprint || ""),
    requestId: String(requestId || ""),
    status: String(status || "STARTED"),
    updatedAt: new Date(now).toISOString(),
    error: String(error || "").slice(0, 1000)
  };
}

export function evaluateAutoCapture({
  enabled = true,
  linked = false,
  stable = false,
  fingerprint = "",
  lastFingerprint = "",
  inFlight = false,
  paused = false,
  guard = null
} = {}) {
  if (!enabled) return { allowed: false, reason: "DISABLED" };
  if (paused) return { allowed: false, reason: "AUTOMATION_PAUSED" };
  if (!linked) return { allowed: false, reason: "TARGET_NOT_LINKED" };
  if (!stable) return { allowed: false, reason: "NO_STABLE_TRANSCRIPT" };
  if (!fingerprint) return { allowed: false, reason: "FINGERPRINT_EMPTY" };
  if (inFlight) return { allowed: false, reason: "IN_FLIGHT" };
  if (fingerprint === lastFingerprint) return { allowed: false, reason: "UNCHANGED" };
  if (guard?.fingerprint === fingerprint &&
      ["STARTED", "COMPLETED", "FAILED"].includes(String(guard.status || ""))) {
    return { allowed: false, reason: "FINGERPRINT_ALREADY_ATTEMPTED" };
  }
  return { allowed: true, reason: "NEW_STABLE_TRANSCRIPT" };
}


export function canReferenceAcknowledgedMandate({
  receipt = null,
  priorTurnId = "",
  mandateVersion = "",
  mandateSha256 = "",
  conversationKey = "",
  taskFingerprint = ""
} = {}) {
  return Boolean(
    priorTurnId &&
    receipt?.turnId === priorTurnId &&
    receipt?.mandateVersion === mandateVersion &&
    receipt?.mandateSha256 === mandateSha256 &&
    receipt?.conversationKey === conversationKey &&
    receipt?.taskFingerprint === taskFingerprint &&
    receipt?.confirmedAt
  );
}

export function evaluateInterruptedNanoRecovery(run, { now = Date.now() } = {}) {
  const telemetry = run?.nanoTelemetry || {};
  const startedAt = Date.parse(String(telemetry.lastStartedAt || ""));
  const hasStarted = Number.isFinite(startedAt);
  const elapsedMs = hasStarted ? Math.max(0, now - startedAt) : 0;
  const alreadyRepaired = Number(run?.nanoLifecycleRepairCount || 0) >= 1;
  const allowed = Boolean(
    run &&
    run.pendingObservation &&
    !run.pendingNanoRequest &&
    telemetry.lastStatus === "RUNNING" &&
    !telemetry.lastCompletedAt &&
    !alreadyRepaired
  );
  return {
    allowed,
    reason: allowed ? "ORPHANED_RUNNING_REQUEST" :
      alreadyRepaired ? "REPAIR_LIMIT_REACHED" : "NOT_ORPHANED",
    elapsedMs
  };
}
