import "./safety-policy.js";

export const { reasoningLabels, normalizeReasoningLevel, matchesReasoningLevel } = globalThis.GreenfieldSafetyPolicy;

// An old authorization may never authorize a newly edited queue slot.
export function reasoningAuthorizationMatches(proof, admission) {
  try {
    return normalizeReasoningLevel(proof?.reasoningLevel) === normalizeReasoningLevel(admission?.reasoningLevel);
  } catch { return false; }
}
