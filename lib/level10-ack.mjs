import { deepClone, nowIso, randomId, sanitizeText, stableStringify } from "./common.mjs";

export const OPERATOR_DECISION_SCHEMA = "eic.autonom.operator-decision.v1";
export const OPERATOR_DECISION_RECEIPT_SCHEMA = "eic.autonom.operator-decision-receipt.v1";
export const MIN_ACKNOWLEDGEMENT_CHARACTERS = 12;

function graphemes(value) {
  const text = String(value ?? "").normalize("NFKC");
  if (globalThis.Intl?.Segmenter) {
    return [...new Intl.Segmenter("und", { granularity: "grapheme" }).segment(text)]
      .map((entry) => entry.segment);
  }
  return Array.from(text);
}

export function normalizeAcknowledgement(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function acknowledgementMetrics(value) {
  const normalized = normalizeAcknowledgement(value);
  const clusters = graphemes(normalized).filter((item) => !/^\s+$/u.test(item));
  const semantic = clusters.filter((item) => /[\p{L}\p{N}]/u.test(item));
  return {
    normalized,
    characterCount: clusters.length,
    semanticCharacterCount: semantic.length,
    valid: clusters.length >= MIN_ACKNOWLEDGEMENT_CHARACTERS &&
      semantic.length >= Math.min(6, MIN_ACKNOWLEDGEMENT_CHARACTERS)
  };
}

export function createOperatorDecision(input = {}, { now = Date.now(), decisionId = randomId("operator-decision") } = {}) {
  const missionId = sanitizeText(input.missionId, 240);
  const runId = sanitizeText(input.runId, 240);
  const instruction = sanitizeText(input.instruction, 2400);
  const boundaryKey = sanitizeText(input.boundaryKey, 1200);
  if (!missionId || !runId || !instruction || !boundaryKey) throw new Error("OPERATOR_DECISION_FIELDS_MISSING");
  return {
    schema: OPERATOR_DECISION_SCHEMA,
    version: 1,
    decisionId: sanitizeText(decisionId, 240),
    missionId,
    runId,
    boundaryKey,
    instruction,
    riskLevel: sanitizeText(input.riskLevel || "LEVEL_10", 120),
    status: "PENDING",
    createdAt: nowIso(now),
    receipt: null,
    updatedAt: nowIso(now)
  };
}

export function acceptOperatorDecisionReceipt(decisionInput, input = {}, { now = Date.now() } = {}) {
  const decision = deepClone(decisionInput);
  if (!decision || decision.schema !== OPERATOR_DECISION_SCHEMA) throw new Error("OPERATOR_DECISION_NOT_CURRENT");
  const decisionId = sanitizeText(input.decisionId, 240);
  const missionId = sanitizeText(input.missionId, 240);
  const runId = sanitizeText(input.runId, 240);
  const boundaryKey = sanitizeText(input.boundaryKey, 1200);
  if (decisionId !== decision.decisionId) throw new Error("OPERATOR_DECISION_ID_STALE_OR_WRONG");
  if (missionId !== decision.missionId) throw new Error("OPERATOR_DECISION_MISSION_MISMATCH");
  if (runId !== decision.runId) throw new Error("OPERATOR_DECISION_RUN_MISMATCH");
  if (boundaryKey !== decision.boundaryKey) throw new Error("OPERATOR_DECISION_BOUNDARY_MISMATCH");
  const metrics = acknowledgementMetrics(input.acknowledgement ?? input.justification);
  if (!metrics.valid) throw new Error("OPERATOR_DECISION_ACKNOWLEDGEMENT_TOO_SHORT");
  const candidateReceipt = {
    schema: OPERATOR_DECISION_RECEIPT_SCHEMA,
    version: 1,
    receiptId: sanitizeText(input.receiptId || randomId("operator-decision-receipt"), 240),
    decisionId,
    missionId,
    runId,
    boundaryKey,
    acknowledgement: metrics.normalized,
    acceptedAt: nowIso(now)
  };
  if (decision.receipt) {
    const same = decision.receipt.decisionId === candidateReceipt.decisionId &&
      decision.receipt.missionId === candidateReceipt.missionId &&
      decision.receipt.runId === candidateReceipt.runId &&
      decision.receipt.boundaryKey === candidateReceipt.boundaryKey &&
      decision.receipt.acknowledgement === candidateReceipt.acknowledgement;
    if (!same) throw new Error("OPERATOR_DECISION_DUPLICATE_CONFLICT");
    return { decision, idempotent: true, accepted: true };
  }
  if (decision.status !== "PENDING") throw new Error("OPERATOR_DECISION_NOT_PENDING");
  decision.receipt = candidateReceipt;
  decision.status = "ACCEPTED";
  decision.updatedAt = nowIso(now);
  return { decision, idempotent: false, accepted: true };
}
