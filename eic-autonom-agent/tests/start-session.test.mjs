import test from "node:test";
import assert from "node:assert/strict";
import {
  START_RESPONSE_CONTRACTS,
  buildStartPromptRecord,
  canonicalStartPrompt,
  inspectStartPromptContract,
  validateStartAnalysis
} from "../lib/start-session.mjs";
import { sha256Hex } from "../lib/common.mjs";

test("raw startprompt preserves leading and trailing whitespace exactly", async () => {
  const text = "  # Start\nDo work.\n";
  assert.equal(canonicalStartPrompt(text), text);
  const digest = await sha256Hex(text);
  const record = await buildStartPromptRecord(text, {
    summary: "Deliver the requested bounded work.",
    taskIntent: "Complete the exact operator task.",
    firstWorkUnit: "Owner-read the exact current work-package state and record the result.",
    constraints: ["Do not mutate before current-state readback."],
    risks: ["Stale state."],
    requiredEvidence: ["Exact owner readback."],
    promptDigest: digest,
    chunksRead: 1
  });
  assert.equal(record.text, text);
  assert.equal(record.digest, digest);
  assert.equal(record.length, text.length);
});

test("current turnless four-field contract is detected without wrapping", () => {
  const contract = inspectStartPromptContract(`Protocol: EIC-AA/5\nEIC_NEXT: <step>\nEIC_COMPLETION_EVIDENCE: <evidence>\nEIC_NEXT_ACTOR: AGENT\nEIC_AUTONOMY: CONTINUE`);
  assert.equal(contract.responseContract, START_RESPONSE_CONTRACTS.TURNLESS_4);
  assert.equal(contract.expectedTurnId, "");
});

test("current bound five-line contract extracts its own turn id", () => {
  const contract = inspectStartPromptContract(`<!-- EIC_FIELD:turnId=turn-existing-42 -->\nEIC_TURN: turn-existing-42\nEIC_NEXT: x\nEIC_COMPLETION_EVIDENCE: y\nEIC_NEXT_ACTOR: AGENT\nEIC_AUTONOMY: CONTINUE`);
  assert.equal(contract.responseContract, START_RESPONSE_CONTRACTS.TURN_BOUND_5);
  assert.equal(contract.expectedTurnId, "turn-existing-42");
});

test("start analysis rejects meta-only and multi-unit first actions", () => {
  const base = {
    summary: "summary",
    taskIntent: "intent",
    constraints: ["constraint"],
    risks: [],
    requiredEvidence: ["evidence"],
    promptDigest: "abc",
    chunksRead: 1
  };
  const meta = validateStartAnalysis({ ...base, firstWorkUnit: "Läs och följ startprompten i sin helhet." }, {
    expectedDigest: "abc", expectedChunks: 1
  });
  assert.equal(meta.valid, false);
  assert.ok(meta.errors.includes("START_WORK_UNIT_META_ONLY"));
  const broad = validateStartAnalysis({ ...base, firstWorkUnit: "Genomför U0-U3 och rapportera." }, {
    expectedDigest: "abc", expectedChunks: 1
  });
  assert.equal(broad.valid, false);
  assert.ok(broad.errors.includes("START_WORK_UNIT_NOT_ATOMIC"));
});
