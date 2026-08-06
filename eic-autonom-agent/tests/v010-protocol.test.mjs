import test from "node:test";
import assert from "node:assert/strict";
import { parseTargetResult, TURN_PROTOCOL, TURN_SCHEMA_VERSION } from "../lib/prompt-contract.mjs";

const result = (actor, autonomy, completion, next = "Fortsätt exakt steg.") => parseTargetResult(`
Svar.
EIC_TURN: turn-1
EIC_NEXT: ${next}
EIC_COMPLETION_EVIDENCE: ${completion} · verifierat
EIC_NEXT_ACTOR: ${actor}
EIC_AUTONOMY: ${autonomy}
`, "turn-1");

test("v0.10 uses EIC-AA/5", () => {
  assert.equal(TURN_PROTOCOL, "EIC-AA/5");
  assert.equal(TURN_SCHEMA_VERSION, 5);
});

test("v0.10 protocol emits ordinary continuation", () => {
  const parsed = result("AGENT", "CONTINUE", "MILESTONE_CONTINUE");
  assert.equal(parsed.valid, true);
  assert.equal(parsed.nextActor, "AGENT");
});

test("v0.10 protocol emits operator action and blocks actor mismatch", () => {
  assert.equal(result("OPERATOR_ACTION", "OPERATOR_ACTION_REQUIRED", "MILESTONE_CONTINUE").valid, true);
  assert.equal(result("OPERATOR_DECISION", "OPERATOR_ACTION_REQUIRED", "MILESTONE_CONTINUE").valid, false);
});

test("v0.10 protocol distinguishes user pause and done", () => {
  assert.equal(result("OPERATOR_DECISION", "USER_PAUSE", "PROGRAM_BLOCKED").valid, true);
  assert.equal(result("NONE", "DONE", "PROGRAM_DONE", "NONE").valid, true);
  assert.equal(result("AGENT", "DONE", "PROGRAM_DONE", "NONE").valid, false);
});
