import test from "node:test";
import assert from "node:assert/strict";

import {
  MEMORY_ITEM_STATES,
  SESSION_MEMORY_STATES,
  buildActiveMemoryCapsule,
  createSectionSummary,
  evaluateSessionMemoryFreshness,
  markLiveFieldsStale,
  sectionTurns,
  supersedeMemoryItem,
  synthesizeSessionMemory
} from "../lib/session-memory.mjs";

function turn(index, chars = 7000) {
  return {
    id: `turn-${index}`,
    role: index % 2 ? "assistant" : "user",
    text: `${index}:${"x".repeat(chars)}`,
    sourceHash: `hash-${index}`
  };
}

test("v0.10 section identities are deterministic for the same source hashes", async () => {
  const turns = [turn(0), turn(1), turn(2)];
  const first = await sectionTurns(turns, { captureId: "capture-1", conversationKey: "chat:1" });
  const second = await sectionTurns(turns, { captureId: "capture-1", conversationKey: "chat:1" });
  assert.deepEqual(first.map((item) => item.id), second.map((item) => item.id));
  assert.ok(first.every((item) => item.tokenEstimate <= 4500 || item.turnIds.length === 1));
});

test("v0.10 memory items retain source turns and hashes", async () => {
  const turns = [turn(0, 100), turn(1, 100)];
  const sections = await sectionTurns(turns, { captureId: "capture-1", conversationKey: "chat:1" });
  const summary = await createSectionSummary(sections[0], {
    narrative: "A bounded summary.",
    captureCompleteness: "COMPLETE",
    registers: {
      verifiedFacts: [{
        id: "fact-1",
        text: "The source hash was verified.",
        evidenceClass: "OWNER_RECEIPT",
        confidence: 1
      }]
    }
  }, turns);
  const memory = await synthesizeSessionMemory({
    memoryId: "memory-1",
    conversationKey: "chat:1",
    taskFingerprint: "task:1",
    mandateVersion: "m1",
    mandateSha256: "sha",
    capture: { id: "capture-1", completeness: "COMPLETE", sourceChainHash: "chain" },
    sectionSummaries: [summary]
  });
  assert.deepEqual(memory.registers.verifiedFacts[0].sourceTurnIds, sections[0].turnIds);
  assert.deepEqual(memory.registers.verifiedFacts[0].sourceHashes, sections[0].sourceHashes);
  assert.equal(memory.ownerTruth, false);
});

test("v0.10 supersession keeps history instead of deleting it", async () => {
  const memory = await synthesizeSessionMemory({
    memoryId: "memory-1",
    conversationKey: "chat:1",
    taskFingerprint: "task:1",
    capture: { id: "capture-1", completeness: "COMPLETE", sourceChainHash: "chain" },
    sectionSummaries: [{
      narrative: "",
      sourceTurnIds: ["t1"],
      sourceHashes: ["h1"],
      registers: {
        userGoals: [{ id: "goal-1", text: "Old goal", state: MEMORY_ITEM_STATES.ACTIVE }],
        verifiedFacts: [], assistantClaims: [], inferences: [], decisions: [], constraints: [],
        preferences: [], openLoops: [], blockers: [], operatorActions: [],
        artifactsAndOwnerLocators: [], supersededItems: []
      }
    }]
  });
  const next = supersedeMemoryItem(memory, "userGoals", "goal-1", {
    id: "goal-2",
    text: "New goal",
    sourceTurnIds: ["t2"],
    sourceHashes: ["h2"]
  });
  assert.equal(next.registers.userGoals.find((item) => item.id === "goal-1").state, MEMORY_ITEM_STATES.SUPERSEDED);
  assert.equal(next.registers.userGoals.find((item) => item.id === "goal-2").supersedes, "goal-1");
});

test("v0.10 reboot stales live fields but preserves historical memory", async () => {
  const memory = await synthesizeSessionMemory({
    memoryId: "memory-1",
    conversationKey: "chat:1",
    taskFingerprint: "task:1",
    capture: { id: "capture-1", completeness: "COMPLETE", sourceChainHash: "chain" }
  });
  const stale = markLiveFieldsStale(memory, "REBOOT", ["runtime", "lease"]);
  assert.equal(stale.state, SESSION_MEMORY_STATES.STALE);
  assert.equal(stale.narrative, memory.narrative);
  assert.deepEqual(stale.liveState.staleFields, ["runtime", "lease"]);
});

test("v0.10 conversation/task mismatch stales whole memory and Nano gets bounded capsule", async () => {
  const memory = await synthesizeSessionMemory({
    memoryId: "memory-1",
    conversationKey: "chat:1",
    taskFingerprint: "task:1",
    capture: { id: "capture-1", completeness: "COMPLETE", sourceChainHash: "chain" },
    narrative: "n".repeat(20000)
  });
  const freshness = evaluateSessionMemoryFreshness(memory, {
    conversationKey: "chat:2",
    taskFingerprint: "task:2",
    sourceChainHash: "chain"
  });
  assert.equal(freshness.state, SESSION_MEMORY_STATES.STALE);
  const capsule = buildActiveMemoryCapsule(memory, { maxChars: 2000 });
  assert.ok(capsule.text.length <= 2000);
  assert.equal(capsule.truncated, true);
});
