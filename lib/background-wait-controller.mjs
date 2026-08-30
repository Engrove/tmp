import { nowIso, sanitizeText } from "./common.mjs";
import { STATES, transitionRun, PAUSE_ORIGINS } from "./state-machine.mjs";

export function enterBackgroundWait(run, page = {}, tab = {}, {
  now = Date.now(),
  reason = "ChatGPT fortsätter samma task i bakgrunden."
} = {}) {
  let next = transitionRun(run, STATES.WAITING_BACKGROUND, {
    origin: PAUSE_ORIGINS.NONE,
    reason,
    now,
    force: true
  });
  const firstEntry = !run.waitStartedAt;
  next.responseDeadlineAt = null;
  next.timeoutSuspended = true;
  next.waitStartedAt = run.waitStartedAt || nowIso(now);
  next.lastBackgroundEvidenceAt = nowIso(now);
  next.lastReconcileAt = nowIso(now);
  next.nextReconcileReason = "BACKGROUND_WATCHDOG";
  next.backgroundLanguage = sanitizeText(page?.backgroundSignals?.language || "unknown", 32);
  next.backgroundEvidenceCodes = [...new Set(page?.backgroundSignals?.evidenceCodes || [])].slice(0, 16);
  next.taskFingerprint = sanitizeText(page?.taskFingerprint || run.taskFingerprint || "", 240);
  next.lastVerifiedSnapshotHash = sanitizeText(page?.snapshotHash || page?.latestAssistantHash || "", 160);
  next.tabState = {
    active: Boolean(tab?.active),
    windowId: Number.isInteger(tab?.windowId) ? tab.windowId : run.windowId,
    discarded: Boolean(tab?.discarded),
    frozen: Boolean(tab?.frozen),
    status: sanitizeText(tab?.status || "", 32),
    autoDiscardable: typeof tab?.autoDiscardable === "boolean" ? tab.autoDiscardable : null
  };
  next.backgroundCompletionCandidate = null;
  next.backgroundEntryCount = Number(run.backgroundEntryCount || 0) + (firstEntry ? 1 : 0);
  return next;
}

export function refreshBackgroundWait(run, page = {}, tab = {}, {
  now = Date.now(),
  reason = "Bakgrundssignalen är fortfarande verifierad."
} = {}) {
  const next = transitionRun(run, STATES.WAITING_BACKGROUND, {
    origin: PAUSE_ORIGINS.NONE,
    reason,
    now,
    force: true
  });
  next.responseDeadlineAt = null;
  next.timeoutSuspended = true;
  next.waitStartedAt ||= nowIso(now);
  next.lastBackgroundEvidenceAt = nowIso(now);
  next.lastReconcileAt = nowIso(now);
  next.nextReconcileReason = reason;
  next.backgroundLanguage = sanitizeText(page?.backgroundSignals?.language || next.backgroundLanguage || "unknown", 32);
  next.backgroundEvidenceCodes = [...new Set(page?.backgroundSignals?.evidenceCodes || next.backgroundEvidenceCodes || [])].slice(0, 16);
  next.taskFingerprint = sanitizeText(page?.taskFingerprint || next.taskFingerprint || "", 240);
  next.lastVerifiedSnapshotHash = sanitizeText(page?.snapshotHash || page?.latestAssistantHash || next.lastVerifiedSnapshotHash || "", 160);
  next.tabState = {
    active: Boolean(tab?.active),
    windowId: Number.isInteger(tab?.windowId) ? tab.windowId : next.windowId,
    discarded: Boolean(tab?.discarded),
    frozen: Boolean(tab?.frozen),
    status: sanitizeText(tab?.status || "", 32),
    autoDiscardable: typeof tab?.autoDiscardable === "boolean" ? tab.autoDiscardable : null
  };
  next.updatedAt = nowIso(now);
  return next;
}

export function preserveBackgroundForSuspendedTab(run, tab = {}, {
  now = Date.now(),
  reason = "RECONCILE_ON_RESUME"
} = {}) {
  const next = transitionRun(run, STATES.WAITING_BACKGROUND, {
    origin: PAUSE_ORIGINS.LIFECYCLE_INTERRUPTION,
    reason,
    now,
    force: true
  });
  next.responseDeadlineAt = null;
  next.timeoutSuspended = true;
  next.waitStartedAt ||= nowIso(now);
  next.lastReconcileAt = nowIso(now);
  next.nextReconcileReason = reason;
  next.tabState = {
    ...(next.tabState || {}),
    active: Boolean(tab?.active),
    windowId: Number.isInteger(tab?.windowId) ? tab.windowId : next.windowId,
    discarded: Boolean(tab?.discarded),
    frozen: Boolean(tab?.frozen),
    status: sanitizeText(tab?.status || "", 32),
    autoDiscardable: typeof tab?.autoDiscardable === "boolean" ? tab.autoDiscardable : next.tabState?.autoDiscardable ?? null
  };
  next.updatedAt = nowIso(now);
  return next;
}

export function leaveBackgroundWait(run, {
  now = Date.now(),
  reason = "Bakgrundssignalen försvann; stabil completion verifieras."
} = {}) {
  let next = transitionRun(run, STATES.WAITING_FOR_RESPONSE, {
    origin: PAUSE_ORIGINS.LIFECYCLE_INTERRUPTION,
    reason,
    now,
    force: true
  });
  next.timeoutSuspended = false;
  next.responseDeadlineAt = null;
  next.lastReconcileAt = nowIso(now);
  next.nextReconcileReason = "VERIFY_STABLE_COMPLETION";
  return next;
}

export function backgroundWaitAgeMs(run, now = Date.now()) {
  const started = Date.parse(run?.waitStartedAt || "");
  return Number.isFinite(started) ? Math.max(0, now - started) : 0;
}

export function shouldApplyResponseTimeout(run) {
  return Boolean(run?.responseDeadlineAt) &&
    run?.timeoutSuspended !== true &&
    run?.state !== STATES.WAITING_BACKGROUND;
}
