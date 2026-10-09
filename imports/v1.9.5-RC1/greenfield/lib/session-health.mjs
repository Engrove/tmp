export const SESSION_HEALTH_SCHEMA = "eic.greenfield.session-health.v1";
export const SESSION_HEALTH_SAMPLE_LIMIT = 8;
export const SESSION_HEALTH_BASELINE_MIN_SAMPLES = 3;
// v1.9.3: completion-time baseline (clean samples before the latest one) and
// the window of recent turns whose provider/transport notices count as
// current pressure. Both are relative or event based; no wall-clock limit.
export const SESSION_HEALTH_COMPLETION_BASELINE_MIN_SAMPLES = 2;
export const SESSION_HEALTH_TRANSPORT_WINDOW = 3;
// Settle recovery pressure after three qualified completions while retaining
// the cumulative recovery count for diagnostics. No elapsed-time expiry.
export const SESSION_HEALTH_RECOVERY_CLEAN_WINDOW = 3;
export const PROVIDER_NOTICE_KINDS = Object.freeze({
  PROCESSING: "PROVIDER_PROCESSING",
  CONNECTION_INTERRUPTED: "CONNECTION_INTERRUPTED"
});

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

function transportFlags(value) {
  return {
    turn: finiteCount(value?.turn),
    processingNotice: value?.processingNotice === true,
    connectionInterrupted: value?.connectionInterrupted === true
  };
}

function boundedTransport(rows) {
  return Array.isArray(rows)
    ? rows.slice(-SESSION_HEALTH_TRANSPORT_WINDOW).map(transportFlags)
    : [];
}

function normalizeActiveNotice(value) {
  if (!value || typeof value !== "object") return null;
  const first = finiteMs(value.firstSeenAtMs);
  const last = finiteMs(value.lastSeenAtMs);
  if (first == null) return null;
  return { firstSeenAtMs: first, lastSeenAtMs: last ?? first };
}

function noticeDurationMs(notice) {
  return notice ? Math.max(0, Number(notice.lastSeenAtMs) - Number(notice.firstSeenAtMs)) : null;
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
    settledRecoveryChurn: 0,
    activeTurn: null,
    samples: [],
    carriedTransport: []
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
    settledRecoveryChurn: Math.min(finiteCount(value.settledRecoveryChurn), finiteCount(value.recoveryChurn)),
    activeTurn: value.activeTurn && typeof value.activeTurn === "object"
      ? {
          promptHash: String(value.activeTurn.promptHash || "").slice(0, 128),
          turn: finiteCount(value.activeTurn.turn),
          postedAtMs: finiteMs(value.activeTurn.postedAtMs),
          firstResponseObservedAtMs: finiteMs(value.activeTurn.firstResponseObservedAtMs),
          recoveryChurnAtPost: finiteCount(value.activeTurn.recoveryChurnAtPost),
          timingEligible: value.activeTurn.timingEligible !== false,
          promptChars: finiteCount(value.activeTurn.promptChars),
          processingNotice: normalizeActiveNotice(value.activeTurn.processingNotice),
          connectionInterrupted: normalizeActiveNotice(value.activeTurn.connectionInterrupted)
        }
      : null,
    samples: boundedSamples(value.samples),
    carriedTransport: boundedTransport(value.carriedTransport)
  };
}

// Provider/transport notices of the latest completed turns plus an unanswered
// active turn. A turn abandoned on a broken connection is the strongest
// pressure evidence, so it is kept even though it never completed.
function recentTransport(state) {
  const rows = [
    ...state.carriedTransport,
    ...state.samples.map(transportFlags)
  ];
  const active = state.activeTurn;
  if (active && (active.processingNotice || active.connectionInterrupted)) {
    rows.push({
      turn: finiteCount(active.turn),
      processingNotice: Boolean(active.processingNotice),
      connectionInterrupted: Boolean(active.connectionInterrupted)
    });
  }
  return rows.slice(-SESSION_HEALTH_TRANSPORT_WINDOW);
}

export function resetSessionHealthForRotation(value, {
  sessionSeq,
  sessionStartTurn,
  now = Date.now()
} = {}) {
  // v1.9.3: a new chat starts a new timing baseline, but provider/transport
  // notices of the last turns still describe current pressure.
  const previous = value && value.schema === SESSION_HEALTH_SCHEMA
    ? normalizeSessionHealthState(value)
    : null;
  return {
    ...createSessionHealthState({
      sessionSeq: Math.max(1, finiteCount(sessionSeq)),
      sessionStartTurn: Math.max(1, finiteCount(sessionStartTurn)),
      now
    }),
    carriedTransport: previous ? boundedTransport(recentTransport(previous)) : []
  };
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
      timingEligible: timingEligible === true,
      promptChars: finiteCount(promptChars),
      processingNotice: null,
      connectionInterrupted: null
    }
  };
}

/**
 * v1.9.3: record a provider notice seen on the page while this turn waits
 * (ChatGPT's background-processing notice or its connection-lost banner).
 * First and last sighting are kept per turn; the duration is observed page
 * time, not a provider limit.
 */
export function markSessionHealthProviderNotice(value, {
  kind = PROVIDER_NOTICE_KINDS.PROCESSING,
  observedAtMs = Date.now()
} = {}) {
  const state = normalizeSessionHealthState(value);
  const active = state.activeTurn;
  if (!active) return state;
  const key = kind === PROVIDER_NOTICE_KINDS.CONNECTION_INTERRUPTED ? "connectionInterrupted" : "processingNotice";
  const at = finiteMs(observedAtMs);
  if (at == null) return state;
  const prior = active[key];
  return {
    ...state,
    activeTurn: {
      ...active,
      [key]: prior
        ? { firstSeenAtMs: prior.firstSeenAtMs, lastSeenAtMs: Math.max(prior.lastSeenAtMs, at) }
        : { firstSeenAtMs: at, lastSeenAtMs: at }
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
  const firstObserved = first != null;
  if (first == null && completed != null) first = completed;

  const ttfrMs = posted != null && first != null ? Math.max(0, first - posted) : null;
  const completionMs = firstObserved && completed != null ? Math.max(0, completed - first) : null;
  const totalMs = posted != null && completed != null ? Math.max(0, completed - posted) : null;
  const clean = active.timingEligible !== false &&
    state.recoveryChurn === finiteCount(active.recoveryChurnAtPost);

  const sample = {
    turn: finiteCount(active.turn),
    ttfrMs,
    completionMs,
    firstObserved,
    totalMs,
    responseChars: finiteCount(responseChars),
    promptChars: finiteCount(active.promptChars),
    processingNotice: Boolean(active.processingNotice),
    processingNoticeMs: noticeDurationMs(active.processingNotice),
    connectionInterrupted: Boolean(active.connectionInterrupted),
    recoveryChurnAtCompletion: state.recoveryChurn,
    clean
  };

  const samples = boundedSamples([...state.samples, sample]);
  const recent = samples.slice(-SESSION_HEALTH_RECOVERY_CLEAN_WINDOW);
  // A recovery changes the snapshot count; ineligible or transport-tainted
  // completions interrupt the sequence. Legacy samples lack this snapshot
  // and cannot substitute for fresh completion proof.
  const settledRecoveryChurn = recent.length === SESSION_HEALTH_RECOVERY_CLEAN_WINDOW &&
    recent.every((row) => row.clean === true && !row.processingNotice && !row.connectionInterrupted &&
      row.recoveryChurnAtCompletion === state.recoveryChurn)
    ? state.recoveryChurn
    : state.settledRecoveryChurn;

  state = {
    ...state,
    capturedResponseChars: state.capturedResponseChars + finiteCount(responseChars),
    settledRecoveryChurn,
    activeTurn: null,
    samples
  };
  return state;
}

function cleanTtfrSamples(state) {
  return state.samples
    .filter((sample) => sample?.clean === true && Number.isFinite(sample?.ttfrMs))
    .map((sample) => Number(sample.ttfrMs));
}

function measuredCompletion(sample) {
  // A positive legacy duration proves first-response timing existed. Legacy
  // zero is ambiguous; a new zero is valid only with explicit observation.
  return Number.isFinite(sample?.completionMs) &&
    (sample.firstObserved === true || (sample.firstObserved == null && sample.completionMs > 0));
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

  // v1.9.3: completion time relative to this session's own earlier clean
  // turns (contract adaptiveSizingInputs sessionHealth.completionMs).
  const cleanCompletion = state.samples
    .filter((sample) => sample?.clean === true && measuredCompletion(sample))
    .map((sample) => Number(sample.completionMs));
  const latestCompletionMs = latest?.clean === true && measuredCompletion(latest)
    ? Number(latest.completionMs)
    : null;
  const completionBaselineSource = latestCompletionMs != null ? cleanCompletion.slice(0, -1) : [];
  const completionBaselineMs = completionBaselineSource.length >= SESSION_HEALTH_COMPLETION_BASELINE_MIN_SAMPLES
    ? median(completionBaselineSource)
    : null;
  const completionRatio = completionBaselineMs && latestCompletionMs != null
    ? Math.round((latestCompletionMs / completionBaselineMs) * 100) / 100
    : null;
  const transport = recentTransport(state);

  const managedContextChars = state.managedPromptChars + state.capturedResponseChars;
  const recentRecoveryChurn = state.recoveryChurn - state.settledRecoveryChurn;
  const signals = [];
  if (state.promptsPosted >= 20) signals.push("LONG_SESSION");
  if (managedContextChars >= 200_000) signals.push("LARGE_MANAGED_CONTEXT");
  if (ttfrRatio != null && ttfrRatio >= 2.5) signals.push("TTFR_HIGH_RELATIVE");
  else if (ttfrRatio != null && ttfrRatio >= 1.75) signals.push("TTFR_RISING");
  if (recentRecoveryChurn >= 2) signals.push("RECOVERY_CHURN");
  if (completionRatio != null && completionRatio >= 2.5) signals.push("COMPLETION_HIGH_RELATIVE");
  else if (completionRatio != null && completionRatio >= 1.75) signals.push("COMPLETION_RISING");
  if (transport.some((row) => row.processingNotice)) signals.push("PROVIDER_BACKGROUND_PROCESSING");
  if (transport.some((row) => row.connectionInterrupted)) signals.push("TRANSPORT_INTERRUPTED");

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
    completionMs: measuredCompletion(latest) ? Number(latest.completionMs) : null,
    completionBaselineMs,
    completionRatio,
    responseRoundTripMs: Number.isFinite(latest?.totalMs) ? Number(latest.totalMs) : null,
    latencyTrend,
    recoveryChurn: state.recoveryChurn,
    recentRecoveryChurn,
    providerNoticeTurns: transport.filter((row) => row.processingNotice).length,
    interruptedTurns: transport.filter((row) => row.connectionInterrupted).length,
    pressureBand,
    signals
  };
}
