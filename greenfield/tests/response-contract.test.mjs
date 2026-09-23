import test from "node:test";
import assert from "node:assert/strict";
import { parseTargetResponse, validateTargetResponse } from "../lib/response-contract.mjs";

function response(status = "CONTINUE", patch = {}) {
  return {
    schema: "eic.a2a.response.v1",
    status,
    summary: "Result summary",
    workPerformed: ["Did one thing"],
    evidence: ["Evidence"],
    blockers: [],
    nextSuggestedAction: "Continue safely",
    ...patch
  };
}

test("target response parser finds canonical JSON inside ChatGPT wrapper/footer", () => {
  const source = `EIC sade:Arbetade i 16s${JSON.stringify(response("BLOCKED"))}
Status: blocked
Time: 2026-09-01T05:00:00Z`;
  const parsed = parseTargetResponse(source);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.status, "BLOCKED");
  assert.equal(parsed.value.summary, "Result summary");
});

test("target response parser rejects additional properties instead of fabricating status", () => {
  const parsed = parseTargetResponse(JSON.stringify(response("CONTINUE", { unexpected: true })));
  assert.equal(parsed.found, true);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.status, "UNKNOWN");
  assert.ok(parsed.errors.some((e) => e.startsWith("ADDITIONAL_PROPERTY:")));
});

test("target response validation requires canonical status", () => {
  const r = validateTargetResponse(response("MAYBE"));
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes("STATUS"));
});


test("target response parser repairs renderer-lost quote escapes only when canonical schema validates", () => {
  const canonical = response("CONTINUE", {
    nextSuggestedAction: 'NANO_TASK: Return GREENFIELD_DIRECT_OK. Include nanoTask.promptLanguage="en" and nanoTask.promptPolicy="ENGLISH_DIRECT_EXECUTION_V1" in evidence.'
  });
  const strict = JSON.stringify(canonical);
  const rendered = strict
    .replaceAll('\\"en\\"', '"en"')
    .replaceAll('\\"ENGLISH_DIRECT_EXECUTION_V1\\"', '"ENGLISH_DIRECT_EXECUTION_V1"');
  const source = `EIC sade:${rendered}\nStatus: continuation\nTime: 2026-09-01T06:29:13Z`;

  const parsed = parseTargetResponse(source);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.status, "CONTINUE");
  assert.equal(parsed.parseMode, "REPAIRED_UNESCAPED_QUOTES");
  assert.equal(parsed.repairApplied, true);
  assert.ok(parsed.repairCount >= 4);
  assert.match(parsed.value.nextSuggestedAction, /promptLanguage="en"/);
  assert.match(parsed.value.nextSuggestedAction, /promptPolicy="ENGLISH_DIRECT_EXECUTION_V1"/);
});

test("renderer repair cannot elevate a non-canonical object", () => {
  const source = 'EIC sade:{"schema":"wrong.schema","status":"CONTINUE","summary":"x","workPerformed":[],"evidence":[],"blockers":[],"nextSuggestedAction":"quote "inside" text"}';
  const parsed = parseTargetResponse(source);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.status, "UNKNOWN");
});


test("target response parser repairs live renderer quote loss when embedded quoted metadata is followed by commas", () => {
  const source = `EIC sade:{
"schema": "eic.a2a.response.v1",
"status": "CONTINUE",
"summary": "Live renderer regression",
"workPerformed": ["Observed parser boundary"],
"evidence": ["Exact source fixture"],
"blockers": [],
"nextSuggestedAction": "NANO_TASK: Return GREENFIELD_UI_OK. In the next CONTINUATION expose nanoTask.promptLanguage="en", nanoTask.promptPolicy="ENGLISH_DIRECT_EXECUTION_V1", Hjalmar runtimeCorrections if any, and canonical previousDisposition=CONTINUE."
}
Status: continuation
Time: 2026-09-01T06:52:33Z`;

  const parsed = parseTargetResponse(source);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.status, "CONTINUE");
  assert.equal(parsed.parseMode, "REPAIRED_UNESCAPED_QUOTES");
  assert.equal(parsed.repairApplied, true);
  assert.equal(parsed.repairCount, 4);
  assert.match(parsed.value.nextSuggestedAction, /promptLanguage="en", nanoTask\.promptPolicy="ENGLISH_DIRECT_EXECUTION_V1",/);
});

test("renderer repair preserves normal multi-item JSON arrays", () => {
  const source = `EIC sade:{
"schema": "eic.a2a.response.v1",
"status": "CONTINUE",
"summary": "Array fixture",
"workPerformed": ["first", "second"],
"evidence": ["alpha", "beta"],
"blockers": [],
"nextSuggestedAction": "Continue with promptLanguage="en", promptPolicy="ENGLISH_DIRECT_EXECUTION_V1", then proceed."
}`;
  const parsed = parseTargetResponse(source);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value.workPerformed, ["first", "second"]);
  assert.deepEqual(parsed.value.evidence, ["alpha", "beta"]);
});


test("control-plane salvage admits one canonical status when renderer corrupts only descriptive JSON strings", () => {
  const source = `EIC sade:{
"schema": "eic.a2a.response.v1",
"status": "CONTINUE",
"summary": "Renderer-degraded fixture",
"workPerformed": ["Task completed"],
"evidence": [
"nanoTask.status=COMPLETED.",
"nanoTask.result="GREENFIELD_V115_OK\\n"."
],
"blockers": [],
"nextSuggestedAction": "Continue the shakedown without requesting another Nano task."
}
Status: continuation`;

  const parsed = parseTargetResponse(source);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.controlOk, true);
  assert.equal(parsed.status, "CONTINUE");
  assert.equal(parsed.parseMode, "CONTROL_PLANE_SALVAGE");
  assert.equal(parsed.control.nextSuggestedAction, "Continue the shakedown without requesting another Nano task.");
  assert.deepEqual(parsed.errors, ["RENDERER_SCHEMA_DEGRADED"]);
});

test("control-plane salvage remains fail-closed when canonical status is absent", () => {
  const source = `EIC sade:{
"schema": "eic.a2a.response.v1",
"summary": "No status",
"evidence": ["broken "quote""],
"nextSuggestedAction": "Continue"
}`;
  const parsed = parseTargetResponse(source);
  assert.equal(parsed.ok, false);
  assert.notEqual(parsed.controlOk, true);
  assert.equal(parsed.status, "UNKNOWN");
  assert.ok(
    parsed.errors.includes("CONTROL_STATUS_NOT_FOUND") ||
    parsed.errors.includes("STATUS")
  );
});

test("control-plane salvage remains fail-closed when status field is ambiguous before summary", () => {
  const source = `EIC sade:{
"schema": "eic.a2a.response.v1",
"status": "CONTINUE",
"status": "BLOCKED",
"summary": "Ambiguous",
"evidence": ["broken "quote""],
"nextSuggestedAction": "Continue"
}`;
  const parsed = parseTargetResponse(source);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.controlOk, false);
  assert.equal(parsed.status, "UNKNOWN");
  assert.ok(parsed.errors.includes("CONTROL_STATUS_AMBIGUOUS"));
});


test("v1.2.3 accepts explicit session rotation control and bounded reason", () => {
  const parsed = parseTargetResponse(JSON.stringify(response("CONTINUE", {
    sessionAction: "ROTATE_SESSION_NOW",
    sessionReason: "Material context drift risk."
  })));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.sessionAction, "ROTATE_SESSION_NOW");
  assert.equal(parsed.value.sessionReason, "Material context drift risk.");
});

test("v1.2.3 rejects unknown or contradictory session controls", () => {
  const unknown = validateTargetResponse(response("CONTINUE", { sessionAction: "ROTATE_MAYBE" }));
  assert.equal(unknown.ok, false);
  assert.ok(unknown.errors.includes("SESSION_ACTION"));

  const conflict = validateTargetResponse(response("DONE", { sessionAction: "ROTATE_SESSION_NOW" }));
  assert.equal(conflict.ok, false);
  assert.ok(conflict.errors.includes("SESSION_ACTION_STATUS_CONFLICT"));
});

test("renderer-safe control salvage carries one exact sessionAction without prose interpretation", () => {
  const source = `EIC sade:{
"schema": "eic.a2a.response.v1",
"status": "CONTINUE",
"sessionAction": "ROTATE_SESSION_NOW",
"summary": "Renderer-degraded fixture",
"workPerformed": ["Task completed"],
"evidence": [
"nanoTask.status=COMPLETED.",
"nanoTask.result="GREENFIELD_V123_OK\\n"."
],
"blockers": [],
"nextSuggestedAction": "Resume from owners."
}
Status: continuation`;
  const parsed = parseTargetResponse(source);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.controlOk, true);
  assert.equal(parsed.control.sessionAction, "ROTATE_SESSION_NOW");
  assert.equal(parsed.control.nextSuggestedAction, "Resume from owners.");
});


test("v1.3.7 accepts explicit queue yield only for CONTINUE with restart-safe next action", () => {
  const parsed = parseTargetResponse(JSON.stringify(response("CONTINUE", {
    sessionAction: "YIELD_TO_QUEUE",
    sessionReason: "Checkpoint complete; another queued mission may run.",
    nextSuggestedAction: "Resume from the owner-persisted checkpoint in a fresh ChatGPT conversation."
  })));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.sessionAction, "YIELD_TO_QUEUE");
});

test("v1.3.7 rejects queue yield when status is terminal or next action is empty", () => {
  const terminal = validateTargetResponse(response("DONE", {
    sessionAction: "YIELD_TO_QUEUE",
    nextSuggestedAction: "Not applicable"
  }));
  assert.equal(terminal.ok, false);
  assert.ok(terminal.errors.includes("QUEUE_YIELD_REQUIRES_CONTINUE_STATUS"));
  assert.ok(terminal.errors.includes("SESSION_ACTION_STATUS_CONFLICT"));

  const empty = validateTargetResponse(response("CONTINUE", {
    sessionAction: "YIELD_TO_QUEUE",
    nextSuggestedAction: ""
  }));
  assert.equal(empty.ok, false);
  assert.ok(empty.errors.includes("QUEUE_YIELD_NEXT_ACTION_REQUIRED"));
});
