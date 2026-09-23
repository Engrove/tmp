import { nowIso, randomId, text } from "./common.mjs";

export const MISSION_PAUSE_ACTION = "PAUSE_PROCESS";
export const MISSION_PAUSE_SCHEMA = "eic.greenfield.mission-pause.v1";
export const MISSION_PAUSE_MIN_SECONDS = 300;
export const MISSION_PAUSE_MAX_SECONDS = 86_400;

export const MISSION_PAUSE_STATES = Object.freeze({
  ARMED: "ARMED",
  RESUMED: "RESUMED",
  RESUMED_EARLY: "RESUMED_EARLY"
});

export function normalizeMissionPauseSeconds(value) {
  const seconds = Number(value);
  if (!Number.isInteger(seconds)) return null;
  if (seconds < MISSION_PAUSE_MIN_SECONDS || seconds > MISSION_PAUSE_MAX_SECONDS) return null;
  return seconds;
}

export function validateMissionPauseRequest({
  sessionAction = "KEEP",
  status = "CONTINUE",
  pauseSeconds,
  nextSuggestedAction = ""
} = {}) {
  const action = String(sessionAction || "KEEP").trim().toUpperCase();
  const hasPauseSeconds = pauseSeconds !== undefined && pauseSeconds !== null;
  const timedAction = action === MISSION_PAUSE_ACTION || action === "BACKGROUND_SLEEP";
  if (!timedAction) {
    return hasPauseSeconds
      ? { ok: false, errors: ["PAUSE_SECONDS_WITHOUT_PAUSE_ACTION"] }
      : { ok: true, errors: [] };
  }

  const errors = [];
  if (String(status || "").trim().toUpperCase() !== "CONTINUE") {
    errors.push("PAUSE_REQUIRES_CONTINUE_STATUS");
  }
  if (normalizeMissionPauseSeconds(pauseSeconds) === null) {
    errors.push("PAUSE_SECONDS_INVALID");
  }
  if (!String(nextSuggestedAction || "").trim()) {
    errors.push("PAUSE_NEXT_ACTION_REQUIRED");
  }
  return { ok: errors.length === 0, errors };
}

export function createMissionPauseRecord({
  processId,
  generation,
  durationSeconds,
  reason = "",
  sourceResponseHash = "",
  nextObjectiveId = "",
  nextPromptHash = "",
  now = Date.now()
} = {}) {
  const seconds = normalizeMissionPauseSeconds(durationSeconds);
  if (!processId) throw new Error("MISSION_PAUSE_PROCESS_REQUIRED");
  if (!Number.isInteger(generation) || generation < 1) throw new Error("MISSION_PAUSE_GENERATION_REQUIRED");
  if (seconds === null) throw new Error("MISSION_PAUSE_SECONDS_INVALID");

  const requestedAtMs = Number(now);
  const resumeAtMs = requestedAtMs + (seconds * 1000);
  return {
    schema: MISSION_PAUSE_SCHEMA,
    pauseId: randomId("pause"),
    processId: String(processId),
    generation,
    state: MISSION_PAUSE_STATES.ARMED,
    requestedBy: "EIC_AI",
    durationSeconds: seconds,
    reason: text(reason, 2000),
    sourceResponseHash: text(sourceResponseHash, 128),
    nextObjectiveId: text(nextObjectiveId, 200),
    nextPromptHash: text(nextPromptHash, 128),
    requestedAtMs,
    requestedAt: nowIso(requestedAtMs),
    resumeAtMs,
    resumeNotBeforeAt: nowIso(resumeAtMs),
    resumedAtMs: 0,
    resumedAt: "",
    resumeReason: ""
  };
}

export function missionPauseRemainingMs(record, now = Date.now()) {
  if (!record || record.state !== MISSION_PAUSE_STATES.ARMED) return 0;
  return Math.max(0, Number(record.resumeAtMs || 0) - Number(now));
}

export function missionPauseDue(record, now = Date.now()) {
  return Boolean(
    record &&
    record.state === MISSION_PAUSE_STATES.ARMED &&
    Number(record.resumeAtMs || 0) > 0 &&
    Number(now) >= Number(record.resumeAtMs || 0)
  );
}

export function resumeMissionPauseRecord(record, {
  now = Date.now(),
  reason = "SCHEDULED_WAKE",
  early = false
} = {}) {
  if (!record || record.state !== MISSION_PAUSE_STATES.ARMED) {
    throw new Error("MISSION_PAUSE_NOT_ARMED");
  }
  const resumedAtMs = Number(now);
  return {
    ...record,
    state: early ? MISSION_PAUSE_STATES.RESUMED_EARLY : MISSION_PAUSE_STATES.RESUMED,
    resumedAtMs,
    resumedAt: nowIso(resumedAtMs),
    resumeReason: String(reason || (early ? "EARLY_RESUME" : "SCHEDULED_WAKE"))
  };
}
