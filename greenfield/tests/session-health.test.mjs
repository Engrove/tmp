import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  A2A_PROMPT_PROFILE_NOTE,
  A2A_RUNTIME_CONTROL_NOTE,
  buildA2AEnvelope,
  composeA2APrompt,
  initialMissionObjective
} from "../lib/a2a.mjs";
import {
  completeSessionHealthTurn,
  createSessionHealthState,
  markSessionHealthFirstResponse,
  markSessionHealthPromptPosted,
  markSessionHealthRecovery,
  resetSessionHealthForRotation,
  sessionHealthCapsule
} from "../lib/session-health.mjs";

function completeTurn(state, {
  turn,
  hash,
  postedAtMs,
  firstAtMs,
  completedAtMs,
  promptChars = 1000,
  responseChars = 1500
}) {
  state = markSessionHealthPromptPosted(state, {
    sessionSeq: state.sessionSeq,
    turn,
    promptHash: hash,
    promptChars,
    postedAtMs
  });
  state = markSessionHealthFirstResponse(state, {
    promptHash: hash,
    observedAtMs: firstAtMs
  });
  return completeSessionHealthTurn(state, {
    promptHash: hash,
    completedAtMs,
    responseChars
  });
}

test("session health measures TTFR from actual prompt post, excluding pre-post waits", () => {
  let state = createSessionHealthState({ sessionSeq: 1, sessionStartTurn: 1, now: 0 });
  // A hypothetical 5 minute mission pause and 90 second global post gate happened
  // before postedAtMs. Neither enters the TTFR calculation.
  state = completeTurn(state, {
    turn: 1,
    hash: "h1",
    postedAtMs: 390_000,
    firstAtMs: 397_000,
    completedAtMs: 405_000
  });
  const capsule = sessionHealthCapsule(state, { turn: 1 });
  assert.equal(capsule.ttfrMs, 7_000);
  assert.equal(capsule.completionMs, 8_000);
  assert.equal(capsule.managedPromptChars, 1000);
  assert.equal(capsule.capturedResponseChars, 1500);
  assert.equal(capsule.sessionTurns, 1);
});

test("session health prompt accounting is idempotent for the same prompt hash", () => {
  let state = createSessionHealthState({ sessionSeq: 1, sessionStartTurn: 1, now: 0 });
  state = markSessionHealthPromptPosted(state, {
    sessionSeq: 1, turn: 1, promptHash: "same", promptChars: 800, postedAtMs: 1000
  });
  state = markSessionHealthPromptPosted(state, {
    sessionSeq: 1, turn: 1, promptHash: "same", promptChars: 800, postedAtMs: 1200
  });
  assert.equal(state.promptsPosted, 1);
  assert.equal(state.managedPromptChars, 800);
  assert.equal(state.activeTurn.postedAtMs, 1000);
});

test("session health establishes a per-session TTFR baseline and rising signal", () => {
  let state = createSessionHealthState({ sessionSeq: 1, sessionStartTurn: 1, now: 0 });
  state = completeTurn(state, { turn: 1, hash: "h1", postedAtMs: 1_000, firstAtMs: 6_000, completedAtMs: 8_000 });
  state = completeTurn(state, { turn: 2, hash: "h2", postedAtMs: 10_000, firstAtMs: 15_500, completedAtMs: 18_000 });
  state = completeTurn(state, { turn: 3, hash: "h3", postedAtMs: 20_000, firstAtMs: 25_000, completedAtMs: 28_000 });
  state = completeTurn(state, { turn: 4, hash: "h4", postedAtMs: 30_000, firstAtMs: 43_000, completedAtMs: 46_000 });
  const capsule = sessionHealthCapsule(state, { turn: 4 });
  assert.equal(capsule.ttfrBaselineMs, 5_000);
  assert.equal(capsule.ttfrRatio, 2.6);
  assert.equal(capsule.latencyTrend, "RISING");
  assert.equal(capsule.signals.includes("TTFR_RISING"), false);
  assert.ok(capsule.signals.includes("TTFR_HIGH_RELATIVE"));
  assert.equal(capsule.pressureBand, "WATCH");
});

test("recovery-tainted samples do not seed clean TTFR baseline", () => {
  let state = createSessionHealthState({ sessionSeq: 1, sessionStartTurn: 1, now: 0 });
  state = markSessionHealthPromptPosted(state, {
    sessionSeq: 1, turn: 1, promptHash: "h1", promptChars: 100, postedAtMs: 1000
  });
  state = markSessionHealthRecovery(state);
  state = markSessionHealthFirstResponse(state, { promptHash: "h1", observedAtMs: 9000 });
  state = completeSessionHealthTurn(state, { promptHash: "h1", completedAtMs: 10000, responseChars: 100 });
  const capsule = sessionHealthCapsule(state, { turn: 1 });
  assert.equal(capsule.sampleCount, 1);
  assert.equal(capsule.cleanSampleCount, 0);
  assert.equal(capsule.ttfrBaselineMs, null);
});

test("session rotation resets pressure telemetry but not mission lineage fields outside this module", () => {
  let state = createSessionHealthState({ sessionSeq: 1, sessionStartTurn: 1, now: 0 });
  state = completeTurn(state, { turn: 1, hash: "h1", postedAtMs: 1000, firstAtMs: 2000, completedAtMs: 3000 });
  state = markSessionHealthRecovery(state);
  state = resetSessionHealthForRotation(state, { sessionSeq: 2, sessionStartTurn: 2, now: 4000 });
  const capsule = sessionHealthCapsule(state, { turn: 2 });
  assert.equal(capsule.sessionSeq, 2);
  assert.equal(capsule.sessionStartTurn, 2);
  assert.equal(capsule.sessionTurns, 0);
  assert.equal(capsule.managedContextChars, 0);
  assert.equal(capsule.sampleCount, 0);
  assert.equal(capsule.recoveryChurn, 0);
  assert.equal(capsule.pressureBand, "LOW");
});

test("A2A transport is minified JSON and carries advisory session health without removing control semantics", () => {
  const process = {
    processId: "process-1",
    runId: "run-1",
    generation: 1,
    turn: 1,
    sessionSeq: 1,
    goal: "Complete the mission",
    sessionHealth: createSessionHealthState({ sessionSeq: 1, sessionStartTurn: 1, now: 0 })
  };
  const out = composeA2APrompt({
    process,
    objective: initialMissionObjective(),
    messageType: "MISSION_START",
    at: 1
  });
  assert.equal(out.text, JSON.stringify(out.envelope));
  assert.equal(out.text.includes("\n"), false);
  assert.equal(out.envelope.sessionHealth.schema, "eic.greenfield.session-health.v1");
  assert.equal(out.envelope.sessionHealth.pressureBand, "LOW");
  assert.equal(out.envelope.responseContract.pauseControl.action, "PAUSE_PROCESS");
  assert.equal(out.envelope.responseContract.sessionHealthControl.telemetry, "ADVISORY_PROXY_NOT_TOKEN_COUNT");
  assert.match(out.envelope.responseContract.sessionHealthControl.decision, /Nano may provide/);
  assert.ok(out.envelope.responseContract.jsonSchema.properties.sessionAction.enum.includes("ROTATE_SESSION_NOW"));
  assert.equal(out.envelope.control.selfContinuationAuthority, false);
  assert.equal(out.envelope.mission, "Complete the mission");
  assert.notEqual(out.envelope.objective, out.envelope.mission);
});

test("session health stays advisory: high proxy pressure does not mutate sessionAction or mission authority", () => {
  let health = createSessionHealthState({ sessionSeq: 3, sessionStartTurn: 20, now: 0 });
  health = { ...health, promptsPosted: 25, managedPromptChars: 220_000, recoveryChurn: 3 };
  const envelope = buildA2AEnvelope({
    process: {
      processId: "p",
      runId: "r",
      generation: 3,
      turn: 44,
      sessionSeq: 3,
      goal: "Keep mission scope fixed.",
      sessionHealth: health
    },
    objective: "Continue bounded work.",
    messageType: "CONTINUATION",
    at: 1
  });
  assert.equal(envelope.sessionHealth.pressureBand, "HIGH");
  assert.equal(envelope.control.selfContinuationAuthority, false);
  assert.equal(envelope.responseContract.jsonSchema.properties.sessionAction.enum.includes("ROTATE_SESSION_NOW"), true);
  assert.equal(Object.hasOwn(envelope.sessionHealth, "sessionAction"), false);
});


test("v1.7.7 preserves the v1.3.1 A2A contract apart from additive health, owner-state, mixed-language/status control, runtime-control/prompt-profile metadata and the intentional 0-300 prompt-gate range", () => {
  const baseline = JSON.parse(fs.readFileSync(new URL("./fixtures/v1.3.1-a2a-stable-contract.json", import.meta.url), "utf8"));
  const process = {
    processId: "p",
    runId: "r",
    generation: 1,
    turn: 1,
    sessionSeq: 1,
    goal: "Mission",
    sessionHealth: createSessionHealthState({ sessionSeq: 1, sessionStartTurn: 1, now: 0 })
  };
  const envelope = buildA2AEnvelope({
    process,
    objective: initialMissionObjective(),
    messageType: "MISSION_START",
    at: 1
  });
  const currentResponseContract = { ...envelope.responseContract };
  delete currentResponseContract.sessionHealthControl;
  // v1.7.7 adds the additive AI runtime-control contract/schema and the
  // FULL/COMPACT prompt-profile note without changing the baseline contract.
  delete currentResponseContract.runtimeControlContract;
  currentResponseContract.jsonSchema = JSON.parse(JSON.stringify(currentResponseContract.jsonSchema));
  delete currentResponseContract.jsonSchema.properties.runtimeControl;
  currentResponseContract.note = currentResponseContract.note
    .replace(` ${A2A_RUNTIME_CONTROL_NOTE}`, "")
    .replace(` ${A2A_PROMPT_PROFILE_NOTE}`, "");
  // v1.7.6 adds the mandatory owner-state/current_focus prompt contract.
  delete currentResponseContract.ownerStateRule;
  // v1.7.4 adds an optional one-shot process-status request without changing
  // the baseline continuation/authority contract.
  delete currentResponseContract.processStatusControl;
  if (currentResponseContract.jsonSchema?.properties) {
    delete currentResponseContract.jsonSchema.properties.greenfieldStatusRequest;
  }
  currentResponseContract.note = currentResponseContract.note.replace(
    "To request one bounded full Greenfield control-plane status capsule in the next prompt, return greenfieldStatusRequest=FULL_NEXT_PROMPT. ",
    ""
  );
  // v1.7.3 intentionally makes machine A2A English while carrying the
  // operator-language policy and ambient en/sv/fi evidence separately.
  currentResponseContract.language = baseline.responseContract.language;
  delete currentResponseContract.operatorFacingLanguage;
  delete currentResponseContract.mixedLanguageExpected;
  delete currentResponseContract.ambientLanguages;
  delete currentResponseContract.rawEvidenceLanguage;
  currentResponseContract.note = currentResponseContract.note.replace(
    "All Greenfield/A2A machine-control prose and NANO_TASK directives must be English. UI/operator/source evidence may continuously mix English, Swedish and Finnish; preserve quoted labels verbatim, resolve structural control identity and local language/context before lexical ranking, and never reinterpret an incidental token solely by another language's meaning. ",
    ""
  );
  const currentSender = { ...envelope.sender };
  const baselineSender = { ...baseline.sender };
  delete currentSender.version;
  delete baselineSender.version;
  assert.deepEqual(currentSender, baselineSender);
  assert.deepEqual(envelope.recipient, baseline.recipient);
  const currentControl = { ...envelope.control };
  delete currentControl.ownerState;
  delete currentControl.runtimeControl;
  assert.deepEqual(currentControl, baseline.control);
  const expectedResponseContract = JSON.parse(
    JSON.stringify(baseline.responseContract).replaceAll("0-90", "0-300")
  );
  assert.deepEqual(currentResponseContract, expectedResponseContract);
});


test("missing pre-v1.3.2 health state initializes at the current session lineage instead of session 1", () => {
  const capsule = sessionHealthCapsule(undefined, {
    turn: 17,
    sessionSeq: 4,
    sessionStartTurn: 17
  });
  assert.equal(capsule.sessionSeq, 4);
  assert.equal(capsule.sessionStartTurn, 17);
  assert.equal(capsule.sessionTurns, 0);
});


test("reconciled unknown-effect prompt timing is retained but excluded from clean latency baseline", () => {
  let state = createSessionHealthState({ sessionSeq: 1, sessionStartTurn: 1, now: 0 });
  state = markSessionHealthPromptPosted(state, {
    sessionSeq: 1,
    turn: 1,
    promptHash: "reconciled",
    promptChars: 200,
    postedAtMs: 10_000,
    timingEligible: false
  });
  state = markSessionHealthFirstResponse(state, { promptHash: "reconciled", observedAtMs: 12_000 });
  state = completeSessionHealthTurn(state, {
    promptHash: "reconciled",
    completedAtMs: 13_000,
    responseChars: 100
  });
  const capsule = sessionHealthCapsule(state, { turn: 1, sessionSeq: 1 });
  assert.equal(capsule.sampleCount, 1);
  assert.equal(capsule.cleanSampleCount, 0);
  assert.equal(state.samples[0].clean, false);
});
