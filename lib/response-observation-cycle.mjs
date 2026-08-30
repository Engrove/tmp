import { nowIso, sanitizeText } from "./common.mjs";

export const RESPONSE_OBSERVATION_CYCLE_SCHEMA = "eic.autonom.response-observation-cycle.v1";

export const RESPONSE_OBSERVATION_CYCLE_STATUS = Object.freeze({
  IDLE: "IDLE",
  OBSERVING: "OBSERVING",
  SETTLED: "SETTLED",
  CONSUMED: "CONSUMED",
  SUPERSEDED: "SUPERSEDED",
  FAILED: "FAILED"
});

export const RESPONSE_OBSERVATION_OWNER_KIND = Object.freeze({
  SESSION_CATCH: "SESSION_CATCH",
  EFFECT_RESPONSE: "EFFECT_RESPONSE",
  UNBOUND: "UNBOUND"
});

export const RESPONSE_CANDIDATE_DISPOSITION = Object.freeze({
  NONE: "NONE",
  ACTIVE: "ACTIVE",
  EFFECT_NOT_ACKED: "EFFECT_NOT_ACKED",
  SOURCE_OBSERVATION: "SOURCE_OBSERVATION",
  ALREADY_PROCESSED: "ALREADY_PROCESSED",
  OWNER_MISMATCH: "OWNER_MISMATCH",
  PAGE_MISMATCH: "PAGE_MISMATCH"
});

function effectStatus(effect = null) {
  return String(effect?.status || "").trim().toUpperCase();
}

function effectId(effect = null) {
  return sanitizeText(effect?.effectId, 180);
}

function responseIdentityFromCandidate(candidate = {}) {
  return sanitizeText(candidate?.responseIdentity, 512);
}

function responseRef({
  hash = "",
  identity = ""
} = {}) {
  return {
    hash: sanitizeText(hash, 128),
    identity: sanitizeText(identity, 512)
  };
}

/**
 * v0.11.18 response identity semantics.
 *
 * A full response identity (conversation + task fingerprint + response hash) is
 * authoritative when it exists on both sides.  Hash equality is only a legacy/
 * partial fallback.  This prevents two different assistant turns that happen to
 * render byte-identical text from being collapsed into one lifecycle generation.
 */
export function responseEvidenceMatches(leftValue = {}, rightValue = {}) {
  const left = responseRef(leftValue);
  const right = responseRef(rightValue);
  if (left.identity && right.identity) return left.identity === right.identity;
  return Boolean(left.hash && right.hash && left.hash === right.hash);
}

function candidateRef(candidate = {}) {
  return responseRef({
    hash: candidate?.hash,
    identity: candidate?.responseIdentity
  });
}

function observationRef(observation = {}) {
  return responseRef({
    hash: observation?.responseHash ?? observation?.hash,
    identity: observation?.responseIdentity
  });
}

function processedRef(run = {}) {
  return responseRef({
    hash: run?.lastProcessedAssistantHash,
    identity: run?.lastProcessedResponseIdentity
  });
}

function effectSourceRef(effect = {}) {
  return responseRef({
    hash: effect?.sourceObservationHash,
    identity: effect?.sourceObservationIdentity
  });
}

export function createResponseObservationCycle({
  runId = "",
  now = Date.now()
} = {}) {
  return {
    schema: RESPONSE_OBSERVATION_CYCLE_SCHEMA,
    status: RESPONSE_OBSERVATION_CYCLE_STATUS.IDLE,
    generation: 0,
    runId: sanitizeText(runId, 180),
    ownerKind: RESPONSE_OBSERVATION_OWNER_KIND.UNBOUND,
    ownerKey: "",
    ownerEffectId: "",
    sourceObservationHash: "",
    sourceObservationIdentity: "",
    candidateHash: "",
    candidateResponseIdentity: "",
    startedAt: null,
    updatedAt: nowIso(now),
    completedAt: null,
    reason: ""
  };
}

export function deriveResponseObservationOwner(run = {}, effect = null) {
  const id = effectId(effect);
  const sourceObservationHash = sanitizeText(effect?.sourceObservationHash, 128);
  const sourceObservationIdentity = sanitizeText(effect?.sourceObservationIdentity, 512);
  if (id) {
    return {
      kind: RESPONSE_OBSERVATION_OWNER_KIND.EFFECT_RESPONSE,
      key: `effect-response:${id}`,
      effectId: id,
      effectStatus: effectStatus(effect),
      sourceObservationHash,
      sourceObservationIdentity,
      admissionReady: effectStatus(effect) === "ACKED"
    };
  }

  const initNeedKey = sanitizeText(run?.sessionContextInit?.needKey, 240);
  if (initNeedKey) {
    const pendingSource = observationRef(run?.pendingObservation);
    return {
      kind: RESPONSE_OBSERVATION_OWNER_KIND.SESSION_CATCH,
      key: `session-catch:${initNeedKey}`,
      effectId: "",
      effectStatus: "",
      sourceObservationHash: pendingSource.hash,
      sourceObservationIdentity: pendingSource.identity,
      admissionReady: true
    };
  }

  return {
    kind: RESPONSE_OBSERVATION_OWNER_KIND.UNBOUND,
    key: `run:${sanitizeText(run?.runId, 180) || "unknown"}:observation:${Math.max(0, Number(run?.observationGeneration || 0))}`,
    effectId: "",
    effectStatus: "",
    sourceObservationHash: "",
    sourceObservationIdentity: "",
    admissionReady: true
  };
}

export function classifyResponseCandidateOwnership(
  run = {},
  effect = null,
  page = {},
  {
    pageResponseIdentity = "",
    allowProcessedReobserve = false
  } = {}
) {
  const owner = deriveResponseObservationOwner(run, effect);
  const candidate = run?.responseCandidate || null;
  const candidateHash = sanitizeText(candidate?.hash, 128);
  const candidateIdentity = responseIdentityFromCandidate(candidate);
  const pageHash = sanitizeText(page?.latestAssistantHash, 128);
  const pageIdentity = sanitizeText(pageResponseIdentity, 512);
  const processedHash = sanitizeText(run?.lastProcessedAssistantHash, 128);
  const processedIdentity = sanitizeText(run?.lastProcessedResponseIdentity, 512);
  const sourceHash = sanitizeText(owner.sourceObservationHash, 128);
  const sourceIdentity = sanitizeText(owner.sourceObservationIdentity, 512);

  const pageRef = responseRef({ hash: pageHash, identity: pageIdentity });
  const candidateResponseRef = responseRef({ hash: candidateHash, identity: candidateIdentity });
  const sourceRef = responseRef({ hash: sourceHash, identity: sourceIdentity });
  const pendingObservationRef = observationRef(run?.pendingObservation);
  const alreadyProcessedRef = responseRef({ hash: processedHash, identity: processedIdentity });

  const pageIsOwnerSource = responseEvidenceMatches(pageRef, sourceRef);
  const pageIsPendingObservation = responseEvidenceMatches(pageRef, pendingObservationRef);
  const pageIsSource = pageIsOwnerSource || pageIsPendingObservation;
  const pageAlreadyProcessed = responseEvidenceMatches(pageRef, alreadyProcessedRef);
  const candidateIsOwnerSource = responseEvidenceMatches(candidateResponseRef, sourceRef);
  const candidateIsPendingObservation = responseEvidenceMatches(candidateResponseRef, pendingObservationRef);
  const candidateIsSource = candidateIsOwnerSource || candidateIsPendingObservation;
  const candidateAlreadyProcessed = responseEvidenceMatches(candidateResponseRef, alreadyProcessedRef);
  const candidateOwnerMismatch = Boolean(
    candidate &&
    sanitizeText(candidate.ownerKey, 320) &&
    sanitizeText(candidate.ownerKey, 320) !== owner.key
  );
  const candidatePageMismatch = Boolean(
    candidate &&
    (pageRef.identity || pageRef.hash) &&
    (candidateResponseRef.identity || candidateResponseRef.hash) &&
    !responseEvidenceMatches(candidateResponseRef, pageRef)
  );

  let disposition = RESPONSE_CANDIDATE_DISPOSITION.NONE;
  let clearCandidate = false;

  if (candidate) {
    if (!owner.admissionReady) {
      disposition = RESPONSE_CANDIDATE_DISPOSITION.EFFECT_NOT_ACKED;
      clearCandidate = true;
    } else if (candidateIsSource) {
      disposition = RESPONSE_CANDIDATE_DISPOSITION.SOURCE_OBSERVATION;
      clearCandidate = true;
    } else if (candidateAlreadyProcessed && !allowProcessedReobserve) {
      disposition = RESPONSE_CANDIDATE_DISPOSITION.ALREADY_PROCESSED;
      clearCandidate = true;
    } else if (candidateOwnerMismatch) {
      disposition = RESPONSE_CANDIDATE_DISPOSITION.OWNER_MISMATCH;
      clearCandidate = true;
    } else if (candidatePageMismatch) {
      disposition = RESPONSE_CANDIDATE_DISPOSITION.PAGE_MISMATCH;
      clearCandidate = true;
    } else {
      disposition = RESPONSE_CANDIDATE_DISPOSITION.ACTIVE;
    }
  }

  const allowCandidateAdmission = Boolean(
    owner.admissionReady &&
    !pageIsSource &&
    (!pageAlreadyProcessed || allowProcessedReobserve)
  );

  return {
    owner,
    disposition,
    clearCandidate,
    allowCandidateAdmission,
    pageIsSource,
    pageIsOwnerSource,
    pageIsPendingObservation,
    pageAlreadyProcessed,
    candidateIsSource,
    candidateIsOwnerSource,
    candidateIsPendingObservation,
    candidateAlreadyProcessed,
    candidateOwnerMismatch,
    candidatePageMismatch
  };
}

export function bindResponseCandidateOwner(candidateValue, owner = {}, {
  responseIdentity = ""
} = {}) {
  if (!candidateValue || typeof candidateValue !== "object") return null;
  return {
    ...candidateValue,
    ownerKind: sanitizeText(owner?.kind, 80),
    ownerKey: sanitizeText(owner?.key, 320),
    ownerEffectId: sanitizeText(owner?.effectId, 180),
    sourceObservationHash: sanitizeText(owner?.sourceObservationHash, 128),
    sourceObservationIdentity: sanitizeText(owner?.sourceObservationIdentity, 512),
    responseIdentity: sanitizeText(responseIdentity, 512)
  };
}

export function updateResponseObservationCycle(cycleValue, {
  status,
  owner = null,
  candidate = null,
  reason = "",
  now = Date.now()
} = {}) {
  const previous = cycleValue?.schema === RESPONSE_OBSERVATION_CYCLE_SCHEMA
    ? cycleValue
    : createResponseObservationCycle({ now });
  const nextStatus = Object.values(RESPONSE_OBSERVATION_CYCLE_STATUS).includes(status)
    ? status
    : previous.status;
  const ownerKey = sanitizeText(owner?.key ?? previous.ownerKey, 320);
  const ownerChanged = Boolean(ownerKey && ownerKey !== sanitizeText(previous.ownerKey, 320));
  const at = nowIso(now);
  const active = [
    RESPONSE_OBSERVATION_CYCLE_STATUS.OBSERVING,
    RESPONSE_OBSERVATION_CYCLE_STATUS.SETTLED
  ].includes(nextStatus);
  const previousActive = [
    RESPONSE_OBSERVATION_CYCLE_STATUS.OBSERVING,
    RESPONSE_OBSERVATION_CYCLE_STATUS.SETTLED
  ].includes(previous.status);
  const nextCandidateRef = responseRef({
    hash: candidate?.hash,
    identity: candidate?.responseIdentity
  });
  const previousCandidateRef = responseRef({
    hash: previous?.candidateHash,
    identity: previous?.candidateResponseIdentity
  });
  const candidateChanged = Boolean(
    nextCandidateRef.hash &&
    previousCandidateRef.hash &&
    !responseEvidenceMatches(nextCandidateRef, previousCandidateRef)
  );
  const startsNewGeneration = Boolean(
    active && (!previousActive || ownerChanged || candidateChanged)
  );
  return {
    ...previous,
    status: nextStatus,
    generation: Math.max(0, Number(previous.generation || 0)) + (startsNewGeneration ? 1 : 0),
    ownerKind: sanitizeText(owner?.kind ?? previous.ownerKind, 80),
    ownerKey,
    ownerEffectId: sanitizeText(owner?.effectId ?? previous.ownerEffectId, 180),
    sourceObservationHash: sanitizeText(
      owner?.sourceObservationHash ?? previous.sourceObservationHash,
      128
    ),
    sourceObservationIdentity: sanitizeText(
      owner?.sourceObservationIdentity ?? previous.sourceObservationIdentity,
      512
    ),
    candidateHash: sanitizeText(candidate?.hash, 128),
    candidateResponseIdentity: sanitizeText(candidate?.responseIdentity, 512),
    startedAt: active
      ? (startsNewGeneration || !previous.startedAt ? at : previous.startedAt)
      : previous.startedAt,
    updatedAt: at,
    completedAt: active ? null : at,
    reason: sanitizeText(reason, 800)
  };
}

/**
 * Retire the current response-candidate owner in one place.  All branches that
 * hand a settled assistant response to another lifecycle owner use this helper,
 * so an early return cannot leave the same response active in two owners.
 */
export function retireResponseCandidate(runValue = {}, {
  status = RESPONSE_OBSERVATION_CYCLE_STATUS.CONSUMED,
  owner = null,
  observation = null,
  reason = "RESPONSE_CANDIDATE_RETIRED",
  now = Date.now()
} = {}) {
  const run = runValue && typeof runValue === "object" ? runValue : {};
  const candidate = run.responseCandidate || null;
  const observationResponseRef = observation ? observationRef(observation) : null;
  const candidateResponseRef = candidate ? candidateRef(candidate) : null;
  const cycle = run.responseObservationCycle || null;
  const cycleActive = Boolean(cycle && [
    RESPONSE_OBSERVATION_CYCLE_STATUS.OBSERVING,
    RESPONSE_OBSERVATION_CYCLE_STATUS.SETTLED
  ].includes(cycle.status));
  const cycleResponseRef = responseRef({
    hash: cycle?.candidateHash,
    identity: cycle?.candidateResponseIdentity
  });

  // Processing an older observation must never erase a causally newer response
  // candidate that arrived while the older observation was being assessed.
  if (observationResponseRef && candidateResponseRef &&
      !responseEvidenceMatches(candidateResponseRef, observationResponseRef)) {
    return run;
  }
  if (observationResponseRef && !candidateResponseRef && cycleActive &&
      cycleResponseRef.hash &&
      !responseEvidenceMatches(cycleResponseRef, observationResponseRef)) {
    return run;
  }

  const receiptCandidate = candidate || (observation ? {
    hash: observationResponseRef?.hash || "",
    responseIdentity: observationResponseRef?.identity || ""
  } : null);
  return {
    ...run,
    responseCandidate: null,
    responseSettleFailure: null,
    responseObservationCycle: updateResponseObservationCycle(
      run.responseObservationCycle,
      {
        status,
        owner,
        candidate: receiptCandidate,
        reason,
        now
      }
    )
  };
}

/**
 * RESPONSE_CANDIDATE -> PENDING_OBSERVATION is a transfer, never a copy.
 * The returned run has exactly one active semantic owner for the response.
 */
export function transferResponseCandidateToObservation(runValue = {}, observation = {}, {
  owner = null,
  reason = "CANDIDATE_TO_PENDING_OBSERVATION",
  now = Date.now()
} = {}) {
  const run = runValue && typeof runValue === "object" ? runValue : {};
  const candidate = run.responseCandidate || null;
  const candidateResponse = candidateRef(candidate);
  const nextObservationRef = observationRef(observation);
  const matches = !candidate || responseEvidenceMatches(candidateResponse, nextObservationRef);
  if (!matches) {
    return {
      ...run,
      responseOwnershipViolation: {
        schema: "eic.autonom.response-ownership-violation.v1",
        code: "CANDIDATE_OBSERVATION_IDENTITY_MISMATCH",
        candidateHash: candidateResponse.hash,
        candidateResponseIdentity: candidateResponse.identity,
        observationHash: nextObservationRef.hash,
        observationResponseIdentity: nextObservationRef.identity,
        detectedAt: nowIso(now)
      }
    };
  }
  const withObservation = {
    ...run,
    pendingObservation: observation,
    responseOwnershipViolation: null
  };
  return retireResponseCandidate(withObservation, {
    status: RESPONSE_OBSERVATION_CYCLE_STATUS.CONSUMED,
    owner,
    observation,
    reason,
    now
  });
}

export function responseObservationCycleInvariant(run = {}, effect = null) {
  const cycle = run?.responseObservationCycle || null;
  const candidate = run?.responseCandidate || null;
  const owner = deriveResponseObservationOwner(run, effect);
  const active = cycle && [
    RESPONSE_OBSERVATION_CYCLE_STATUS.OBSERVING,
    RESPONSE_OBSERVATION_CYCLE_STATUS.SETTLED
  ].includes(cycle.status);
  const candidateHash = sanitizeText(candidate?.hash, 128);
  const processedHash = sanitizeText(run?.lastProcessedAssistantHash, 128);
  const problems = [];

  if (candidate && responseEvidenceMatches(candidateRef(candidate), processedRef(run))) {
    problems.push("PROCESSED_RESPONSE_STILL_ACTIVE_CANDIDATE");
  }
  if (candidate && responseEvidenceMatches(candidateRef(candidate), observationRef(run?.pendingObservation))) {
    problems.push("PENDING_OBSERVATION_STILL_ACTIVE_CANDIDATE");
  }
  if (candidate && effect && effectStatus(effect) !== "ACKED") {
    problems.push("CANDIDATE_ACTIVE_BEFORE_EFFECT_ACK");
  }
  if (candidate && responseEvidenceMatches(
    candidateRef(candidate),
    responseRef({
      hash: candidate?.sourceObservationHash,
      identity: candidate?.sourceObservationIdentity
    })
  )) {
    problems.push("SOURCE_RESPONSE_OWNS_NEXT_RESPONSE_CYCLE");
  }
  if (active && !candidate) {
    problems.push("ACTIVE_RESPONSE_CYCLE_WITHOUT_CANDIDATE");
  }
  if (active && cycle.ownerKey && owner.key && cycle.ownerKey !== owner.key) {
    problems.push("ACTIVE_RESPONSE_CYCLE_OWNER_MISMATCH");
  }
  if (["ERROR_TERMINAL", "PROGRAM_DONE", "STOPPED"].includes(String(run?.state || "")) && active) {
    problems.push("TERMINAL_RUN_HAS_ACTIVE_RESPONSE_CYCLE");
  }
  return {
    valid: problems.length === 0,
    problems,
    owner
  };
}
