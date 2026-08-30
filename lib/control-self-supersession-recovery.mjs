import { deepClone, nowIso, randomId, sanitizeText } from "./common.mjs";
import {
  CAUSAL_EFFECT_STATUS,
  CAUSAL_EVENT,
  activeCausalEffect,
  commitCausalControl,
  latestUserOwnsControlPrompt
} from "./causal-transition-authority.mjs";

export const CONTROL_SELF_SUPERSESSION_RECOVERY_SCHEMA =
  "eic.autonom.control-self-supersession-recovery.v1";

function terminalMaterialClosure(effect = {}) {
  return ["CLOSED", "CANCELLED"].includes(String(effect?.status || "")) &&
    String(effect?.closeReason || "") === "SUPERSEDED_BY_NEW_MATERIAL_EVENT";
}

export function recoverFalseSelfSupersededControlTurn(runValue, page = {}, {
  now = Date.now()
} = {}) {
  let run = runValue;
  const turn = run?.currentTurn;
  if (!turn?.turnId || activeCausalEffect(run)) {
    return { run, recovered: false, reason: "NO_ORPHANED_CURRENT_TURN" };
  }

  const legacyEffect = Array.isArray(run?.effectJournal)
    ? [...run.effectJournal].reverse().find((entry) =>
        String(entry?.turnId || "") === String(turn.turnId || ""))
    : null;
  if (!legacyEffect || !latestUserOwnsControlPrompt(page, legacyEffect)) {
    return { run, recovered: false, reason: "LATEST_USER_NOT_OWN_CONTROL_PROMPT" };
  }

  const causalEffect = Array.isArray(run?.causalControl?.effects)
    ? [...run.causalControl.effects].reverse().find((entry) =>
        String(entry?.effectId || "") === String(legacyEffect.effectId || ""))
    : null;
  if (!terminalMaterialClosure(causalEffect)) {
    return { run, recovered: false, reason: "NO_FALSE_MATERIAL_CLOSURE" };
  }

  const replacement = {
    ...deepClone(legacyEffect),
    effectId: randomId("effect-rearmed"),
    status: "ACKED",
    attempts: Math.max(1, Number(legacyEffect.attempts || 0)),
    preparedAt: legacyEffect.preparedAt || nowIso(now),
    submittedAt: legacyEffect.submittedAt || nowIso(now),
    confirmedAt: legacyEffect.confirmedAt || nowIso(now),
    lastError: "",
    recoveredFromEffectId: sanitizeText(legacyEffect.effectId, 180),
    recoveryReason: "FALSE_SELF_SUPERSESSION_V0123",
    recoveredAt: nowIso(now)
  };

  run.effectJournal = [...(Array.isArray(run.effectJournal) ? run.effectJournal : []), replacement].slice(-80);
  run.currentTurn = {
    ...run.currentTurn,
    effectState: "ACKED",
    agentVersion: run.currentTurn.agentVersion || "0.12.3",
    recoveredEffectId: replacement.effectId
  };

  let commit = commitCausalControl(run, {
    type: CAUSAL_EVENT.EFFECT_REGISTER,
    effectId: replacement.effectId,
    turnId: replacement.turnId,
    effectClass: replacement.effectClass || replacement.turnKind || "CONTROL_EFFECT",
    correlationId: replacement.effectId,
    responseContract: run.currentTurn?.responseContract || "TURN_BOUND_5",
    sourceObservationIdentity: replacement.sourceObservationIdentity || ""
  }, { now });
  run = commit.run;
  if (!commit.accepted) {
    return { run, recovered: false, reason: `REARM_REGISTER_FAILED:${commit.reason || "UNKNOWN"}` };
  }

  commit = commitCausalControl(run, {
    type: CAUSAL_EVENT.EFFECT_STATUS,
    effectId: replacement.effectId,
    status: CAUSAL_EFFECT_STATUS.ACKED,
    reason: "FALSE_SELF_SUPERSESSION_V0123_RECOVERED"
  }, { now });
  run = commit.run;
  if (!commit.accepted) {
    return { run, recovered: false, reason: `REARM_ACK_FAILED:${commit.reason || "UNKNOWN"}` };
  }

  run.responseDeadlineAt ||= now + 7_200_000;
  run.timeoutSuspended = false;
  run.runtimeDecisionStatus = "CONTROL_SELF_SUPERSESSION_RECOVERED";
  run.lastControlSelfSupersessionRecovery = {
    schema: CONTROL_SELF_SUPERSESSION_RECOVERY_SCHEMA,
    turnId: sanitizeText(turn.turnId, 180),
    priorEffectId: sanitizeText(legacyEffect.effectId, 180),
    replacementEffectId: replacement.effectId,
    recoveredAt: nowIso(now)
  };

  return {
    run,
    recovered: true,
    reason: "CONTROL_SELF_SUPERSESSION_RECOVERED",
    receipt: deepClone(run.lastControlSelfSupersessionRecovery)
  };
}
