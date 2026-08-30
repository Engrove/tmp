import { sanitizeText } from "./common.mjs";

/**
 * v0.12.13 bounded liveness for stranded response ownership.
 *
 * v0.12.12's only response-liveness bound lived on `run.responseCandidate`
 * (RESPONSE_SETTLE_MAX_AGE_MS). When the admission gates disagreed, no
 * candidate was ever established, so the 60 s bound had nothing to attach to
 * and `clearResponseStabilityProbe()` additionally cancelled the Chrome alarm
 * that would have woken the controller. The run sat in WAITING_FOR_RESPONSE
 * with a complete, stable assistant response on screen and no subsystem that
 * owned getting it through.
 *
 * Liveness therefore has to be owned by the turn, not by a candidate that may
 * never exist. A stranded causal owner is opened here on first sight and must
 * resolve within the bound or become an explicit typed failure.
 */
export const CAUSAL_OWNERSHIP_STRAND_SCHEMA = "eic.autonom.causal-ownership-strand.v1";
export const CAUSAL_OWNERSHIP_STRAND_CODE = "CAUSAL_OWNER_STRANDED_NO_PRODUCER";
export const CAUSAL_OWNERSHIP_STRAND_MAX_AGE_MS = 45_000;

function iso(value) {
  return new Date(value).toISOString();
}

function parsedAt(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function openCausalOwnershipStrand(existing, ownership = {}, {
  now = Date.now(),
  maxAgeMs = CAUSAL_OWNERSHIP_STRAND_MAX_AGE_MS,
  turnId = "",
  responseHash = ""
} = {}) {
  const effectId = sanitizeText(ownership?.effectId, 180);
  if (!effectId) return null;
  const previous = existing && typeof existing === "object" ? existing : null;
  // The same strand keeps its original deadline; a different effect restarts it.
  const continues = previous && previous.effectId === effectId;
  const firstSeen = continues ? parsedAt(previous.firstSeenAt) : NaN;
  const base = Number.isFinite(firstSeen) ? firstSeen : Number(now);
  const bound = Math.max(5_000, Number(maxAgeMs) || CAUSAL_OWNERSHIP_STRAND_MAX_AGE_MS);
  return {
    schema: CAUSAL_OWNERSHIP_STRAND_SCHEMA,
    code: CAUSAL_OWNERSHIP_STRAND_CODE,
    verdict: sanitizeText(ownership?.verdict, 80),
    effectId,
    turnId: sanitizeText(turnId || previous?.turnId, 180),
    legacyStatus: sanitizeText(ownership?.legacyStatus, 80),
    causalStatus: sanitizeText(ownership?.causalStatus, 80),
    closeReason: sanitizeText(ownership?.closeReason, 240),
    responseHash: sanitizeText(responseHash || previous?.responseHash, 128),
    observations: Math.max(0, Number(continues ? previous.observations : 0)) + 1,
    firstSeenAt: iso(base),
    lastSeenAt: iso(now),
    deadlineAt: iso(base + bound)
  };
}

export function clearCausalOwnershipStrand() {
  return null;
}

export function evaluateCausalOwnershipStrand(strand, { now = Date.now() } = {}) {
  if (!strand || typeof strand !== "object") {
    return { open: false, overdue: false, ageMs: 0, deadlineAt: "", code: "" };
  }
  const first = parsedAt(strand.firstSeenAt);
  const deadline = parsedAt(strand.deadlineAt);
  const ageMs = Number.isFinite(first) ? Math.max(0, Number(now) - first) : 0;
  const overdue = Number.isFinite(deadline) && Number(now) >= deadline;
  return {
    open: true,
    overdue,
    ageMs,
    deadlineAt: strand.deadlineAt || "",
    code: overdue ? CAUSAL_OWNERSHIP_STRAND_CODE : ""
  };
}

export function causalOwnershipStrandFailure(strand, page = {}, { now = Date.now() } = {}) {
  const evaluation = evaluateCausalOwnershipStrand(strand, { now });
  if (!evaluation.overdue) return null;
  return {
    schema: "eic.autonom.causal-ownership-failure.v1",
    code: CAUSAL_OWNERSHIP_STRAND_CODE,
    verdict: sanitizeText(strand?.verdict, 80),
    effectId: sanitizeText(strand?.effectId, 180),
    turnId: sanitizeText(strand?.turnId, 180),
    legacyStatus: sanitizeText(strand?.legacyStatus, 80),
    causalStatus: sanitizeText(strand?.causalStatus, 80),
    closeReason: sanitizeText(strand?.closeReason, 240),
    responseHash: sanitizeText(page?.latestAssistantHash || strand?.responseHash, 128),
    documentEpoch: sanitizeText(page?.documentEpoch, 240),
    observations: Math.max(0, Number(strand?.observations || 0)),
    ageMs: evaluation.ageMs,
    deadlineAt: evaluation.deadlineAt,
    detectedAt: iso(now)
  };
}
