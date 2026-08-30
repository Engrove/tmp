import { sanitizeText } from "./common.mjs";
import { EXECUTION_DISPOSITIONS } from "./execution-routing.mjs";
import {
  SESSION_CONTEXT_BASELINE_COMMIT_STATUS,
  SESSION_CONTEXT_INIT_STATE,
  SESSION_CONTEXT_READY_FINALIZATION_STATUS
} from "./session-context-init.mjs";

/**
 * v0.11.3 causal session-init model.
 *
 * This module contains pure guards for the composition boundaries that caused
 * the v0.11.2 live deadlock. It deliberately owns no storage or transport.
 */

export function exactSessionContextBaselineNanoOwnership(run = {}) {
  const init = run?.sessionContextInit || {};
  const request = run?.pendingNanoRequest || null;
  const requestId = sanitizeText(request?.requestId, 180);
  const boundId = sanitizeText(init?.nanoRequestId, 180);
  return Boolean(
    init?.state === SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING &&
    request?.sessionContextBaselineAnalysis === true &&
    requestId &&
    boundId &&
    requestId === boundId
  );
}

export function sessionContextBaselineCommitReady(run = {}) {
  const init = run?.sessionContextInit || {};
  const receipt = init?.baselineDecisionCommit || null;
  return Boolean(
    init?.state === SESSION_CONTEXT_INIT_STATE.READY &&
    receipt?.commitStatus === SESSION_CONTEXT_BASELINE_COMMIT_STATUS.COMMITTED &&
    receipt?.readyStatus === SESSION_CONTEXT_READY_FINALIZATION_STATUS.READY
  );
}

export function sessionContextAllowsOrdinaryNano(run = {}, {
  commitReplay = false
} = {}) {
  if (commitReplay) return true;
  const init = run?.sessionContextInit || null;
  if (!init) return false;
  return init.state === SESSION_CONTEXT_INIT_STATE.READY;
}

export function shouldReobserveAckedBaselineResponse(run = {}, {
  responseIdentity = "",
  baselinePresent = false,
  baselineDeliveryAcked = false
} = {}) {
  const init = run?.sessionContextInit || {};
  const identity = sanitizeText(responseIdentity, 512);
  if (!identity || baselinePresent || !baselineDeliveryAcked) return false;
  if (init.state !== SESSION_CONTEXT_INIT_STATE.WAITING_BASELINE_RESPONSE) return false;
  if (run?.pendingNanoRequest) return false;
  const turnKind = sanitizeText(run?.currentTurn?.kind, 120);
  if (!["SESSION_CONTEXT_BASELINE_REQUEST", "SESSION_CONTEXT_BASELINE_CORRECTION"].includes(turnKind)) {
    return false;
  }
  const expected = sanitizeText(init?.baselineResponseIdentity, 512);
  if (!expected) return true;
  return expected === identity;
}

export function materialDeliveryRegulatorEligible(executionPlan = {}, {
  baselinePromptOnly = false,
  protocolRepairOnly = false
} = {}) {
  if (baselinePromptOnly || protocolRepairOnly) return false;
  return executionPlan?.executionDisposition === EXECUTION_DISPOSITIONS.TARGET_DISPATCH;
}

export function waitWakeInvariant(run = {}) {
  const state = sanitizeText(run?.state, 120);
  if (state !== "WAITING_FOR_RESPONSE") {
    return { valid: true, reason: "NOT_WAITING_FOR_RESPONSE" };
  }

  const effect = Array.isArray(run?.effectJournal) && run.effectJournal.length
    ? run.effectJournal[run.effectJournal.length - 1]
    : null;
  const causalOutbound = Boolean(
    effect &&
    ["PREPARED", "SUBMITTING", "SUBMITTED_UNCONFIRMED", "ACKED"].includes(
      String(effect.status || "").toUpperCase()
    )
  );
  const externalWait = Boolean(sanitizeText(run?.waitingExternalEventOwner, 240));
  const deadline = Number(run?.responseDeadlineAt || 0);
  const timeoutObserver = run?.timeoutSuspended !== true && Number.isFinite(deadline) && deadline > 0;

  if (causalOutbound || externalWait || timeoutObserver) {
    return {
      valid: true,
      reason: causalOutbound
        ? "CAUSAL_OUTBOUND_EFFECT"
        : externalWait
          ? "EXTERNAL_EVENT_OWNER"
          : "ACTIVE_RESPONSE_TIMEOUT"
    };
  }
  return {
    valid: false,
    reason: "WAIT_WITHOUT_CAUSAL_WAKE_SOURCE"
  };
}

export const PREPARED_EFFECT_OBSERVATION_DISPOSITION = Object.freeze({
  STABLE_SAME_OWNER: "STABLE_SAME_OWNER",
  SAME_OWNER_BUSY: "SAME_OWNER_BUSY",
  OWNER_IDENTITY_UNREADABLE: "OWNER_IDENTITY_UNREADABLE",
  OWNER_READBACK_REGRESSED: "OWNER_READBACK_REGRESSED",
  SUPERSEDED: "SUPERSEDED"
});

/**
 * v0.12.12 owner comparison for a prompt that was prepared from one exact
 * assistant observation. Transient foreground/background activity is not a
 * supersession signal by itself. Supersession requires a different readable
 * assistant hash or document epoch.
 */
export function classifyPreparedEffectObservation(effect = {}, page = {}) {
  const sourceHash = sanitizeText(effect?.sourceObservationHash, 256);
  const sourceEpoch = sanitizeText(effect?.sourceObservationEpoch, 256);
  const currentHash = sanitizeText(page?.latestAssistantHash, 256);
  const currentEpoch = sanitizeText(page?.documentEpoch, 256);
  const targetBusy = Boolean(page?.generating || page?.backgroundSignals?.active);

  const hashChanged = Boolean(sourceHash && currentHash && currentHash !== sourceHash);
  const epochChanged = Boolean(sourceEpoch && currentEpoch && currentEpoch !== sourceEpoch);

  // v0.12.13: a different readable hash is not proof of a newer owner.
  // ChatGPT virtualizes older DOM nodes, so assistantRecords.at(-1) can briefly
  // resolve to an EARLIER turn. v0.12.12 read that purely positionally and
  // classified the step backwards as a genuine forward supersession, discarding
  // a live prepared effect. A monotonic turn sequence makes the direction
  // readable: going backwards is a stale readback to wait out, not a new owner.
  const sourceTurnSeq = Number(effect?.sourceObservationTurnSeq);
  const currentTurnSeq = Number(page?.latestAssistantTurnSeq);
  const turnReadbackRegressed = Boolean(
    Number.isFinite(sourceTurnSeq) &&
    Number.isFinite(currentTurnSeq) &&
    sourceTurnSeq > 0 &&
    currentTurnSeq > 0 &&
    currentTurnSeq < sourceTurnSeq
  );
  if (turnReadbackRegressed) {
    return {
      disposition: PREPARED_EFFECT_OBSERVATION_DISPOSITION.OWNER_READBACK_REGRESSED,
      superseded: false,
      targetBusy,
      hashChanged,
      epochChanged,
      sourceHash,
      currentHash,
      sourceEpoch,
      currentEpoch,
      sourceTurnSeq,
      currentTurnSeq,
      reason: "ASSISTANT_TURN_READBACK_REGRESSED"
    };
  }

  if (hashChanged || epochChanged) {
    return {
      disposition: PREPARED_EFFECT_OBSERVATION_DISPOSITION.SUPERSEDED,
      superseded: true,
      targetBusy,
      hashChanged,
      epochChanged,
      sourceHash,
      currentHash,
      sourceEpoch,
      currentEpoch,
      reason: hashChanged && epochChanged
        ? "ASSISTANT_HASH_AND_DOCUMENT_EPOCH_CHANGED"
        : hashChanged
          ? "ASSISTANT_HASH_CHANGED"
          : "DOCUMENT_EPOCH_CHANGED"
    };
  }

  const identityUnreadable = Boolean(
    (sourceHash && !currentHash) ||
    (sourceEpoch && !currentEpoch)
  );
  if (identityUnreadable) {
    return {
      disposition: PREPARED_EFFECT_OBSERVATION_DISPOSITION.OWNER_IDENTITY_UNREADABLE,
      superseded: false,
      targetBusy,
      hashChanged: false,
      epochChanged: false,
      sourceHash,
      currentHash,
      sourceEpoch,
      currentEpoch,
      reason: "PREPARED_EFFECT_OWNER_IDENTITY_UNREADABLE"
    };
  }

  if (targetBusy) {
    return {
      disposition: PREPARED_EFFECT_OBSERVATION_DISPOSITION.SAME_OWNER_BUSY,
      superseded: false,
      targetBusy: true,
      hashChanged: false,
      epochChanged: false,
      sourceHash,
      currentHash,
      sourceEpoch,
      currentEpoch,
      reason: page?.backgroundSignals?.active
        ? "SAME_OWNER_BACKGROUND_ACTIVE"
        : "SAME_OWNER_FOREGROUND_GENERATING"
    };
  }

  return {
    disposition: PREPARED_EFFECT_OBSERVATION_DISPOSITION.STABLE_SAME_OWNER,
    superseded: false,
    targetBusy: false,
    hashChanged: false,
    epochChanged: false,
    sourceHash,
    currentHash,
    sourceEpoch,
    currentEpoch,
    reason: "SAME_OWNER_STABLE"
  };
}

