import { nowIso, sanitizeText } from "./common.mjs";

export const SESSION_BASELINE_CORRECTION_FENCE_SCHEMA =
  "eic.autonom.session-baseline-correction-fence.v1";

export const SESSION_BASELINE_MAX_CHAT_CORRECTIONS = 1;

function boundedViolations(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((value) => sanitizeText(value, 320))
    .filter(Boolean)
    .slice(0, 4);
}

export function sessionBaselineCorrectionEpisodeKey(init = {}) {
  const needKey = sanitizeText(init?.needKey, 240) || "SESSION_INIT";
  const catchIdentity = sanitizeText(init?.catchResponseIdentity, 512) || "NO_CATCH_IDENTITY";
  return `${needKey}|${catchIdentity}`;
}

export function evaluateSessionBaselineCorrectionFence(init = {}, {
  requestId = "",
  responseIdentity = "",
  verdict = "",
  reason = "",
  violations = [],
  now = Date.now()
} = {}) {
  const episodeKey = sessionBaselineCorrectionEpisodeKey(init);
  const previous = init?.baselineCorrectionFence?.schema ===
      SESSION_BASELINE_CORRECTION_FENCE_SCHEMA &&
      sanitizeText(init.baselineCorrectionFence.episodeKey, 900) === episodeKey
    ? init.baselineCorrectionFence
    : null;
  const priorGeneration = previous
    ? Math.max(0, Number(previous.generation || 0))
    : 0;
  const allowCorrection = priorGeneration < SESSION_BASELINE_MAX_CHAT_CORRECTIONS;
  const generation = allowCorrection
    ? priorGeneration + 1
    : priorGeneration;
  const at = nowIso(now);
  const fence = {
    schema: SESSION_BASELINE_CORRECTION_FENCE_SCHEMA,
    episodeKey,
    generation,
    maxChatCorrections: SESSION_BASELINE_MAX_CHAT_CORRECTIONS,
    status: allowCorrection ? "CORRECTION_ALLOWED" : "EXHAUSTED",
    requestId: sanitizeText(requestId, 180),
    responseIdentity: sanitizeText(responseIdentity, 512),
    verdict: sanitizeText(verdict, 80),
    reason: sanitizeText(reason, 800),
    violations: boundedViolations(violations),
    updatedAt: at,
    exhaustedAt: allowCorrection ? null : at
  };
  return {
    allowCorrection,
    exhausted: !allowCorrection,
    priorGeneration,
    generation,
    episodeKey,
    fence
  };
}

export function applySessionBaselineCorrectionFence(init = {}, verdict = {}) {
  const fence = verdict?.fence && typeof verdict.fence === "object"
    ? verdict.fence
    : null;
  if (!fence) return init;
  return {
    ...init,
    baselineCorrectionGeneration: Math.max(0, Number(verdict.generation || fence.generation || 0)),
    baselineCorrectionFence: fence
  };
}
