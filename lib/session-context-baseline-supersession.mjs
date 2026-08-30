import { nowIso, sanitizeText } from "./common.mjs";
import {
  RESPONSE_OBSERVATION_CYCLE_STATUS,
  retireResponseCandidate
} from "./response-observation-cycle.mjs";
import {
  SESSION_CONTEXT_INIT_STATE,
  rearmSessionContextInitAfterMaterialEvent,
  sessionContextInitBlocksWork
} from "./session-context-init.mjs";

export const SESSION_CONTEXT_BASELINE_SUPERSESSION_SCHEMA =
  "eic.autonom.session-context-baseline-supersession.v1";

const BASELINE_TURN_KINDS = new Set([
  "SESSION_CONTEXT_BASELINE_REQUEST",
  "SESSION_CONTEXT_BASELINE_CORRECTION"
]);

/**
 * Synchronize the legacy session-init projection after causal CONTROL has
 * already closed a baseline effect because a genuinely new MISSION user event
 * advanced materialGeneration.
 *
 * The caller owns persistence. This function is deterministic and side-effect
 * free outside the supplied run object clone/reference.
 */
export function retireMaterialSupersededSessionContextBaseline(runValue, {
  now = Date.now()
} = {}) {
  let run = runValue;
  const init = run?.sessionContextInit;
  const turn = run?.currentTurn;
  if (!BASELINE_TURN_KINDS.has(String(turn?.kind || "")) ||
      !sessionContextInitBlocksWork(init)) {
    return { run, retired: false, reason: "NO_BLOCKING_BASELINE_TURN" };
  }

  const legacyEffect = Array.isArray(run.effectJournal)
    ? run.effectJournal.find((entry) =>
        String(entry?.effectId || "") &&
        String(entry.effectId) === String(turn?.effectId || "")) ||
      run.effectJournal.find((entry) =>
        String(entry?.turnId || "") === String(turn?.turnId || ""))
    : null;
  const causalEffect = Array.isArray(run?.causalControl?.effects)
    ? run.causalControl.effects.find((entry) =>
        String(entry?.effectId || "") === String(legacyEffect?.effectId || ""))
    : null;
  const causallySuperseded = Boolean(
    causalEffect &&
    ["CLOSED", "CANCELLED"].includes(String(causalEffect.status || "")) &&
    String(causalEffect.closeReason || "") === "SUPERSEDED_BY_NEW_MATERIAL_EVENT"
  );
  if (!causallySuperseded) {
    return { run, retired: false, reason: "CAUSAL_EFFECT_NOT_MATERIAL_SUPERSEDED" };
  }

  const retiredAt = nowIso(now);
  const priorTurnId = sanitizeText(turn?.turnId, 180);
  const priorEffectId = sanitizeText(legacyEffect?.effectId, 180);
  const priorNeedKey = sanitizeText(init?.needKey, 320);
  const materialGeneration = Number(run?.causalControl?.materialGeneration || 0);

  if (legacyEffect) {
    legacyEffect.status = "CANCELLED_SUPERSEDED";
    legacyEffect.cancelledAt = retiredAt;
    legacyEffect.cancelReason = "SUPERSEDED_BY_NEW_MATERIAL_EVENT";
    legacyEffect.lastError = "";
  }

  run.lastSupersededSessionContextBaseline = {
    schema: SESSION_CONTEXT_BASELINE_SUPERSESSION_SCHEMA,
    turnId: priorTurnId,
    effectId: priorEffectId,
    needKey: priorNeedKey,
    priorState: sanitizeText(init?.state, 120),
    materialGeneration,
    reason: "SUPERSEDED_BY_NEW_MATERIAL_EVENT",
    at: retiredAt
  };

  run.currentTurn = null;
  run.pendingNanoRequest = null;
  run.pendingObservation = null;
  run.waitingObservation = null;
  run.responseDeadlineAt = null;
  run.timeoutSuspended = false;
  run.takeoverBootstrapRequired = false;
  run.sessionContextBaselineRebindCount = 0;
  run = retireResponseCandidate(run, {
    status: RESPONSE_OBSERVATION_CYCLE_STATUS.SUPERSEDED,
    reason: "SESSION_CONTEXT_BASELINE_SUPERSEDED_BY_NEW_MATERIAL_EVENT",
    now
  });
  run.sessionContextInit = rearmSessionContextInitAfterMaterialEvent(init, {
    now,
    materialGeneration
  });
  run.nanoTelemetry ||= {};
  run.nanoTelemetry.lastStatus = "BASELINE_GENERATION_SUPERSEDED_REARMED";
  run.nanoTelemetry.lastError = "";
  run.nanoTelemetry.lastResultSummary =
    "WAITING_CHAT_READY_FOR_FRESH_BASELINE_GENERATION";
  run.runtimeDecisionStatus = "SESSION_CONTEXT_BASELINE_REARMED";

  return {
    run,
    retired: true,
    reason: "SESSION_CONTEXT_BASELINE_REARMED",
    receipt: { ...run.lastSupersededSessionContextBaseline }
  };
}
