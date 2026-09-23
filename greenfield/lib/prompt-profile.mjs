// v1.7.7 prompt profile: FULL vs COMPACT Greenfield prompts.
//
// The first prompt of every ChatGPT session boundary (mission start/restore,
// session rotation, queue activation, conversation change, new Chrome
// window/tab/process) must carry the complete session-wide contract.
// Follow-up prompts inside the exact same conversation may omit unchanged
// session-wide sections. A FULL prompt is re-sent every
// FULL_PROMPT_REFRESH_INTERVAL prompts (ordinals 1, 11, 21, ...) and whenever
// the EIC requests greenfieldStatusRequest=FULL_NEXT_PROMPT.
//
// v1.7.8: the EIC model context is the ChatGPT conversation (/c/<id>), not the
// browser document. A reload of the same conversation - Greenfield's own
// stale-ladder F5/Ctrl-F5 or a manual F5 - re-renders the same thread and
// therefore does not break COMPACT continuity. Only a conversation change or a
// Greenfield session boundary does.
//
// Every uncertainty resolves to FULL. COMPACT is only an optimization that
// requires positive evidence of conversation continuity.

export const PROMPT_PROFILE_SCHEMA = "eic.greenfield.prompt-profile.v1";
export const PROMPT_PROFILE = Object.freeze({
  FULL: "FULL",
  COMPACT: "COMPACT"
});
export const FULL_PROMPT_REFRESH_INTERVAL = 10;

const COMPACTABLE_MESSAGE_TYPES = new Set(["CONTINUATION", "READ_REQUIRED"]);

/** FNV-1a 32-bit fingerprint; a continuity marker, not a security hash. */
export function missionFingerprint(goal) {
  const value = String(goal ?? "");
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

export function promptSessionKey(process) {
  const ctx = process?.queueContext?.itemId ? process.queueContext : null;
  return [
    String(process?.processId || ""),
    String(process?.runId || ""),
    String(Number(process?.sessionSeq || 1)),
    String(process?.tabId ?? ""),
    String(ctx?.queueId || ""),
    String(ctx?.itemId || ""),
    String(ctx?.savedMissionId || ""),
    missionFingerprint(process?.goal)
  ].join("|");
}

function isFullRefreshOrdinal(ordinal) {
  return (Number(ordinal) - 1) % FULL_PROMPT_REFRESH_INTERVAL === 0;
}

export function nextFullOrdinal(ordinal) {
  const n = Math.max(1, Math.floor(Number(ordinal) || 1));
  return (Math.floor((n - 1) / FULL_PROMPT_REFRESH_INTERVAL) + 1) * FULL_PROMPT_REFRESH_INTERVAL + 1;
}

function record(process, { profile, reason, ordinal, lastFullOrdinal, anchorConversationKey = "" }) {
  return {
    schema: PROMPT_PROFILE_SCHEMA,
    profile,
    reason,
    ordinal,
    lastFullOrdinal,
    nextFullOrdinal: nextFullOrdinal(ordinal),
    refreshInterval: FULL_PROMPT_REFRESH_INTERVAL,
    sessionKey: promptSessionKey(process),
    missionFingerprint: missionFingerprint(process?.goal),
    anchorConversationKey: String(anchorConversationKey || "")
  };
}

/**
 * Decide the profile for the next prompt.
 *
 * previous  - promptProfile record of the prompt whose response was captured
 *             (process.lastPrompt.promptProfile);
 * observed  - { responseConversationKey }: the conversation in which that
 *             prompt's causally paired response was captured. The response is
 *             paired to the exact user turn Greenfield posted, so this is also
 *             the conversation that received the prompt.
 */
export function selectPromptProfile({
  process,
  messageType = "CONTINUATION",
  previous = null,
  observed = {},
  forceFull = false,
  forceReason = ""
} = {}) {
  const full = (reason, ordinal) => record(process, {
    profile: PROMPT_PROFILE.FULL,
    reason,
    ordinal,
    lastFullOrdinal: ordinal
  });

  if (!COMPACTABLE_MESSAGE_TYPES.has(String(messageType || ""))) {
    return full(`MESSAGE_TYPE_${String(messageType || "UNKNOWN")}`, 1);
  }
  const prior = previous && typeof previous === "object" && previous.schema === PROMPT_PROFILE_SCHEMA
    ? previous
    : null;
  if (!prior) return full("NO_PRIOR_PROFILE", 1);
  if (prior.sessionKey !== promptSessionKey(process)) return full("SESSION_BOUNDARY", 1);

  const conversation = String(observed?.responseConversationKey || "");
  // A FULL prompt's conversation becomes known only once its response is
  // captured (a new chat gets its /c/<id> on first post); a COMPACT prompt
  // must stay on the conversation it inherited.
  const anchorConversationKey = prior.profile === PROMPT_PROFILE.FULL
    ? conversation
    : String(prior.anchorConversationKey || "");
  if (!conversation || !anchorConversationKey) {
    return full("SESSION_IDENTITY_UNPROVEN", 1);
  }
  if (anchorConversationKey !== conversation) {
    return full("CONVERSATION_CHANGED", 1);
  }

  const ordinal = Math.max(1, Math.floor(Number(prior.ordinal) || 0)) + 1;
  if (forceFull) return full(String(forceReason || "FORCED_FULL"), ordinal);
  if (isFullRefreshOrdinal(ordinal)) return full("PERIODIC_FULL_REFRESH", ordinal);
  return record(process, {
    profile: PROMPT_PROFILE.COMPACT,
    reason: "SAME_CONVERSATION_FOLLOW_UP",
    ordinal,
    lastFullOrdinal: Math.max(1, Math.floor(Number(prior.lastFullOrdinal) || 1)),
    anchorConversationKey
  });
}

/**
 * Dispatch-time guard: a COMPACT prompt may only be posted into the exact
 * conversation it was composed for. A reload of that conversation keeps it
 * valid; navigation to another or a new chat requires the FULL fallback.
 */
export function compactPromptStillValid(profile, { conversationKey = "" } = {}) {
  if (!profile || profile.profile !== PROMPT_PROFILE.COMPACT) return true;
  return Boolean(
    profile.anchorConversationKey &&
    String(conversationKey || "") === profile.anchorConversationKey
  );
}

/** The FULL record used when a COMPACT prompt is upgraded before dispatch. */
export function upgradedFullProfile(profile, reason = "CONVERSATION_CHANGED_BEFORE_DISPATCH") {
  return {
    ...(profile || {}),
    schema: PROMPT_PROFILE_SCHEMA,
    profile: PROMPT_PROFILE.FULL,
    reason,
    ordinal: 1,
    lastFullOrdinal: 1,
    nextFullOrdinal: nextFullOrdinal(1),
    anchorConversationKey: ""
  };
}
