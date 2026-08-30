import {
  clampInteger,
  normalizeWhitespace,
  sanitizeText
} from "./common.mjs";
import { STATES } from "./state-machine.mjs";
import { parseTargetResult } from "./prompt-contract.mjs";

export { clampInteger, sanitizeText };

export const DEFAULT_RESPONSE_TIMEOUT_MS = 7_200_000;

/**
 * Compatibility helper for the Chrome Prompt API's historical availability
 * spellings. It carries no run-state authority.
 */
export function normalizeAvailability(value) {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (["available", "readily", "yes"].includes(normalized)) return "available";
  if (["downloadable", "after-download", "after_download"].includes(normalized)) return "downloadable";
  if (["downloading", "in-progress", "in_progress"].includes(normalized)) return "downloading";
  if (["unavailable", "no", "unsupported"].includes(normalized)) return "unavailable";
  return normalized || "unknown";
}

/**
 * Read-only migration parser for legacy NANO_START/1 payloads. The returned
 * state field is unverified and must never be promoted to verified facts.
 */
export function parseNanoStartContext(text) {
  const source = String(text ?? "");
  const find = (labels) => {
    for (const label of labels) {
      const match = source.match(new RegExp(`(?:^|\\n)${label}\\s*[:=]\\s*([^\\n]+)`, "i"));
      if (match) return match[1].trim();
    }
    return "";
  };
  return {
    stableGoal: find(["STABLE_GOAL", "GOAL"]),
    activeUnit: find(["ACTIVE_UNIT", "WORK_UNIT"]),
    legacyClaimedState: find(["VERIFIED_STATE", "OWNER_STATE", "KNOWN_STATE"]),
    source
  };
}

/**
 * Hardened protocol compatibility wrapper. Unlike v0.4.1 it is turn-bound,
 * fence-excluding and unique; it never scans for a last-wins marker.
 */
export function evaluateProtocolCompliance(text, expectedTurnId) {
  const result = parseTargetResult(text, expectedTurnId);
  return {
    compliant: result.valid,
    action: result.valid
      ? result.status === "PAUSE" ? "PAUSE" : result.status
      : "PAUSE",
    reason: result.reason,
    next: result.next || "",
    turnId: result.turnId || ""
  };
}

export function deriveControlState(run) {
  const state = run?.state || STATES.IDLE;
  const active = ![STATES.IDLE, STATES.PROGRAM_DONE, STATES.STOPPED, STATES.ERROR_TERMINAL].includes(state);
  return {
    active,
    paused: state === STATES.SOFT_PAUSED,
    blocked: state === STATES.PROGRAM_BLOCKED,
    canPause: active && ![STATES.SOFT_PAUSED, STATES.PROGRAM_BLOCKED].includes(state),
    canResume: state === STATES.SOFT_PAUSED,
    canStop: active
  };
}

export function evaluateTabRefreshRequirement(previous = {}, next = {}) {
  return Boolean(
    previous.documentEpoch !== next.documentEpoch ||
    previous.latestAssistantHash !== next.latestAssistantHash ||
    Number(previous.assistantCount || 0) !== Number(next.assistantCount || 0) ||
    Boolean(previous.generating) !== Boolean(next.generating)
  );
}
