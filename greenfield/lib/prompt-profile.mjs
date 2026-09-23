// v1.7.7 prompt profile: FULL vs COMPACT Greenfield prompts.
//
// The first prompt of every ChatGPT session boundary (mission start/restore,
// session rotation, queue activation, page reload, conversation change, new
// Chrome window/tab/process) must carry the complete session-wide contract.
// Follow-up prompts inside the exact same conversation may omit unchanged
// session-wide sections. A FULL prompt is re-sent every
// FULL_PROMPT_REFRESH_INTERVAL prompts (ordinals 1, 11, 21, ...) and whenever
// the EIC requests greenfieldStatusRequest=FULL_NEXT_PROMPT.
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

function record(process, { profile, reason, ordinal, lastFullOrdinal, anchorDocumentId = "", anchorConversationKey = "" }) {
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
    anchorDocumentId: String(anchorDocumentId || ""),
    anchorConversationKey: String(anchorConversationKey || "")
  };
}

/**
 * Decide the profile for the next prompt.
 *
 * previous  - promptProfile record of the prompt whose response was captured
 *             (process.lastPrompt.promptProfile);
 * observed  - { promptDocumentId, responseDocumentId, conversationKey }:
 *             the document that received that prompt, the document where its
 *             response was captured and the current managed conversation.
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

  const promptDocumentId = String(observed?.promptDocumentId || "");
  const responseDocumentId = String(observed?.responseDocumentId || "");
  const conversation = String(observed?.conversationKey || "");
  // A FULL prompt's anchor becomes known only after it was dispatched and its
  // response captured; a COMPACT prompt must stay on its inherited anchor.
  const anchorDocumentId = prior.profile === PROMPT_PROFILE.FULL ? promptDocumentId : String(prior.anchorDocumentId || "");
  const anchorConversationKey = prior.profile === PROMPT_PROFILE.FULL ? conversation : String(prior.anchorConversationKey || "");
  if (!promptDocumentId || !responseDocumentId || !conversation ||
      !anchorDocumentId || !anchorConversationKey) {
    return full("SESSION_IDENTITY_UNPROVEN", 1);
  }
  if (promptDocumentId !== responseDocumentId ||
      anchorDocumentId !== responseDocumentId ||
      anchorConversationKey !== conversation) {
    return full("DOCUMENT_OR_CONVERSATION_CHANGED", 1);
  }

  const ordinal = Math.max(1, Math.floor(Number(prior.ordinal) || 0)) + 1;
  if (forceFull) return full(String(forceReason || "FORCED_FULL"), ordinal);
  if (isFullRefreshOrdinal(ordinal)) return full("PERIODIC_FULL_REFRESH", ordinal);
  return record(process, {
    profile: PROMPT_PROFILE.COMPACT,
    reason: "SAME_CONVERSATION_FOLLOW_UP",
    ordinal,
    lastFullOrdinal: Math.max(1, Math.floor(Number(prior.lastFullOrdinal) || 1)),
    anchorDocumentId,
    anchorConversationKey
  });
}

/**
 * Dispatch-time guard: a COMPACT prompt may only be posted into the exact
 * document and conversation it was composed for. Anything else (F5/Ctrl-F5,
 * navigation to another chat) requires the FULL fallback.
 */
export function compactPromptStillValid(profile, { documentId = "", conversationKey = "" } = {}) {
  if (!profile || profile.profile !== PROMPT_PROFILE.COMPACT) return true;
  return Boolean(
    profile.anchorDocumentId &&
    profile.anchorConversationKey &&
    String(documentId || "") === profile.anchorDocumentId &&
    String(conversationKey || "") === profile.anchorConversationKey
  );
}

/** The FULL record used when a COMPACT prompt is upgraded before dispatch. */
export function upgradedFullProfile(profile, reason = "COMPACT_ANCHOR_LOST_BEFORE_DISPATCH") {
  return {
    ...(profile || {}),
    schema: PROMPT_PROFILE_SCHEMA,
    profile: PROMPT_PROFILE.FULL,
    reason,
    ordinal: 1,
    lastFullOrdinal: 1,
    nextFullOrdinal: nextFullOrdinal(1),
    anchorDocumentId: "",
    anchorConversationKey: ""
  };
}
