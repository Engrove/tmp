import {
  SESSION_CONTEXT_BASELINE_COMMIT_STATUS,
  SESSION_CONTEXT_INIT_STATE,
  SESSION_CONTEXT_READY_FINALIZATION_STATUS
} from "./session-context-init.mjs";

export const NANO_UNCLAIMED_REQUEST_TIMEOUT_MS = 45_000;
export const NANO_UNCLAIMED_REQUEST_MAX_REARMS = 3;
export const NANO_UNCLAIMED_RECOVERY_ACTION = Object.freeze({
  WAIT: "WAIT",
  REARM: "REARM",
  FAIL: "FAIL"
});

export function pendingSessionInitNanoRequest(run) {
  const request = run?.pendingNanoRequest;
  if (!request || request.status !== "PENDING" || request.claimId) return null;
  if (run?.sessionContextInit?.state !== SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING) return null;
  return request;
}

export function nanoRequestClaimEligible(run) {
  const request = run?.pendingNanoRequest;
  if (!request || request.status !== "PENDING" || request.claimId) return false;
  if (["AWAITING_OPERATOR_ACTION", "AWAITING_OPERATOR_DECISION"].includes(run?.state)) return false;
  return run?.state === "ASSESSING" ||
    run?.sessionContextInit?.state === SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING;
}

export function nanoAnalysisStateNeedsRepair(run) {
  return Boolean(pendingSessionInitNanoRequest(run)) && run?.state !== "ASSESSING";
}

export function nanoAnalysisWaitInvariant(run) {
  const request = pendingSessionInitNanoRequest(run);
  const invalid = Boolean(request) && run?.state === "WAITING_FOR_RESPONSE";
  return {
    valid: !invalid,
    code: invalid ? "NANO_ANALYZING_PENDING_REQUEST_FALSE_WAIT" : "",
    requestId: request?.requestId || "",
    initState: run?.sessionContextInit?.state || "",
    runState: run?.state || ""
  };
}

export function evaluateUnclaimedNanoRequestStall(
  run,
  { now = Date.now(), limitMs = NANO_UNCLAIMED_REQUEST_TIMEOUT_MS } = {}
) {
  const request = pendingSessionInitNanoRequest(run);
  if (!request) {
    return {
      stalled: false,
      code: "",
      requestId: "",
      ageMs: 0,
      limitMs
    };
  }

  const startedAt = Date.parse(
    request.claimAvailableAt ||
    request.requeuedAt ||
    request.createdAt ||
    run?.sessionContextInit?.updatedAt ||
    run?.updatedAt ||
    ""
  );
  const ageMs = Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : 0;
  return {
    stalled: Number.isFinite(startedAt) && ageMs >= limitMs,
    code: "NANO_REQUEST_UNCLAIMED_TIMEOUT",
    requestId: request.requestId || "",
    ageMs,
    limitMs
  };
}

export function planUnclaimedNanoRequestRecovery(
  run,
  {
    now = Date.now(),
    limitMs = NANO_UNCLAIMED_REQUEST_TIMEOUT_MS,
    maxRearms = NANO_UNCLAIMED_REQUEST_MAX_REARMS
  } = {}
) {
  const stall = evaluateUnclaimedNanoRequestStall(run, { now, limitMs });
  if (!stall.stalled) {
    return {
      ...stall,
      action: NANO_UNCLAIMED_RECOVERY_ACTION.WAIT,
      rearmCount: Math.max(0, Number(run?.pendingNanoRequest?.unclaimedRearmCount || 0)),
      nextRearmCount: Math.max(0, Number(run?.pendingNanoRequest?.unclaimedRearmCount || 0))
    };
  }

  const rearmCount = Math.max(0, Number(run?.pendingNanoRequest?.unclaimedRearmCount || 0));
  if (rearmCount < Math.max(0, Number(maxRearms || 0))) {
    return {
      ...stall,
      action: NANO_UNCLAIMED_RECOVERY_ACTION.REARM,
      rearmCount,
      nextRearmCount: rearmCount + 1
    };
  }

  return {
    ...stall,
    action: NANO_UNCLAIMED_RECOVERY_ACTION.FAIL,
    rearmCount,
    nextRearmCount: rearmCount
  };
}

export function storageRecoverySemanticState(run) {
  const commit = run?.sessionContextInit?.baselineDecisionCommit;
  const commitPending = Boolean(
    commit?.requestId &&
    (
      commit.commitStatus !== SESSION_CONTEXT_BASELINE_COMMIT_STATUS.COMMITTED ||
      commit.readyStatus !== SESSION_CONTEXT_READY_FINALIZATION_STATUS.READY
    )
  );
  if (commitPending) {
    return {
      resumeState: "ASSESSING",
      requestId: commit.requestId || "",
      sessionContextInitState: SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING
    };
  }

  const request = pendingSessionInitNanoRequest(run);
  if (!request) {
    return {
      resumeState: "",
      requestId: "",
      sessionContextInitState: run?.sessionContextInit?.state || ""
    };
  }
  return {
    resumeState: "ASSESSING",
    requestId: request.requestId || "",
    sessionContextInitState: SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING
  };
}
