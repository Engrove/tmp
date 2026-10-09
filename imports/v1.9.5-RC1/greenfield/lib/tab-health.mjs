// v1.8.3 managed-tab health.
//
// Operator reports (2026-09-25): Chrome sometimes leaves the whole content
// area white (overlay invisible too; only re-opening the URL helps) and
// ChatGPT sometimes renders a partial UI (e.g. no composer), which left
// Greenfield in SENDING with THINKING_MODE_UNVERIFIED indefinitely.
//
// Two code facts made Greenfield freeze together with such a tab: bridge
// messages had no deadline, and ticks are serialized per process, while every
// transition awaits the overlay sync to the same tab. Deadlines remove that
// coupling; this module decides when a tab is unhealthy and which bounded
// recovery step comes next. Pure: no Chrome calls.

export const TAB_HEALTH = Object.freeze({
  BRIDGE_TIMEOUT_MS: 15_000,
  OVERLAY_TIMEOUT_MS: 5_000,
  INJECT_TIMEOUT_MS: 20_000,
  SUBMIT_TIMEOUT_MS: 90_000,
  PREFLIGHT_TIMEOUT_MS: 60_000,
  RENDER_STALL_MS: 45_000,
  UI_PARTIAL_GRACE_MS: 90_000,
  STEP_SETTLE_MS: 45_000,
  BUDGET_WINDOW_MS: 60 * 60 * 1000,
  BUDGET_MAX_ACTIONS: 5,
  TICK_STALL_MS: 3 * 60 * 1000,
  TICK_RESCUE_SPACING_MS: 5 * 60 * 1000
});

export const TAB_CONDITION = Object.freeze({
  BRIDGE_UNRESPONSIVE: "BRIDGE_UNRESPONSIVE",
  BRIDGE_MISSING: "BRIDGE_MISSING",
  TAB_DISCARDED: "TAB_DISCARDED",
  RENDER_STALLED: "RENDER_STALLED",
  COMPOSER_MISSING: "COMPOSER_MISSING",
  THREAD_MISSING: "THREAD_MISSING"
});

export const TAB_RECOVERY_STEP = Object.freeze({
  REINJECT_BRIDGE: "REINJECT_BRIDGE",
  RELOAD: "RELOAD",
  HARD_RELOAD: "HARD_RELOAD",
  NAVIGATE_SAME_URL: "NAVIGATE_SAME_URL",
  REPLACE_TAB: "REPLACE_TAB",
  GIVE_UP: "GIVE_UP"
});

const LADDER = Object.freeze([
  TAB_RECOVERY_STEP.RELOAD,
  TAB_RECOVERY_STEP.HARD_RELOAD,
  TAB_RECOVERY_STEP.NAVIGATE_SAME_URL,
  TAB_RECOVERY_STEP.REPLACE_TAB,
  TAB_RECOVERY_STEP.GIVE_UP
]);
// A missing content script in a live page is first re-injected; a hung
// renderer cannot run an injected script, so it starts at RELOAD.
const LADDER_WITH_REINJECT = Object.freeze([TAB_RECOVERY_STEP.REINJECT_BRIDGE, ...LADDER]);

/** Map a bridge/tab error code to a tab condition ("" when not tab health). */
export function conditionFromBridgeError(code) {
  if (code === "CONTENT_BRIDGE_TIMEOUT") return TAB_CONDITION.BRIDGE_UNRESPONSIVE;
  if (code === "CONTENT_BRIDGE_MISSING") return TAB_CONDITION.BRIDGE_MISSING;
  if (code === "MANAGED_TAB_DISCARDED") return TAB_CONDITION.TAB_DISCARDED;
  return "";
}

/**
 * Condition seen in a page the bridge could read. Only conditions that block
 * progress in the current phase count:
 *  - RENDER_STALLED: visible for RENDER_STALL_MS without a single animation
 *    frame (timers run, nothing is painted: the "white page" with live JS);
 *  - COMPOSER_MISSING: SENDING and no composer (the prompt cannot be posted,
 *    and the reasoning control lives in the composer);
 *  - THREAD_MISSING: a /c/<id> conversation that rendered no turn at all.
 * A hidden page is never judged: Chrome does not paint hidden pages.
 */
export function pageConditionFromHealth(health, { phase = "" } = {}) {
  if (!health || typeof health !== "object") return "";
  if (health.readyState !== "complete") return "";
  if (health.visibilityState === "visible" &&
      Number(health.visibleForMs || 0) >= TAB_HEALTH.RENDER_STALL_MS &&
      Number(health.frameGapMs || 0) >= TAB_HEALTH.RENDER_STALL_MS) {
    return TAB_CONDITION.RENDER_STALLED;
  }
  if (phase === "SENDING" && health.composerPresent === false) return TAB_CONDITION.COMPOSER_MISSING;
  if (["SENDING", "WAITING"].includes(phase) && health.conversationUrl === true && Number(health.turnCount || 0) === 0) {
    return TAB_CONDITION.THREAD_MISSING;
  }
  return "";
}

function recentBudget(budget, now) {
  return (Array.isArray(budget) ? budget : [])
    .map(Number)
    .filter((at) => Number.isFinite(at) && now - at < TAB_HEALTH.BUDGET_WINDOW_MS);
}

/**
 * Advance the per-process tab-health state for one observation.
 *   state: { incident: {condition, sinceMs, stepIndex, lastActionAtMs, steps[]} | null, budget: [ms] }
 * Returns { state, action } where action is "" (nothing to do yet),
 * a TAB_RECOVERY_STEP, or "BUDGET_EXHAUSTED".
 * UI conditions must persist UI_PARTIAL_GRACE_MS before the first step; bridge
 * conditions act at once (the bridge deadline already waited). Every step is
 * followed by STEP_SETTLE_MS before the next one.
 */
export function advanceTabHealth(state, condition, { now = Date.now() } = {}) {
  const prior = state && typeof state === "object" ? state : {};
  const budget = recentBudget(prior.budget, now);
  if (!condition) {
    return { state: { incident: null, budget, lastRecoveredAtMs: prior.incident ? now : Number(prior.lastRecoveredAtMs || 0) }, action: "" };
  }
  const incident = prior.incident && prior.incident.condition === condition
    ? { ...prior.incident }
    : { condition, sinceMs: now, stepIndex: 0, lastActionAtMs: 0, steps: [] };
  const uiCondition = [TAB_CONDITION.RENDER_STALLED, TAB_CONDITION.COMPOSER_MISSING, TAB_CONDITION.THREAD_MISSING].includes(condition);
  if (uiCondition && now - Number(incident.sinceMs) < TAB_HEALTH.UI_PARTIAL_GRACE_MS) {
    return { state: { ...prior, incident, budget }, action: "" };
  }
  if (incident.lastActionAtMs && now - Number(incident.lastActionAtMs) < TAB_HEALTH.STEP_SETTLE_MS) {
    return { state: { ...prior, incident, budget }, action: "" };
  }
  const ladder = condition === TAB_CONDITION.BRIDGE_MISSING ? LADDER_WITH_REINJECT : LADDER;
  const step = ladder[Math.min(incident.stepIndex, ladder.length - 1)];
  if (step !== TAB_RECOVERY_STEP.GIVE_UP && budget.length >= TAB_HEALTH.BUDGET_MAX_ACTIONS) {
    return { state: { ...prior, incident, budget }, action: "BUDGET_EXHAUSTED" };
  }
  const next = {
    ...incident,
    stepIndex: incident.stepIndex + 1,
    lastActionAtMs: now,
    steps: [...(incident.steps || []), { step, atMs: now }].slice(-8)
  };
  return {
    state: { ...prior, incident: next, budget: step === TAB_RECOVERY_STEP.GIVE_UP ? budget : [...budget, now] },
    action: step
  };
}

/** Operator text (Swedish) for the overlay/panel. */
export function tabHealthStatusSv(state) {
  const incident = state?.incident;
  if (!incident) return "";
  const labels = {
    BRIDGE_UNRESPONSIVE: "sidan svarar inte",
    BRIDGE_MISSING: "Greenfield-bryggan saknas i sidan",
    TAB_DISCARDED: "Chrome har laddat ur fliken",
    RENDER_STALLED: "sidan ritas inte (vit ruta)",
    COMPOSER_MISSING: "inmatningsfältet saknas",
    THREAD_MISSING: "konversationen visas inte"
  };
  const done = Array.isArray(incident.steps) ? incident.steps.length : 0;
  return `Flikåterhämtning: ${labels[incident.condition] || incident.condition} · steg ${done}/${LADDER.length}`;
}
