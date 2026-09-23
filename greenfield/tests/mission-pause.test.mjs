import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildA2AEnvelope, initialMissionObjective } from "../lib/a2a.mjs";
import { PHASES } from "../lib/contracts.mjs";
import { transitionProcess } from "../lib/state.mjs";
import {
  MISSION_PAUSE_ACTION,
  MISSION_PAUSE_MAX_SECONDS,
  MISSION_PAUSE_MIN_SECONDS,
  MISSION_PAUSE_STATES,
  createMissionPauseRecord,
  missionPauseDue,
  normalizeMissionPauseSeconds,
  resumeMissionPauseRecord,
  validateMissionPauseRequest
} from "../lib/mission-pause.mjs";
import { extractRendererSafeControl, parseTargetResponse } from "../lib/response-contract.mjs";

const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
const sidepanel = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
const sidepanelHtml = fs.readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");

test("v1.3.1 mission pause bounds are 5 minutes through 24 hours", () => {
  assert.equal(MISSION_PAUSE_MIN_SECONDS, 300);
  assert.equal(MISSION_PAUSE_MAX_SECONDS, 86400);
  assert.equal(normalizeMissionPauseSeconds(299), null);
  assert.equal(normalizeMissionPauseSeconds(300), 300);
  assert.equal(normalizeMissionPauseSeconds(86400), 86400);
  assert.equal(normalizeMissionPauseSeconds(86401), null);
  assert.equal(normalizeMissionPauseSeconds(300.5), null);
});

test("PAUSE_PROCESS is a CONTINUE control with an explicit next action", () => {
  assert.deepEqual(validateMissionPauseRequest({
    status: "CONTINUE",
    sessionAction: MISSION_PAUSE_ACTION,
    pauseSeconds: 1800,
    nextSuggestedAction: "Re-read the owner and continue."
  }), { ok: true, errors: [] });
  assert.equal(validateMissionPauseRequest({
    status: "BLOCKED",
    sessionAction: MISSION_PAUSE_ACTION,
    pauseSeconds: 1800,
    nextSuggestedAction: "Continue."
  }).ok, false);
  assert.equal(validateMissionPauseRequest({
    status: "CONTINUE",
    sessionAction: MISSION_PAUSE_ACTION,
    pauseSeconds: 1800,
    nextSuggestedAction: ""
  }).ok, false);
});

test("non-pause responses cannot smuggle pauseSeconds", () => {
  const verdict = validateMissionPauseRequest({
    status: "CONTINUE",
    sessionAction: "KEEP",
    pauseSeconds: 1800,
    nextSuggestedAction: "Continue."
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.includes("PAUSE_SECONDS_WITHOUT_PAUSE_ACTION"));
});

test("mission pause receipt is deterministic around its not-before timestamp", () => {
  const nowMs = Date.UTC(2026, 8, 4, 12, 0, 0);
  const pause = createMissionPauseRecord({
    processId: "p1",
    generation: 4,
    durationSeconds: 300,
    reason: "wait",
    sourceResponseHash: "resp",
    nextObjectiveId: "obj2",
    now: nowMs
  });
  assert.equal(pause.state, MISSION_PAUSE_STATES.ARMED);
  assert.equal(pause.resumeAtMs, nowMs + 300_000);
  assert.equal(missionPauseDue(pause, nowMs + 299_999), false);
  assert.equal(missionPauseDue(pause, nowMs + 300_000), true);
  const resumed = resumeMissionPauseRecord(pause, { reason: "SCHEDULED_WAKE", now: nowMs + 301_000 });
  assert.equal(resumed.state, MISSION_PAUSE_STATES.RESUMED);
  const early = resumeMissionPauseRecord(pause, { reason: "OPERATOR_RESUME_NOW", early: true, now: nowMs + 10_000 });
  assert.equal(early.state, MISSION_PAUSE_STATES.RESUMED_EARLY);
});

test("state graph has a dedicated ANALYZING -> PAUSED -> SENDING path", () => {
  const base = {
    schema: "eic.greenfield.process.v1",
    processId: "p1",
    runId: "r1",
    workerId: "worker-1",
    generation: 1,
    phase: PHASES.ANALYZING,
    windowId: 1
  };
  const paused = transitionProcess(base, PHASES.PAUSED);
  assert.equal(paused.phase, PHASES.PAUSED);
  const sending = transitionProcess(paused, PHASES.SENDING);
  assert.equal(sending.phase, PHASES.SENDING);
});

test("strict A2A response parser accepts a valid timed pause", () => {
  const response = {
    schema: "eic.a2a.response.v1",
    status: "CONTINUE",
    sessionAction: "PAUSE_PROCESS",
    pauseSeconds: 7200,
    sessionReason: "Wait for propagation.",
    summary: "Work is safely parked.",
    workPerformed: [],
    evidence: [],
    blockers: [],
    nextSuggestedAction: "Re-read the owner status and continue."
  };
  const parsed = parseTargetResponse(JSON.stringify(response));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.sessionAction, "PAUSE_PROCESS");
  assert.equal(parsed.value.pauseSeconds, 7200);
});

test("strict A2A response parser rejects an out-of-range timed pause", () => {
  const response = {
    schema: "eic.a2a.response.v1",
    status: "CONTINUE",
    sessionAction: "PAUSE_PROCESS",
    pauseSeconds: 120,
    summary: "Too short.",
    workPerformed: [],
    evidence: [],
    blockers: [],
    nextSuggestedAction: "Continue."
  };
  const parsed = parseTargetResponse(JSON.stringify(response));
  assert.equal(parsed.ok, false);
});

test("renderer-safe control salvage retains PAUSE_PROCESS plus pauseSeconds", () => {
  const control = extractRendererSafeControl(
    '{"schema":"eic.a2a.response.v1","status":"CONTINUE","sessionAction":"PAUSE_PROCESS",' +
    '"pauseSeconds":1800,"summary":"Parked.","workPerformed":[],"evidence":[],"blockers":[],' +
    '"nextSuggestedAction":"Re-read owner state and continue."}'
  );
  assert.equal(control.sessionAction, "PAUSE_PROCESS");
  assert.equal(control.pauseSeconds, 1800);
  assert.equal(control.ok, true);
});

test("A2A response contract teaches pause briefly and separately from the global 0-300 second gate", async () => {
  const mission = "Complete the project safely.";
  const msg = buildA2AEnvelope({
    messageType: "MISSION_START",
    process: {
      processId: "p",
      runId: "r",
      generation: 1,
      turn: 1,
      sessionSeq: 1,
      goal: mission,
      gptRoot: "https://chatgpt.com/g/g-test"
    },
    objective: initialMissionObjective()
  });
  assert.equal(msg.mission, mission);
  assert.notEqual(msg.objective, mission);
  assert.equal(msg.responseContract.pauseControl.action, "PAUSE_PROCESS");
  assert.equal(msg.responseContract.pauseControl.pauseSecondsMin, 300);
  assert.equal(msg.responseContract.pauseControl.pauseSecondsMax, 86400);
  assert.match(JSON.stringify(msg.responseContract.pauseControl), /0.?300/i);
});

test("MISSION_START source uses compact initial objective instead of mission duplication", () => {
  assert.match(background, /const startObjective = initialMissionObjective\(\)/);
  assert.match(background, /objective: startObjective/);
  assert.doesNotMatch(background, /buildPendingA2A\(process,\s*\{\s*objective:\s*mission,\s*messageType:\s*"MISSION_START"/s);
});

test("long pause uses a one-shot Chrome alarm and recreates it during hydration", () => {
  assert.match(background, /MISSION_PAUSE_PREFIX/);
  assert.match(background, /chrome\.alarms\.create\(missionPauseAlarmName\(process\.processId\), \{ when: resumeAtMs \}\)/);
  assert.match(background, /hydrateProcesses[\s\S]*syncMissionPauseAlarm\(current\)/);
  assert.match(background, /mission-pause-wake/);
  assert.match(background, /EIC_GF_RESUME_PAUSE_NOW/);
  assert.match(sidepanel, /missionPauseRemainingMs/);
  assert.match(sidepanel, /EIC_GF_RESUME_PAUSE_NOW/);
});

test("mission pause remains distinct from the global prompt gate", () => {
  assert.match(background, /MISSION_PAUSE_PREFIX/);
  assert.match(background, /reserveGlobalPromptSlot/);
  assert.doesNotMatch(background, /MISSION_PAUSE_PREFIX\s*=\s*GLOBAL_PROMPT/);
});


test("side panel wires the PAUSED stage, countdown and explicit early-resume control", () => {
  assert.match(sidepanelHtml, /class="rail rail-v131"/);
  assert.match(sidepanelHtml, /data-stage="PAUSED"/);
  assert.match(sidepanelHtml, /id="missionPauseStatus"/);
  assert.match(sidepanelHtml, /id="resumePause"/);
  assert.match(sidepanel, /\$\("missionPauseStatus"\)/);
  assert.match(sidepanel, /\$\("resumePause"\)/);
});
