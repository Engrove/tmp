import test from "node:test";
import assert from "node:assert/strict";
import { parseTargetResult } from "../lib/prompt-contract.mjs";

test("turn-bound trailer remains valid with bounded benign trailing DOM text", () => {
  const valid = [
    "Resultat klart.",
    "EIC_TURN: turn-1",
    "EIC_NEXT: NONE",
    "EIC_COMPLETION_EVIDENCE: PROGRAM_DONE · artifact 42",
    "EIC_NEXT_ACTOR: NONE",
    "EIC_AUTONOMY: DONE"
  ].join("\n");
  assert.equal(parseTargetResult(valid, "turn-1").valid, true);

  for (let count = 1; count <= 5; count += 1) {
    const trailing = `${valid}\n${Array.from({ length: count }, (_, index) => `UI-rad ${index + 1}`).join("\n")}`;
    const parsed = parseTargetResult(trailing, "turn-1");
    assert.equal(parsed.valid, true);
    assert.equal(parsed.status, "DONE");
  }
});

test("duplicate protocol markers in bounded tail are rejected", () => {
  const duplicate = [
    "EIC_TURN: turn-1",
    "EIC_NEXT: NONE",
    "EIC_COMPLETION_EVIDENCE: PROGRAM_DONE · artifact 42",
    "EIC_NEXT_ACTOR: NONE",
    "EIC_AUTONOMY: DONE",
    "EIC_NEXT_ACTOR: AGENT",
    "EIC_AUTONOMY: CONTINUE"
  ].join("\n");
  const parsed = parseTargetResult(duplicate, "turn-1");
  assert.equal(parsed.valid, false);
  assert.equal(parsed.reason, "PROTOCOL_AMBIGUOUS");
});

test("turnless legacy contract is rejected in current-only mode", () => {
  const text = [
    "Arbetet fortsätter.",
    "EIC_NEXT: Owner-read receipt 42.",
    "EIC_COMPLETION_EVIDENCE: UNIT_DONE · Den avgränsade responsen är klar.",
    "EIC_NEXT_ACTOR: AGENT",
    "EIC_AUTONOMY: CONTINUE"
  ].join("\n");
  assert.equal(parseTargetResult(text, "", { allowTurnless: true }).valid, true);
  assert.equal(parseTargetResult(text, "turn-1").valid, false);
});

test("contradictory DONE with a next action is rejected", () => {
  const parsed = parseTargetResult([
    "EIC_TURN: turn-1",
    "EIC_NEXT: Continue anyway",
    "EIC_COMPLETION_EVIDENCE: PROGRAM_DONE · artifact 42",
    "EIC_NEXT_ACTOR: NONE",
    "EIC_AUTONOMY: DONE"
  ].join("\n"), "turn-1");
  assert.equal(parsed.valid, false);
  assert.equal(parsed.reason, "PROTOCOL_DONE_REQUIRES_NONE_AND_PROGRAM_DONE");
});
