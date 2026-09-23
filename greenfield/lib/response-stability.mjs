import {
  A2A_RESPONSE_SCHEMA,
  RESPONSE_STABLE_MIN_MS,
  RESPONSE_STABLE_READS,
  RESPONSE_CAUSAL_FALLBACK_MIN_MS,
  RESPONSE_CAUSAL_FALLBACK_READS
} from "./contracts.mjs";
import { nowIso } from "./common.mjs";

function observationIdentity(observation) {
  const documentId = String(observation?.documentId || "");
  const messageId = String(observation?.lastAssistantId || "");
  const hash = String(observation?.assistantHash || "");
  const assistantCount = Number(observation?.assistantCount);
  const ownerKind = String(observation?.lastAssistantOwnerKind || "UNKNOWN");
  const expectedUserTurnId = String(observation?.expectedUserTurnId || "");
  const pairedUserTurnId = String(observation?.pairedUserTurnId || "");
  const pairedUserResolvedBy = String(observation?.pairedUserResolvedBy || "NONE");
  const replicaCount = Number(observation?.lastAssistantReplicaCount || 0);
  return {
    documentId,
    messageId,
    ownerKind,
    hash,
    assistantCount: Number.isFinite(assistantCount) ? assistantCount : null,
    expectedUserTurnId,
    pairedUserTurnId,
    pairedUserResolvedBy,
    replicaCount: Number.isFinite(replicaCount) ? replicaCount : 0,
    key: `${documentId}|${messageId}|${ownerKind}|${hash}|${pairedUserTurnId}|${Number.isFinite(assistantCount) ? assistantCount : "?"}`
  };
}

export function assistantLifecycleStatusText(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (/^(?:Tänker|Thinking|Arbetar|Working|Resonerar|Reasoning|Analyserar|Analyzing)(?:\.{0,3}|…)?$/iu.test(text)) {
    return true;
  }
  return /^(?:Arbetade|Worked|Tänkte|Thought|Resonerade|Reasoned|Analyserade|Analyzed)\s+(?:i|for)\s+(?:(?:\d+(?:[.,]\d+)?\s*(?:h|tim(?:me|mar)?|hours?|m|min(?:ut|uter)?|minutes?|s|sek(?:und|under)?|seconds?)\s*){1,3})\s*(?:[>›»⌄▼]|$)$/iu.test(text);
}

function causalVisibleFallbackEligible(observation, identity) {
  return Boolean(
    observation?.lastAssistantOwnerTrusted !== true &&
    identity.ownerKind === "ROLE_NODE_FALLBACK" &&
    identity.pairedUserResolvedBy === "USER_TURN_ID" &&
    identity.expectedUserTurnId &&
    identity.pairedUserTurnId === identity.expectedUserTurnId &&
    String(observation?.signals?.visibilityState || "unknown") === "visible" &&
    observation?.generating !== true &&
    observation?.responseSlotClosed !== true
  );
}

function canonicalA2AObjectStartIndexes(source) {
  const s = String(source || "");
  const schemaLiteral = `"${A2A_RESPONSE_SCHEMA}"`;
  const starts = [];
  let markerIndex = s.indexOf(schemaLiteral);
  while (markerIndex >= 0) {
    const start = s.lastIndexOf("{", markerIndex);
    if (start >= 0) {
      const prefix = s.slice(start, markerIndex + schemaLiteral.length);
      if (/\{\s*"schema"\s*:\s*$/.test(prefix.slice(0, prefix.length - schemaLiteral.length))) {
        starts.push(start);
      }
    }
    markerIndex = s.indexOf(schemaLiteral, markerIndex + schemaLiteral.length);
  }
  return [...new Set(starts)];
}

function objectClosesFrom(source, start) {
  const s = String(source || "");
  let depth = 0;
  let inString = false;
  let escaped = false;
  let started = false;

  for (let i = Math.max(0, Number(start || 0)); i < s.length; i += 1) {
    const ch = s[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      started = true;
      continue;
    }
    if (ch === "}" && started) {
      depth -= 1;
      if (depth === 0) return true;
      if (depth < 0) return false;
    }
  }
  return false;
}

function canonicalA2AResponseStructurallyIncomplete(source) {
  const starts = canonicalA2AObjectStartIndexes(source);
  if (!starts.length) return false;
  return !starts.some((start) => objectClosesFrom(source, start));
}

export function classifyResponseObservation(observation) {
  const text = String(observation?.assistantText || "");
  const reportedTextLength = Number(observation?.assistantTextLength);
  const identity = observationIdentity(observation);
  if (observation?.generating === true) {
    return { admissible: false, reason: "OBSERVATION_GENERATING", identity, textLength: text.length };
  }
  if (!identity.documentId) {
    return { admissible: false, reason: "OBSERVATION_DOCUMENT_ID_MISSING", identity, textLength: text.length };
  }
  if (!identity.messageId) {
    return { admissible: false, reason: "OBSERVATION_MESSAGE_ID_MISSING", identity, textLength: text.length };
  }
  if (!identity.expectedUserTurnId) {
    return { admissible: false, reason: "OBSERVATION_EXPECTED_USER_TURN_MISSING", identity, textLength: text.length };
  }
  if (!identity.pairedUserTurnId) {
    return { admissible: false, reason: "OBSERVATION_PAIRED_USER_TURN_MISSING", identity, textLength: text.length };
  }
  if (identity.pairedUserTurnId !== identity.expectedUserTurnId) {
    return { admissible: false, reason: "OBSERVATION_CAUSAL_PAIR_MISMATCH", identity, textLength: text.length };
  }
  const structuralOwnerTrusted = observation?.lastAssistantOwnerTrusted === true;
  const causalFallback = causalVisibleFallbackEligible(observation, identity);
  if (!structuralOwnerTrusted && !causalFallback) {
    return { admissible: false, reason: "OBSERVATION_OWNER_UNTRUSTED", identity, textLength: text.length };
  }
  // A trusted conversation-turn owner proves causal ownership, not semantic completion.
  // ChatGPT may expose a short "Working..."/"Arbetade i 51 sekunder >" lifecycle
  // fragment inside that same owner before the final answer is rendered. Never let
  // such page chrome become a terminal assistant response.
  if (assistantLifecycleStatusText(text)) {
    return { admissible: false, reason: "OBSERVATION_ASSISTANT_LIFECYCLE_ONLY", identity, textLength: text.length };
  }
  if (!identity.hash || !text) {
    return { admissible: false, reason: "OBSERVATION_TEXT_MISSING", identity, textLength: text.length };
  }
  if (Number.isFinite(reportedTextLength) && reportedTextLength !== text.length) {
    return {
      admissible: false,
      reason: "OBSERVATION_TEXT_LENGTH_MISMATCH",
      identity,
      textLength: text.length,
      reportedTextLength
    };
  }
  if (!Number.isFinite(identity.assistantCount) || identity.assistantCount < 1) {
    return { admissible: false, reason: "OBSERVATION_COUNT_INVALID", identity, textLength: text.length };
  }
  const ownerAdmissionMode = structuralOwnerTrusted
    ? "STRUCTURAL_OWNER"
    : "CAUSAL_VISIBLE_FALLBACK";
  return {
    admissible: true,
    reason: structuralOwnerTrusted
      ? "OBSERVATION_TRUSTED"
      : "OBSERVATION_CAUSAL_VISIBLE_FALLBACK",
    identity,
    textLength: text.length,
    visibilityState: String(observation?.signals?.visibilityState || "unknown"),
    ownerKind: String(observation?.lastAssistantOwnerKind || "UNKNOWN"),
    ownerAdmissionMode,
    structuralOwnerTrusted,
    causalFallback
  };
}

export function advanceResponseCandidate(candidateValue, observation, {
  now = Date.now(),
  minStableMs = RESPONSE_STABLE_MIN_MS,
  minStableReads = RESPONSE_STABLE_READS
} = {}) {
  const quality = classifyResponseObservation(observation);
  if (!quality.admissible) {
    return {
      candidate: null,
      complete: false,
      reason: quality.reason,
      observationQuality: quality
    };
  }

  const identity = quality.identity;
  if (canonicalA2AResponseStructurallyIncomplete(observation?.assistantText)) {
    return {
      candidate: null,
      complete: false,
      reason: "OBSERVATION_CANONICAL_A2A_RESPONSE_INCOMPLETE",
      ageMs: 0,
      reads: 0,
      requiredStableMs: 0,
      requiredStableReads: 0,
      observationQuality: quality
    };
  }

  const fallbackAdmission = quality.ownerAdmissionMode === "CAUSAL_VISIBLE_FALLBACK";
  const requiredStableMs = fallbackAdmission
    ? Math.max(Number(minStableMs || 0), RESPONSE_CAUSAL_FALLBACK_MIN_MS)
    : Number(minStableMs || 0);
  const requiredStableReads = fallbackAdmission
    ? Math.max(Number(minStableReads || 0), RESPONSE_CAUSAL_FALLBACK_READS)
    : Number(minStableReads || 0);
  const prior = candidateValue &&
      candidateValue.identityKey === identity.key &&
      candidateValue.ownerAdmissionMode === quality.ownerAdmissionMode
    ? candidateValue
    : null;
  const candidate = prior
    ? {
        ...prior,
        reads: Number(prior.reads || 0) + 1,
        lastSeenAt: nowIso(now),
        visibilityState: quality.visibilityState,
        ownerKind: quality.ownerKind,
        ownerAdmissionMode: quality.ownerAdmissionMode
      }
    : {
        identityKey: identity.key,
        documentId: identity.documentId,
        messageId: identity.messageId,
        hash: identity.hash,
        assistantCount: identity.assistantCount,
        expectedUserTurnId: identity.expectedUserTurnId,
        pairedUserTurnId: identity.pairedUserTurnId,
        textLength: quality.textLength,
        ownerKind: quality.ownerKind,
        ownerAdmissionMode: quality.ownerAdmissionMode,
        visibilityState: quality.visibilityState,
        firstSeenAt: nowIso(now),
        lastSeenAt: nowIso(now),
        reads: 1
      };

  const ageMs = Math.max(0, now - Date.parse(candidate.firstSeenAt));
  const complete = candidate.reads >= requiredStableReads && ageMs >= requiredStableMs;
  return {
    candidate,
    complete,
    reason: complete
      ? (fallbackAdmission
          ? "STABLE_TERMINAL_RESPONSE_CAUSAL_FALLBACK"
          : "STABLE_TERMINAL_RESPONSE")
      : (fallbackAdmission ? "STABILIZING_CAUSAL_FALLBACK" : "STABILIZING"),
    ageMs,
    reads: candidate.reads,
    requiredStableMs,
    requiredStableReads,
    observationQuality: quality
  };
}
