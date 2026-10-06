// v1.9.0 Arbetsläge at startup and its supervising worker.
//
// Operator request 2026-10-06: "Aktivera Arbetsläge" is checked and active
// at startup. The background turns it on when Chrome starts the profile
// (runtime.onStartup) and when the extension is installed, updated or
// reloaded (runtime.onInstalled). Switched off in the panel, it stays off
// until the next such start; a service-worker wake does not turn it on.
//
// One worker polls the work-mode endpoint (the supervisor). Until 1.8.14 a
// supervisor that no longer existed (window closed, worker not restored
// after a browser restart) left every other worker at NOT_SUPERVISOR, so
// Arbetsläge was on but nothing polled, and an empty supervisor let every
// worker poll. Now a live worker takes over from a supervisor that is not
// live; the reserved worker (v1.8.12) is preferred when it is live. Pure.

/** Settings patch for a Chrome/extension start; null when already on. */
export function workModeStartupPatch(settings = {}) {
  return settings?.workModeEnabled === true ? null : { workModeEnabled: true };
}

/**
 * Who polls for work-mode tasks.
 *   settings        operator settings (workModeEnabled, workModeSupervisorWorkerId, reservedWorkerId)
 *   workerId        the ticking worker
 *   liveWorkerIds   workers that have a running process bound to an open window
 * action POLL (this worker is the supervisor), CLAIM (become supervisor,
 * then poll), SKIP (another live worker polls) or DISABLED.
 */
export function workModeSupervisorDecision({ settings = {}, workerId = "", liveWorkerIds = [] } = {}) {
  if (settings?.workModeEnabled !== true) return { action: "DISABLED", code: "WORK_MODE_DISABLED" };
  const self = String(workerId || "");
  if (!self) return { action: "SKIP", code: "NO_WORKER" };
  const current = String(settings.workModeSupervisorWorkerId || "");
  if (current === self) return { action: "POLL", code: "SUPERVISOR" };
  const live = new Set((Array.isArray(liveWorkerIds) ? liveWorkerIds : [...(liveWorkerIds || [])]).map(String));
  if (current && live.has(current)) return { action: "SKIP", code: "NOT_SUPERVISOR" };
  const reserved = String(settings.reservedWorkerId || "");
  if (reserved && reserved !== self && live.has(reserved)) return { action: "SKIP", code: "WAIT_FOR_RESERVED_WORKER" };
  return { action: "CLAIM", code: current ? "SUPERVISOR_NOT_LIVE" : "NO_SUPERVISOR", previousWorkerId: current };
}
