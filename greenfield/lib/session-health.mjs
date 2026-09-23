export const SESSION_HEALTH_SCHEMA = "eic.greenfield.session-health.v1";
export const SESSION_HEALTH_SAMPLE_LIMIT = 8;
export const SESSION_HEALTH_BASELINE_MIN_SAMPLES = 3;

function finiteMs(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function finiteCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function boundedSamples(samples) {
  return Array.isArray(samples)
    ? samples.slice(-SESSION_HEALTH_SAMPLE_LIMIT).map((sample) => ({ ...sample }))
    : [];
}

export function createSessionHealthState({
  sessionSeq = 1,
  sessionStartTurn = 1,
  now = Date.now()
} = {}) {
  return {
    schema: SESSION_HEALTH_SCHEMA,
    sessionSeq: Math.max(1, finiteCount(sessionSeq)),
    sessionStartTurn: Math.max(1, finiteCount(sessionStartTurn)),
    startedAtMs: finiteMs(now) ?? Date.now(),
    promptsPosted: 0,
    managedPromptChars: 0,
    capturedResponseChars: 0,
    recoveryChurn: 0,
    activeTurn: null,
    samples: []
  };
}

export function normalizeSessionHealthState(value, {
  sessionSeq = 1,
  sessionStartTurn = 1,
  now = Date.now()
} = {}) {
  if (!value || value.schema !== SESSION_HEALTH_SCHEMA) {
    return createSessionHealthState({ sessionSeq, sessionStartTurn, now });
  }
  return {
    schema: SESSION_HEALTH_SCHEMA,
    sessionSeq: Math.max(1, finiteCount(value.sessionSeq || sessionSeq)),
    sessionStartTurn: Math.max(1, finiteCount(value.sessionStartTurn || sessionStartTurn)),
    startedAtMs: finiteMs(value.startedAtMs) ?? finiteMs(now) ?? Date.now(),
    promptsPosted: finiteCount(value.promptsPosted),
    managedPromptChars: finiteCount(value.managedPromptChars),
    capturedResponseChars: finiteCount(value.capturedResponseChars),
    recoveryChurn: finiteCount(value.recoveryChurn),
    activeTurn: value.activeTurn && typeof value.activeTurn === "object"
      ? {
          promptHash: String(value.activeTurn.promptHash || "").slice(0, 128),
          turn: finiteCount(value.activeTurn.turn),
          postedAtMs: finiteMs(value.activeTurn.postedAtMs),
          firstResponseObservedAtMs: finiteMs(value.activeTurn.firstResponseObservedAtMs),
          recoveryChurnAtPost: finiteCount(value.activeTurn.recoveryChurnAtPost),
          timingEligible: value.activeTurn.timingEligible !== false
        }
      : null,
    samples: boundedSamples(value.samples)
  };
}

export function resetSessionHealthForRotation(value, {
  sessionSeq,
  sessionStartTurn,
  now = Date.now()
} = {}) {
  return createSessionHealthState({
    sessionSeq: Math.max(1, finiteCount(sessionSeq)),
    sessionStartTurn: Math.max(1, finiteCount(sessionStartTurn)),
    now
  });
}

export function markSessionHealthPromptPosted(value, {
  sessionSeq = 1,
  turn = 1,
  promptHash = "",
  promptChars = 0,
  postedAtMs = Date.now(),
  timingEligible = true
} = {}) {
  const state = normalizeSessionHealthState(value, { sessionSeq, sessionStartTurn: turn, now: postedAtMs });
  const hash = String(promptHash || "").slice(0, 128);
  if (hash && state.activeTurn?.promptHash === hash) return state;
  return {
    ...state,
    sessionSeq: Math.max(1, finiteCount(sessionSeq)),
    promptsPosted: state.promptsPosted + 1,
    managedPromptChars: state.managedPromptChars + finiteCount(promptChars),
    activeTurn: {
      promptHash: hash,
      turn: Math.max(1, finiteCount(turn)),
      postedAtMs: finiteMs(postedAtMs),
      firstResponseObservedAtMs: null,
      recoveryChurnAtPost: state.recoveryChurn,
      timingEligible: timingEligible === true
    }
  };
}

export function markSessionHealthFirstResponse(value, {
  promptHash = "",
  observedAtMs = Date.now()
} = {}) {
  const state = normalizeSessionHealthState(value);
  const active = state.activeTurn;
  if (!active) return state;
  const hash = String(promptHash || "").slice(0, 128);
  if (hash && active.promptHash && hash !== active.promptHash) return state;
  if (active.firstResponseObservedAtMs != null) return state;
  return {
    ...state,
    activeTurn: {
      ...active,
      firstResponseObservedAtMs: finiteMs(observedAtMs)
    }
  };
}

export function markSessionHealthRecovery(value, count = 1) {
  const state = normalizeSessionHealthState(value);
  return {
    ...state,
    recoveryChurn: state.recoveryChurn + Math.max(1, finiteCount(count))
  };
}

export function completeSessionHealthTurn(value, {
  promptHash = "",
  completedAtMs = Date.now(),
  responseChars = 0
} = {}) {
  let state = normalizeSessionHealthState(value);
  const active = state.activeTurn;
  if (!active) return state;
  const hash = String(promptHash || "").slice(0, 128);
  if (hash && active.promptHash && hash !== active.promptHash) return state;

  const completed = finiteMs(completedAtMs);
  const posted = finiteMs(active.postedAtMs);
  let first = finiteMs(active.firstResponseObservedAtMs);
  if (first == null && completed != null) first = completed;

  const ttfrMs = posted != null && first != null ? Math.max(0, first - posted) : null;
  const completionMs = first != null && completed != null ? Math.max(0, completed - first) : null;
  const totalMs = posted != null && completed != null ? Math.max(0, completed - posted) : null;
  const clean = active.timingEligible !== false &&
    state.recoveryChurn === finiteCount(active.recoveryChurnAtPost);

  const sample = {
    turn: finiteCount(active.turn),
    ttfrMs,
    completionMs,
    totalMs,
    responseChars: finiteCount(responseChars),
    clean
  };

  state = {
    ...state,
    capturedResponseChars: state.capturedResponseChars + finiteCount(responseChars),
    activeTurn: null,
    samples: boundedSamples([...state.samples, sample])
  };
  return state;
}

function cleanTtfrSamples(state) {
  return state.samples
    .filter((sample) => sample?.clean === true && Number.isFinite(sample?.ttfrMs))
    .map((sample) => Number(sample.ttfrMs));
}

export function sessionHealthCapsule(value, {
  turn = 1,
  sessionSeq = 1,
  sessionStartTurn = turn
} = {}) {
  const state = normalizeSessionHealthState(value, { sessionSeq, sessionStartTurn });
  const cleanTtfr = cleanTtfrSamples(state);
  const latest = state.samples.length ? state.samples[state.samples.length - 1] : null;
  const baselineSource = cleanTtfr.length >= SESSION_HEALTH_BASELINE_MIN_SAMPLES
    ? cleanTtfr.slice(0, -1)
    : [];
  const fallbackBaselineSource = baselineSource.length >= SESSION_HEALTH_BASELINE_MIN_SAMPLES
    ? baselineSource
    : cleanTtfr.slice(0, Math.max(0, cleanTtfr.length - 1));
  const baselineMs = fallbackBaselineSource.length >= SESSION_HEALTH_BASELINE_MIN_SAMPLES
    ? median(fallbackBaselineSource)
    : null;
  const latestTtfrMs = Number.isFinite(latest?.ttfrMs) ? Number(latest.ttfrMs) : null;
  const ttfrRatio = baselineMs && latestTtfrMs != null
    ? Math.round((latestTtfrMs / baselineMs) * 100) / 100
    : null;

  const recentClean = cleanTtfr.slice(-3);
  let latencyTrend = "UNKNOWN";
  if (recentClean.length >= 3) {
    const prior = median(recentClean.slice(0, -1));
    const current = recentClean[recentClean.length - 1];
    if (prior > 0 && current >= prior * 1.5) latencyTrend = "RISING";
    else if (prior > 0 && current <= prior * 0.75) latencyTrend = "FALLING";
    else latencyTrend = "STABLE";
  }

  const managedContextChars = state.managedPromptChars + state.capturedResponseChars;
  const signals = [];
  if (state.promptsPosted >= 20) signals.push("LONG_SESSION");
  if (managedContextChars >= 200_000) signals.push("LARGE_MANAGED_CONTEXT");
  if (ttfrRatio != null && ttfrRatio >= 2.5) signals.push("TTFR_HIGH_RELATIVE");
  else if (ttfrRatio != null && ttfrRatio >= 1.75) signals.push("TTFR_RISING");
  if (state.recoveryChurn >= 2) signals.push("RECOVERY_CHURN");

  let pressureBand = "LOW";
  if (signals.length === 1) pressureBand = "WATCH";
  else if (signals.length === 2) pressureBand = "ELEVATED";
  else if (signals.length >= 3) pressureBand = "HIGH";

  return {
    schema: SESSION_HEALTH_SCHEMA,
    sessionSeq: state.sessionSeq,
    sessionStartTurn: state.sessionStartTurn,
    sessionTurns: state.promptsPosted,
    managedPromptChars: state.managedPromptChars,
    capturedResponseChars: state.capturedResponseChars,
    managedContextChars,
    sampleCount: state.samples.length,
    cleanSampleCount: cleanTtfr.length,
    ttfrMs: latestTtfrMs,
    ttfrBaselineMs: baselineMs,
    ttfrRatio,
    completionMs: Number.isFinite(latest?.completionMs) ? Number(latest.completionMs) : null,
    responseRoundTripMs: Number.isFinite(latest?.totalMs) ? Number(latest.totalMs) : null,
    latencyTrend,
    recoveryChurn: state.recoveryChurn,
    pressureBand,
    signals
  };
}
