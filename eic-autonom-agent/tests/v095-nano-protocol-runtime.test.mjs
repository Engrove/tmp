import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { MISSION_MODE_IDS } from "../lib/mission-contract.mjs";
import { missionModeRequiresNanoHost } from "../lib/mission-mode-adapter.mjs";
import { parseTargetResult } from "../lib/prompt-contract.mjs";
import {
  PROTOCOL_DECISION_PATHS,
  protocolFastPathEligible,
  selectProtocolDecisionPath
} from "../lib/protocol-fast-path.mjs";
import { buildProtocolRepairDecision } from "../lib/task-integrity.mjs";

function trailer({
  turn = "turn-current",
  next = "Läs nästa owner-state.",
  completion = "UNIT_DONE · Den avgränsade enheten är klar.",
  status = "CONTINUE"
} = {}) {
  return [
    `EIC_TURN: ${turn}`,
    `EIC_NEXT: ${next}`,
    `EIC_COMPLETION_EVIDENCE: ${completion}`,
    `EIC_NEXT_ACTOR: ${status === "USER_PAUSE" ? "OPERATOR_DECISION" : status === "DONE" ? "NONE" : status === "OPERATOR_ACTION_REQUIRED" ? "OPERATOR_ACTION" : "AGENT"}`,
    `EIC_AUTONOMY: ${status}`
  ].join("\n");
}

test("v0.9.5 every active mission requires a gesture-bound Nano host", () => {
  for (const modeId of Object.values(MISSION_MODE_IDS)) {
    assert.equal(missionModeRequiresNanoHost(modeId), true, modeId);
  }
  assert.equal(missionModeRequiresNanoHost("UNKNOWN"), false);
});

test("v0.9.5 sidepanel starts Nano before the first await for continuation", async () => {
  const source = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");
  const start = source.slice(
    source.indexOf("async function startMissionMode"),
    source.indexOf("function loadUiFocusPreference")
  );
  assert.match(start, /missionModeRequiresNanoHost\(modeId\)/u);
  assert.ok(
    start.indexOf("beginNanoCreateFromGesture()") < start.indexOf("await saveConfigNow()"),
    "Nano create must begin inside the operator gesture before the first await."
  );
  assert.match(start, /NANO_HOST_NOT_READY/u);
});

test("v0.9.5 takeover always routes through Nano even when the existing footer is invalid", () => {
  assert.equal(selectProtocolDecisionPath({
    targetResult: { valid: false, reason: "PROTOCOL_AMBIGUOUS" },
    analysisMode: "TAKEOVER_BOOTSTRAP",
    continuityGrounded: false,
    currentTurnKind: ""
  }), PROTOCOL_DECISION_PATHS.NANO);
});

test("v0.9.5 an invalid response after a repair turn routes through Nano instead of looping repair", () => {
  assert.equal(selectProtocolDecisionPath({
    targetResult: { valid: false, reason: "WRONG_TURN" },
    analysisMode: "CONTINUATION_ANALYSIS",
    continuityGrounded: true,
    currentTurnKind: "PROTOCOL_REPAIR"
  }), PROTOCOL_DECISION_PATHS.NANO);
});

test("v0.9.5 first non-takeover invalid response gets one bounded deterministic repair", () => {
  assert.equal(selectProtocolDecisionPath({
    targetResult: { valid: false, reason: "PROTOCOL_MISSING" },
    analysisMode: "CONTINUATION_ANALYSIS",
    continuityGrounded: true,
    currentTurnKind: "CONTINUATION"
  }), PROTOCOL_DECISION_PATHS.REPAIR);
});

test("v0.9.5 CONTINUE accepts UNIT_DONE and MILESTONE_CONTINUE evidence", () => {
  for (const state of ["UNIT_DONE", "MILESTONE_CONTINUE"]) {
    const result = parseTargetResult(trailer({
      completion: `${state} · Konkret owner-bunden evidens finns.`
    }), "turn-current");
    assert.equal(result.valid, true, state);
    assert.equal(result.completionState, state);
    assert.equal(protocolFastPathEligible(result), true);
  }
});

test("v0.9.5 DONE requires PROGRAM_DONE and no next action", () => {
  const valid = parseTargetResult(trailer({
    next: "NONE",
    completion: "PROGRAM_DONE · Hela mandatet är owner-verifierat avslutat.",
    status: "DONE"
  }), "turn-current");
  assert.equal(valid.valid, true);
  assert.equal(valid.completionState, "PROGRAM_DONE");
  assert.equal(protocolFastPathEligible(valid), true);

  const invalid = parseTargetResult(trailer({
    next: "NONE",
    completion: "UNIT_DONE · Endast arbetsenheten är klar.",
    status: "DONE"
  }), "turn-current");
  assert.equal(invalid.valid, false);
  assert.equal(invalid.reason, "PROTOCOL_DONE_REQUIRES_NONE_AND_PROGRAM_DONE");
});

test("v0.9.5 USER_PAUSE requires PROGRAM_BLOCKED and an exact decision", () => {
  const valid = parseTargetResult(trailer({
    next: "Operatören måste välja exakt releasebeslut.",
    completion: "PROGRAM_BLOCKED · Icke-delegerbar mänsklig authority krävs.",
    status: "USER_PAUSE"
  }), "turn-current");
  assert.equal(valid.valid, true);
  assert.equal(valid.completionState, "PROGRAM_BLOCKED");
  assert.equal(protocolFastPathEligible(valid), true);

  const invalid = parseTargetResult(trailer({
    completion: "UNIT_DONE · Enheten är klar.",
    status: "USER_PAUSE"
  }), "turn-current");
  assert.equal(invalid.valid, false);
  assert.equal(invalid.reason, "PROTOCOL_USER_PAUSE_REQUIRES_PROGRAM_BLOCKED");
});

test("v0.9.5 repair decision never embeds the stale expected turn id", () => {
  const decision = buildProtocolRepairDecision({
    reason: "WRONG_TURN",
    expectedTurnId: "turn-stale"
  });
  assert.doesNotMatch(decision.requestedAction, /turn-stale/u);
  assert.match(decision.requestedAction, /aktuella repair-turnens EIC_TURN/u);
});

test("v0.9.5 compiled repair action is rebound to the newly allocated turn id", async () => {
  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  assert.match(
    source,
    /protocolRepairOnly\s*\?\s*`Återge endast en kompakt kontraktsreparation med korrekt EIC_TURN: \$\{turnId\}/u
  );
});

test("v0.9.5 mutable continuity work state is detached from the sealed runtime snapshot", async () => {
  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  assert.match(source, /context\.continuity = deepClone\(selectedContinuity\);/u);
  assert.doesNotMatch(source, /context\.continuity = selectedContinuity;/u);
});
