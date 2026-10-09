// v1.8.3 ChatGPT provider content block ("This content can't be shown" /
// "Det här innehållet kan inte visas" … "Daybreak").
//
// ChatGPT renders the notice inline, between the thread and the composer,
// outside every message turn (operator screenshots 2026-09-25, sv and en). The
// blocked turn may already have run tools ("Ran commands"), and the operator
// observed that the conversation does not work normally afterwards; what helps
// is rotating the same GFW into a fresh chat. A reload shows the same notice.
//
// Operator decisions: first block -> rotate the same GFW; a repeat within 24 h
// pauses the GFW 2 h, then 6 h, then 24 h per repeat; the counter resets after
// 24 h without a block; the slot is never BLOCKED. Pure module.

export const PROVIDER_BLOCK = Object.freeze({
  DISPOSITION: "PROVIDER_CONTENT_BLOCKED",
  SOURCE_STATE: "PROMPT_BLOCKED_BY_PROVIDER",
  CHAIN_WINDOW_MS: 24 * 60 * 60 * 1000,
  PAUSE_STEPS_MS: Object.freeze([2, 6, 24].map((hours) => hours * 60 * 60 * 1000)),
  MAX_EVENTS: 12
});

/** A notice the content script reported that blocks the current turn. */
export function providerNoticeBlocks(notice) {
  return Boolean(
    notice &&
    notice.kind === "CONTENT_BLOCKED_DAYBREAK" &&
    notice.outsideMessageTurns === true &&
    (notice.headlineMatched === true || notice.cyberWordMatched === true) &&
    notice.afterExpectedUserTurn !== false
  );
}

/**
 * Record one block event and decide the action.
 *   history: { events: [{atMs, noticeKey}], lastNoticeKey }
 * The chain counts consecutive blocks each within CHAIN_WINDOW_MS of the one
 * before; the same noticeKey is never counted twice.
 * Returns { history, counted, chainLength, action: "ROTATE" | "PAUSE", pauseMs }.
 */
export function recordProviderBlock(history, { noticeKey = "", now = Date.now() } = {}) {
  const prior = history && typeof history === "object" ? history : {};
  const events = (Array.isArray(prior.events) ? prior.events : [])
    .filter((row) => Number.isFinite(Number(row?.atMs)));
  const duplicate = Boolean(noticeKey && prior.lastNoticeKey === noticeKey);
  const nextEvents = duplicate
    ? events
    : [...events, { atMs: Number(now), noticeKey: String(noticeKey || "").slice(0, 80) }].slice(-PROVIDER_BLOCK.MAX_EVENTS);
  let chainLength = 0;
  for (let i = nextEvents.length - 1; i >= 0; i -= 1) {
    const newer = i === nextEvents.length - 1 ? Number(now) : Number(nextEvents[i + 1].atMs);
    if (newer - Number(nextEvents[i].atMs) > PROVIDER_BLOCK.CHAIN_WINDOW_MS) break;
    chainLength += 1;
  }
  const repeat = chainLength - 1;
  const pauseMs = repeat <= 0
    ? 0
    : PROVIDER_BLOCK.PAUSE_STEPS_MS[Math.min(repeat, PROVIDER_BLOCK.PAUSE_STEPS_MS.length) - 1];
  return {
    history: { events: nextEvents, lastNoticeKey: duplicate ? prior.lastNoticeKey : String(noticeKey || "").slice(0, 80) },
    counted: !duplicate,
    chainLength,
    action: pauseMs > 0 ? "PAUSE" : "ROTATE",
    pauseMs
  };
}

/** Recent chain length for the learning context (0 when none within 24 h). */
export function providerBlockChainLength(history, now = Date.now()) {
  const events = Array.isArray(history?.events) ? history.events : [];
  let chain = 0;
  let newer = Number(now);
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (newer - Number(events[i].atMs) > PROVIDER_BLOCK.CHAIN_WINDOW_MS) break;
    chain += 1;
    newer = Number(events[i].atMs);
  }
  return chain;
}

/** English machine objective for the fresh session (sent as a FULL prompt). */
export function providerBlockObjective(objective, notice, { chainLength = 1 } = {}) {
  const excerpt = String(notice?.sample || "").replace(/\s+/g, " ").trim().slice(0, 240);
  return [
    "[Provider content block recovery]",
    `ChatGPT withheld the response to the previous Greenfield prompt in the earlier conversation and showed the notice: "${excerpt}".`,
    chainLength > 1 ? `This is block ${chainLength} for this GFW within 24 hours.` : "",
    "The blocked turn may already have executed tools before the notice, so its effects are unknown: re-read the factual owner state before any effect and never assume that work completed or failed.",
    "Do not resend the same request verbatim. Continue the same mission with one bounded next step that does not depend on the withheld content.",
    "If the objective inherently requires the withheld content, return status=BLOCKED with the notice as evidence, or choose another open work package.",
    `Mission objective to continue: ${String(objective || "").trim()}`
  ].filter(Boolean).join(" ");
}
