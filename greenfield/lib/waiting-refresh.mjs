export const WAITING_STALE_INTERVAL_MS = 30 * 60 * 1000;

// Backward-compatible aliases retained for older deterministic imports. In v1.1.11
// the entire stale-session ladder advances on one 30-minute cadence; there is no
// separate 90-second refresh grace window anymore.
export const WAITING_REFRESH_AFTER_MS = WAITING_STALE_INTERVAL_MS;
export const WAITING_REFRESH_GRACE_MS = WAITING_STALE_INTERVAL_MS;

export const WAITING_REFRESH_ACTIONS = Object.freeze({
  WAIT: "WAIT",
  F5: "F5",
  CTRL_F5: "CTRL_F5",
  ROTATE: "ROTATE"
});

export const WAITING_REFRESH_STAGES = Object.freeze({
  NONE: "",
  F5_30: "F5_30",
  CTRL_F5_60: "CTRL_F5_60",
  CTRL_F5_90: "CTRL_F5_90"
});

function parseTime(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function normalizeWaitingRefreshStage(value) {
  const stage = String(value || "").trim().toUpperCase();
  if (!stage) return WAITING_REFRESH_STAGES.NONE;

  // v1.1.10 compatibility for persisted in-flight processes after extension update.
  if (stage === "F5") return WAITING_REFRESH_STAGES.F5_30;
  if (stage === "CTRL_F5") return WAITING_REFRESH_STAGES.CTRL_F5_60;

  if (Object.values(WAITING_REFRESH_STAGES).includes(stage)) return stage;
  return stage;
}

export function waitingAssistantMarker(page = {}) {
  return {
    lastAssistantId: String(page.lastAssistantId || ""),
    assistantHash: String(page.assistantHash || ""),
    assistantCount: normalizedCount(page.assistantCount)
  };
}

export function hasNewCompletedAssistantResponse({
  page = {},
  marker = {}
} = {}) {
  if (page.generating === true) return false;

  const current = waitingAssistantMarker(page);
  const prior = {
    lastAssistantId: String(marker.lastAssistantId || ""),
    assistantHash: String(marker.assistantHash || ""),
    assistantCount: normalizedCount(marker.assistantCount)
  };

  if (!current.lastAssistantId && !current.assistantHash) return false;

  // Count is the strongest cheap signal and also recognizes an identical-text reply.
  if (current.assistantCount != null &&
      prior.assistantCount != null &&
      current.assistantCount > prior.assistantCount) {
    return true;
  }

  // Message-id change is useful when counts are unavailable, but require a content
  // change as well so a pure DOM/reload identity rewrite does not reset stale time.
  if (current.lastAssistantId &&
      prior.lastAssistantId &&
      current.lastAssistantId !== prior.lastAssistantId &&
      current.assistantHash &&
      current.assistantHash !== prior.assistantHash) {
    return true;
  }

  // Final fallback for surfaces where message id/count are unavailable.
  if ((current.assistantCount == null || prior.assistantCount == null) &&
      (!current.lastAssistantId || !prior.lastAssistantId) &&
      current.assistantHash &&
      current.assistantHash !== prior.assistantHash) {
    return true;
  }

  return false;
}

export function createWaitingRefreshState({
  now = Date.now(),
  page = {},
  promptHash = "",
  turn = 0,
  staleSince = ""
} = {}) {
  const marker = waitingAssistantMarker(page);
  return {
    stage: WAITING_REFRESH_STAGES.NONE,
    requestedAt: "",
    requestId: "",
    staleSince: staleSince || new Date(now).toISOString(),
    resetCount: 0,
    lastAssistantObservedAt: "",
    ...marker,
    promptHash: String(promptHash || ""),
    turn: Number(turn || 0),
    bypassCache: false
  };
}

export function resetWaitingRefreshOnAssistantResponse({
  current = null,
  page = {},
  now = Date.now(),
  promptHash = "",
  turn = 0
} = {}) {
  const base = current && typeof current === "object"
    ? current
    : createWaitingRefreshState({ now, page, promptHash, turn });

  if (!hasNewCompletedAssistantResponse({
    page,
    marker: {
      lastAssistantId: base.lastAssistantId,
      assistantHash: base.assistantHash,
      assistantCount: base.assistantCount
    }
  })) {
    return { reset: false, state: base };
  }

  const marker = waitingAssistantMarker(page);
  return {
    reset: true,
    state: {
      ...base,
      stage: WAITING_REFRESH_STAGES.NONE,
      requestedAt: "",
      requestId: "",
      staleSince: new Date(now).toISOString(),
      resetCount: Number(base.resetCount || 0) + 1,
      lastAssistantObservedAt: new Date(now).toISOString(),
      ...marker,
      promptHash: String(promptHash || base.promptHash || ""),
      turn: Number(turn || base.turn || 0),
      bypassCache: false,
      triggerCode: ""
    }
  };
}

export function evaluateWaitingRefresh({
  now = Date.now(),
  staleSince = "",
  waitingSince = "",
  acknowledged = false,
  responseComplete = false,
  stage = ""
} = {}) {
  if (acknowledged !== true || responseComplete === true) {
    return {
      action: WAITING_REFRESH_ACTIONS.WAIT,
      code: responseComplete ? "RESPONSE_READY" : "PROMPT_NOT_ACKNOWLEDGED",
      waitMs: 0,
      stage: WAITING_REFRESH_STAGES.NONE
    };
  }

  const startedAt = parseTime(staleSince || waitingSince);
  const waitMs = startedAt == null ? 0 : Math.max(0, Number(now) - startedAt);
  const normalizedStage = normalizeWaitingRefreshStage(stage);

  if (startedAt == null) {
    return {
      action: WAITING_REFRESH_ACTIONS.WAIT,
      code: "STALE_SESSION_ANCHOR_MISSING",
      waitMs: 0,
      stage: normalizedStage
    };
  }

  if (!normalizedStage) {
    if (waitMs >= WAITING_STALE_INTERVAL_MS) {
      return {
        action: WAITING_REFRESH_ACTIONS.F5,
        code: "STALE_SESSION_30M_F5",
        waitMs,
        stage: WAITING_REFRESH_STAGES.F5_30
      };
    }
    return {
      action: WAITING_REFRESH_ACTIONS.WAIT,
      code: "STALE_SESSION_WITHIN_30M",
      waitMs,
      stage: WAITING_REFRESH_STAGES.NONE
    };
  }

  if (normalizedStage === WAITING_REFRESH_STAGES.F5_30) {
    if (waitMs >= 2 * WAITING_STALE_INTERVAL_MS) {
      return {
        action: WAITING_REFRESH_ACTIONS.CTRL_F5,
        code: "STALE_SESSION_60M_CTRL_F5",
        waitMs,
        stage: WAITING_REFRESH_STAGES.CTRL_F5_60
      };
    }
    return {
      action: WAITING_REFRESH_ACTIONS.WAIT,
      code: "STALE_SESSION_30_TO_60M",
      waitMs,
      stage: WAITING_REFRESH_STAGES.F5_30
    };
  }

  if (normalizedStage === WAITING_REFRESH_STAGES.CTRL_F5_60) {
    if (waitMs >= 3 * WAITING_STALE_INTERVAL_MS) {
      return {
        action: WAITING_REFRESH_ACTIONS.CTRL_F5,
        code: "STALE_SESSION_90M_CTRL_F5",
        waitMs,
        stage: WAITING_REFRESH_STAGES.CTRL_F5_90
      };
    }
    return {
      action: WAITING_REFRESH_ACTIONS.WAIT,
      code: "STALE_SESSION_60_TO_90M",
      waitMs,
      stage: WAITING_REFRESH_STAGES.CTRL_F5_60
    };
  }

  if (normalizedStage === WAITING_REFRESH_STAGES.CTRL_F5_90) {
    if (waitMs >= 4 * WAITING_STALE_INTERVAL_MS) {
      return {
        action: WAITING_REFRESH_ACTIONS.ROTATE,
        code: "STALE_SESSION_120M_ROTATE",
        waitMs,
        stage: WAITING_REFRESH_STAGES.CTRL_F5_90
      };
    }
    return {
      action: WAITING_REFRESH_ACTIONS.WAIT,
      code: "STALE_SESSION_90_TO_120M",
      waitMs,
      stage: WAITING_REFRESH_STAGES.CTRL_F5_90
    };
  }

  return {
    action: WAITING_REFRESH_ACTIONS.WAIT,
    code: "WAITING_REFRESH_STAGE_UNKNOWN",
    waitMs,
    stage: normalizedStage
  };
}
