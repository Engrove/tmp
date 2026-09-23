import test from "node:test";
import assert from "node:assert/strict";

import { harness } from "./helpers/background-harness.mjs";
import { loadProcessForWindow, saveProcess } from "../lib/process-store.mjs";
import {
  addMissionWorkItem,
  createQueueContext,
  loadMissionWorkQueue,
  saveMissionWorkQueue,
  updateMissionWorkItem
} from "../lib/mission-work-queue.mjs";
import { sha256Hex } from "../lib/common.mjs";
import { writeNextInstruction } from "../lib/instruction-store.mjs";
import { conversationKey } from "../lib/restart-recovery.mjs";
import { ANALYSIS_SCHEMA } from "../lib/contracts.mjs";

// End-to-end through the real background.js analysis path. Only the offscreen
// LanguageModel boundary is mocked; it returns a valid Hjalmar CONTINUE
// decision to reproduce the v1.7.6 failure where the local controller verdict
// silently overrode an explicit EIC terminal control.

function hjalmar(disposition = "CONTINUE", nextPrompt = "Continue with the next bounded owner-verified work package.") {
  return {
    schema: ANALYSIS_SCHEMA,
    disposition,
    targetDisposition: "CONTINUE",
    objectiveStatus: disposition === "DONE" ? "SATISFIED" : "PENDING",
    nanoTaskAssessment: "NOT_REQUESTED",
    progressEvidence: "The captured response reports bounded progress.",
    analysis: "Mocked Hjalmar D2 controller verdict for the test.",
    nextPrompt: ["CONTINUE", "READ_REQUIRED"].includes(disposition) ? nextPrompt : "",
    exactTarget: "Current mission objective.",
    ownerEvidence: "Captured EIC response.",
    reversibility: "YES",
    rollbackPath: "Resume from the durable owner state.",
    readbackPlan: "Read owner state on the next turn.",
    materialAmbiguity: "NONE",
    humanAuthorityRequired: false,
    confidence: "HIGH"
  };
}

function mockAnalyzer(h, decision) {
  h.chrome.offscreen = { createDocument: async () => {}, hasDocument: async () => true };
  h.chrome.runtime.sendMessage = async (message) => {
    if (message?.type === "EIC_GF_ANALYZE_PIPELINE") {
      return { ok: true, decision, nano: null, nanoRawOutput: "", rawOutput: "" };
    }
    return { ok: true };
  };
}

async function waitingProcess(h, goal = "Mission A: reconstruct the bounded historical model.") {
  await h.mod.startRun({ windowId: 1, goal });
  let p = await loadProcessForWindow(1);
  p = await h.mod.tickSending(p);
  p = await h.mod.tickSending(p);
  assert.equal(p.phase, "WAITING");
  return p;
}

// The usage governor enforces a local pacing gap (>= 10 s) between posts. The
// follow-up send is exercised with the clock advanced past that gap.
async function sendUntilPosted(h, process, expectedSent, maxTicks = 6) {
  const realNow = Date.now;
  const offset = 15 * 60 * 1000;
  Date.now = () => realNow() + offset;
  try {
    let p = process;
    for (let i = 0; i < maxTicks && h.sent.length < expectedSent; i += 1) p = await h.mod.tickSending(p);
    return p;
  } finally {
    Date.now = realNow;
  }
}

async function seedQueue(h, p) {
  const storage = h.chrome.storage.local;
  const workerId = p.workerId;
  await addMissionWorkItem(1, "Mission A", { storage, workerId, savedMissionId: "gfw-a", priority: "HIGH", maxInteractions: 5, now: 1000 });
  await addMissionWorkItem(1, "Mission B", { storage, workerId, savedMissionId: "gfw-b", priority: "NORMAL", maxInteractions: 3, now: 2000 });
  await addMissionWorkItem(1, "Mission A", { storage, workerId, savedMissionId: "gfw-a", priority: "NORMAL", maxInteractions: 2, now: 3000 });
  await addMissionWorkItem(1, "Unsaved C", { storage, workerId, savedMissionId: "", priority: "NORMAL", maxInteractions: 4, now: 4000 });
  let queue = await loadMissionWorkQueue(1, storage, { workerId });
  const active = queue.items[0];
  queue.items = queue.items.map((item) => item.itemId === active.itemId ? { ...item, status: "ACTIVE" } : item);
  queue.activeItemId = active.itemId;
  queue = await saveMissionWorkQueue(queue, storage);
  return { queue, active: queue.items[0], workerId };
}

async function analyzing(h, p, { responseJson, queueItem = null, queue = null }) {
  const text = JSON.stringify(responseJson);
  // The page shows the completed assistant turn that is being analyzed.
  h.page.generating = false;
  h.page.assistantCount = Math.max(1, Number(h.page.assistantCount || 0));
  h.page.lastAssistantId = "assistant-test-1";
  h.page.assistantText = text;
  h.page.assistantHash = await sha256Hex(text);
  const next = {
    ...p,
    phase: "ANALYZING",
    queueContext: queueItem ? createQueueContext(queue, queueItem, { interactionCount: 0 }) : p.queueContext,
    lastResponse: {
      text,
      hash: await sha256Hex(text),
      messageId: "assistant-test-1",
      observation: { documentId: h.page.documentId, conversationKey: conversationKey(h.page.url), messageId: "assistant-test-1" }
    },
    updatedAt: new Date().toISOString()
  };
  await saveProcess(next);
  return loadProcessForWindow(1);
}

function baseResponse(overrides = {}) {
  return {
    schema: "eic.a2a.response.v1",
    status: "CONTINUE",
    summary: "Bounded work was performed.",
    workPerformed: ["Read owner state."],
    evidence: ["Owner readback."],
    blockers: [],
    nextSuggestedAction: "Continue with the next bounded owner-verified work package.",
    ...overrides
  };
}

test("v1.7.7 E2E: live failure case DONE+STOP_PROCESS retires the logical GFW although Hjalmar says CONTINUE", async () => {
  const h = await harness();
  mockAnalyzer(h, hjalmar("CONTINUE"));
  let p = await waitingProcess(h);
  const { queue, active } = await seedQueue(h, p);
  p = await analyzing(h, p, {
    queue,
    queueItem: active,
    responseJson: baseResponse({
      status: "DONE",
      sessionAction: "STOP_PROCESS",
      sessionReason: "Fresh owner reconciliation proves this logical mission is already terminal.",
      nextSuggestedAction: "Do not run GF-049 again. Retire this logical saved mission and its duplicate queue slots."
    })
  });
  const done = await h.mod.tickAnalyzing(p);
  assert.equal(done.phase, "DONE");
  assert.equal(done.greenfieldControl.reason, "EIC_EXPLICIT_STOP_PROCESS");
  assert.equal(done.lastDecision.disposition, "DONE");
  assert.equal(done.runtimeControl.lastReceipts[0].op, "COMPLETE_MISSION");
  assert.equal(done.runtimeControl.lastReceipts[0].status, "APPLIED");
  assert.equal(done.runtimeControl.lastReceipts[0].source, "LEGACY_STOP_PROCESS");

  const after = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: p.workerId });
  assert.deepEqual(after.items.map((item) => item.savedMissionId).sort(), ["", "gfw-b"]);
  const retired = after.history.filter((item) => item.savedMissionId === "gfw-a");
  assert.equal(retired.length, 2);
  assert.ok(retired.every((item) => item.status === "DONE"));
  assert.equal(after.activeItemId, "");
});

test("v1.7.7 E2E: structured COMPLETE_MISSION with the exact target retires only its logical mission", async () => {
  const h = await harness();
  mockAnalyzer(h, hjalmar("CONTINUE"));
  let p = await waitingProcess(h);
  const { queue, active } = await seedQueue(h, p);
  p = await analyzing(h, p, {
    queue,
    queueItem: active,
    responseJson: baseResponse({
      status: "DONE",
      nextSuggestedAction: "",
      runtimeControl: {
        target: { runId: p.runId, turn: p.turn, queueId: queue.queueId, itemId: active.itemId, savedMissionId: "gfw-a" },
        actions: [{ op: "COMPLETE_MISSION", reason: "All declared acceptance dimensions are closed." }]
      }
    })
  });
  const done = await h.mod.tickAnalyzing(p);
  assert.equal(done.phase, "DONE");
  assert.equal(done.greenfieldControl.reason, "EIC_RUNTIME_CONTROL_COMPLETE_MISSION");
  const after = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: p.workerId });
  assert.equal(after.items.some((item) => item.savedMissionId === "gfw-a"), false);
  assert.equal(after.items.some((item) => item.savedMissionId === "gfw-b"), true);
  assert.equal(after.items.some((item) => item.label === "Unsaved C"), true);
});

test("v1.7.7 E2E: DONE with a mismatching runtimeControl target fails closed to BLOCKED and retires nothing", async () => {
  const h = await harness();
  mockAnalyzer(h, hjalmar("CONTINUE"));
  let p = await waitingProcess(h);
  const { queue, active } = await seedQueue(h, p);
  const other = queue.items.find((item) => item.savedMissionId === "gfw-b");
  p = await analyzing(h, p, {
    queue,
    queueItem: active,
    responseJson: baseResponse({
      status: "DONE",
      runtimeControl: {
        target: { runId: p.runId, turn: p.turn, queueId: queue.queueId, itemId: other.itemId, savedMissionId: "gfw-b" },
        actions: [{ op: "COMPLETE_MISSION" }]
      }
    })
  });
  const blocked = await h.mod.tickAnalyzing(p);
  assert.equal(blocked.phase, "BLOCKED");
  assert.equal(blocked.lastError.code, "RUNTIME_CONTROL_TERMINAL_REJECTED");
  assert.equal(blocked.runtimeControl.lastReceipts.some((row) => row.status === "STALE" && row.reason === "WRONG_QUEUE_ITEM"), true);
  const after = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: p.workerId });
  assert.equal(after.history.length, 0);
  assert.equal(after.items.filter((item) => item.savedMissionId === "gfw-a").length, 2);
  assert.equal(after.items.find((item) => item.savedMissionId === "gfw-b").status, "READY");
});

test("v1.7.7 E2E: SET_PRIORITY and SET_QUANTUM mutate only the target slot and the next prompt carries receipts", async () => {
  const h = await harness();
  mockAnalyzer(h, hjalmar("CONTINUE"));
  let p = await waitingProcess(h);
  const { queue, active } = await seedQueue(h, p);
  p = await analyzing(h, p, {
    queue,
    queueItem: active,
    responseJson: baseResponse({
      runtimeControl: {
        target: { runId: p.runId, turn: p.turn, queueId: queue.queueId, itemId: active.itemId, savedMissionId: "gfw-a" },
        actions: [
          { op: "SET_PRIORITY", priority: "LOW" },
          { op: "SET_QUANTUM", maxInteractions: 8 }
        ]
      }
    })
  });
  const next = await h.mod.tickAnalyzing(p);
  assert.equal(next.phase, "SENDING");
  assert.equal(next.schedulerPriority, "LOW");
  assert.equal(next.queueContext.priority, "LOW");
  assert.equal(next.queueContext.maxInteractions, 5, "current quantum is immutable until its boundary");
  assert.equal(next.queueContext.pendingMaxInteractions, 8);
  const after = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: p.workerId });
  const slot = after.items.find((item) => item.itemId === active.itemId);
  assert.equal(slot.priority, "LOW");
  assert.equal(slot.operatorPriority, "HIGH", "AI never moves the operator ceiling");
  assert.equal(slot.maxInteractions, 8);
  const duplicate = after.items.find((item) => item.savedMissionId === "gfw-a" && item.itemId !== active.itemId);
  assert.equal(duplicate.priority, "NORMAL", "duplicate slot keeps independent priority");
  assert.equal(duplicate.maxInteractions, 2, "duplicate slot keeps independent quantum");
  const envelope = JSON.parse(next.pendingPrompt.text);
  const receipts = envelope.control.runtimeControl.lastReceipts;
  assert.deepEqual(receipts.map((row) => [row.op, row.status]), [["SET_PRIORITY", "APPLIED"], ["SET_QUANTUM", "APPLIED"]]);
  assert.equal(envelope.control.runtimeControl.current.priority, "LOW");
  assert.equal(envelope.control.runtimeControl.current.priorityCeiling, "HIGH");
  assert.equal(envelope.control.runtimeControl.current.nextQuantumMaxInteractions, 8);
  assert.equal(envelope.control.runtimeControl.target.turn, next.turn);
});

test("v1.7.7 E2E: an operator edit after the prompt wins over the AI priority request", async () => {
  const h = await harness();
  mockAnalyzer(h, hjalmar("CONTINUE"));
  let p = await waitingProcess(h);
  const { queue, active } = await seedQueue(h, p);
  const issuedAtMs = Date.parse(p.lastPrompt.a2a.issuedAt);
  await updateMissionWorkItem(1, active.itemId, { priority: "URGENT", maxInteractions: 5 }, h.chrome.storage.local, {
    workerId: p.workerId,
    now: issuedAtMs + 1
  });
  const edited = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: p.workerId });
  p = await analyzing(h, p, {
    queue: edited,
    queueItem: edited.items.find((item) => item.itemId === active.itemId),
    responseJson: baseResponse({
      runtimeControl: {
        target: { runId: p.runId, turn: p.turn, queueId: queue.queueId, itemId: active.itemId, savedMissionId: "gfw-a" },
        actions: [{ op: "SET_PRIORITY", priority: "LOW" }]
      }
    })
  });
  const next = await h.mod.tickAnalyzing(p);
  const after = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: p.workerId });
  assert.equal(after.items.find((item) => item.itemId === active.itemId).priority, "URGENT");
  assert.equal(next.runtimeControl.lastReceipts[0].status, "REJECTED");
  assert.equal(next.runtimeControl.lastReceipts[0].reason, "OPERATOR_PRECEDENCE");
});

test("v1.7.7 E2E: a normal v1.7.6 CONTINUE response is a runtime-control no-op and the follow-up prompt is COMPACT", async () => {
  const h = await harness();
  mockAnalyzer(h, hjalmar("CONTINUE"));
  let p = await waitingProcess(h);
  assert.equal(p.lastPrompt.promptProfile.profile, "FULL");
  p = await analyzing(h, p, { responseJson: baseResponse() });
  const next = await h.mod.tickAnalyzing(p);
  assert.equal(next.phase, "SENDING");
  assert.equal(next.runtimeControl ?? null, null, "no receipts/state for a no-control response");
  assert.equal(next.pendingPrompt.promptProfile.profile, "COMPACT");
  assert.equal(next.pendingPrompt.promptProfile.ordinal, 2);
  assert.ok(next.pendingPrompt.fullFallback?.text.length > next.pendingPrompt.text.length);
  const compact = JSON.parse(next.pendingPrompt.text);
  assert.equal(compact.promptProfile.profile, "COMPACT");
  assert.match(compact.mission, /^UNCHANGED:/);
  assert.equal(compact.responseContract.ownerStateRule.length > 100, true);
  const sent = await sendUntilPosted(h, next, 2);
  assert.equal(h.sent.length, 2);
  assert.equal(JSON.parse(h.sent[1].prompt).promptProfile.profile, "COMPACT");
  assert.equal(sent.pendingPrompt.hash, next.pendingPrompt.hash);
});

test("v1.7.8 E2E: a reload of the same conversation before dispatch keeps the COMPACT follow-up", async () => {
  const h = await harness();
  mockAnalyzer(h, hjalmar("CONTINUE"));
  let p = await waitingProcess(h);
  p = await analyzing(h, p, { responseJson: baseResponse() });
  let next = await h.mod.tickAnalyzing(p);
  assert.equal(next.pendingPrompt.promptProfile.profile, "COMPACT");
  const compactHash = next.pendingPrompt.hash;
  h.page.documentId = "document-after-manual-f5";
  next = await sendUntilPosted(h, next, 2);
  assert.equal(h.sent.length, 2);
  assert.equal(JSON.parse(h.sent[1].prompt).promptProfile.profile, "COMPACT");
  assert.equal(next.pendingPrompt.hash, compactHash);
});

test("v1.7.7 E2E: a conversation change before dispatch upgrades a COMPACT follow-up to the FULL prompt", async () => {
  const h = await harness();
  mockAnalyzer(h, hjalmar("CONTINUE"));
  let p = await waitingProcess(h);
  p = await analyzing(h, p, { responseJson: baseResponse() });
  let next = await h.mod.tickAnalyzing(p);
  assert.equal(next.pendingPrompt.promptProfile.profile, "COMPACT");
  const fullHash = next.pendingPrompt.fullFallback.hash;
  const otherConversation = "https://chatgpt.com/g/g-test-eic/c/other-456";
  h.page.url = otherConversation;
  h.tab.url = otherConversation;
  next = await h.mod.tickSending(next);
  assert.equal(h.sent.length, 1, "no compact prompt is posted into another conversation");
  assert.equal(next.pendingPrompt.promptProfile.profile, "FULL");
  assert.equal(next.pendingPrompt.promptProfile.reason, "CONVERSATION_CHANGED_BEFORE_DISPATCH");
  assert.equal(next.pendingPrompt.hash, fullHash);
  next = await sendUntilPosted(h, next, 2);
  assert.equal(h.sent.length, 2);
  const posted = JSON.parse(h.sent[1].prompt);
  assert.equal(posted.promptProfile.profile, "FULL");
  assert.equal(posted.mission, "Mission A: reconstruct the bounded historical model.");
  assert.ok(posted.responseContract.runtimeControlContract);
});

test("v1.7.7 E2E: a pending operator instruction outranks an AI terminal control and the receipt says so", async () => {
  const h = await harness();
  mockAnalyzer(h, hjalmar("CONTINUE"));
  let p = await waitingProcess(h);
  const { queue, active } = await seedQueue(h, p);
  p = await analyzing(h, p, {
    queue,
    queueItem: active,
    responseJson: baseResponse({ status: "DONE", sessionAction: "STOP_PROCESS", nextSuggestedAction: "" })
  });
  await writeNextInstruction(p, "Operator: do not close this mission yet; verify the acceptance fixture first.");
  const recovering = await h.mod.tickAnalyzing(p);
  assert.equal(recovering.phase, "RECOVERING");
  assert.equal(recovering.lastError.code, "HJALMAR_D2_DONE_WITH_PENDING_OPERATOR_INSTRUCTION");
  const terminalReceipt = recovering.runtimeControl.lastReceipts.find((row) => row.op === "COMPLETE_MISSION");
  assert.equal(terminalReceipt.status, "REJECTED");
  assert.equal(terminalReceipt.reason, "OPERATOR_INSTRUCTION_PENDING");
  const after = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: p.workerId });
  assert.equal(after.history.length, 0, "no slot is retired while the operator instruction is pending");
  assert.equal(after.items.filter((item) => item.savedMissionId === "gfw-a").length, 2);
});

test("v1.7.7 E2E: a DONE process whose queue retirement did not persist is self-healed before any queue selection", async () => {
  const h = await harness({ extraExports: ["wakeMissionQueue"] });
  mockAnalyzer(h, hjalmar("CONTINUE"));
  let p = await waitingProcess(h);
  const { queue, active } = await seedQueue(h, p);
  // Simulate the failure window: the DONE commit persisted, the queue write did not.
  await saveProcess({
    ...p,
    phase: "DONE",
    queueContext: createQueueContext(queue, active, { interactionCount: 1 }),
    greenfieldControl: { reason: "EIC_EXPLICIT_STOP_PROCESS" },
    updatedAt: new Date().toISOString()
  });
  await h.mod.wakeMissionQueue(1, "TEST_WAKE");
  const healed = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: p.workerId });
  assert.equal(healed.items.some((item) => item.savedMissionId === "gfw-a"), false);
  assert.deepEqual(healed.history.map((item) => item.savedMissionId), ["gfw-a", "gfw-a"]);
  assert.equal(healed.items.length, 2);

  // A second wake is a no-op (idempotent), and a non-ACTIVE slot is never touched.
  await h.mod.wakeMissionQueue(1, "TEST_WAKE_AGAIN");
  const again = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: p.workerId });
  assert.equal(again.history.length, 2);
  const other = again.items.find((item) => item.savedMissionId === "gfw-b");
  await saveProcess({
    ...p,
    phase: "DONE",
    queueContext: createQueueContext(again, other, { interactionCount: 0 }),
    updatedAt: new Date().toISOString()
  });
  await h.mod.wakeMissionQueue(1, "TEST_WAKE_READY_SLOT");
  const untouched = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: p.workerId });
  assert.equal(untouched.items.find((item) => item.itemId === other.itemId).status, "READY");
  assert.equal(untouched.history.length, 2);
});
