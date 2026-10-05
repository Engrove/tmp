// v1.8.14: at a queue boundary the answer is not analysed. Operator request
// 2026-10-05: "Om en kvant är fullbordad som t.ex. 1/1 eller 15/15 ... så är
// det totalt onödigt att utföra analys av prompt och liknande ... om ändå
// nästa steg är nästa GFW på tur". End-to-end through the real background.js;
// only the offscreen analyzer boundary is mocked and counted. Synthetic data.
import test from "node:test";
import assert from "node:assert/strict";

import { harness } from "./helpers/background-harness.mjs";
import { loadProcessForWindow, saveProcess } from "../lib/process-store.mjs";
import {
  addMissionWorkItem,
  createQueueContext,
  loadMissionWorkQueue,
  saveMissionWorkQueue
} from "../lib/mission-work-queue.mjs";
import { sha256Hex } from "../lib/common.mjs";
import { writeNextInstruction } from "../lib/instruction-store.mjs";
import { conversationKey } from "../lib/restart-recovery.mjs";
import { ANALYSIS_SCHEMA } from "../lib/contracts.mjs";
import { readIncidentLog } from "../lib/incident-log.mjs";
import { queueBoundaryAnalysisDecision, runtimeControlRequestsCompletion } from "../lib/queue-boundary.mjs";

const NEXT_STEP = "Read the synthetic owner state and close one bounded work package.";

function hjalmar(disposition = "CONTINUE") {
  return {
    schema: ANALYSIS_SCHEMA, disposition, targetDisposition: "CONTINUE",
    objectiveStatus: disposition === "DONE" ? "SATISFIED" : "PENDING", nanoTaskAssessment: "NOT_REQUESTED",
    progressEvidence: "Bounded progress.", analysis: "Mocked Hjalmar verdict.",
    nextPrompt: ["CONTINUE", "READ_REQUIRED"].includes(disposition) ? "Hjalmar planned follow-up." : "",
    exactTarget: "Objective.", ownerEvidence: "Response.", reversibility: "YES", rollbackPath: "Owner state.",
    readbackPlan: "Readback.", materialAmbiguity: "NONE", humanAuthorityRequired: false, confidence: "HIGH"
  };
}

// Counts every message to the offscreen analyzer (Nano observer, Nano task,
// Hjalmar D2) and every offscreen document creation.
function countingAnalyzer(h, decision = hjalmar()) {
  const calls = { analyze: 0, nanoTask: 0, offscreen: 0 };
  h.chrome.offscreen = { createDocument: async () => { calls.offscreen += 1; }, hasDocument: async () => false };
  h.chrome.runtime.sendMessage = async (message) => {
    if (message?.type === "EIC_GF_ANALYZE_PIPELINE") {
      calls.analyze += 1;
      return { ok: true, decision, nano: null, nanoRawOutput: "", rawOutput: "" };
    }
    if (message?.type === "EIC_GF_RUN_NANO_TASK") {
      calls.nanoTask += 1;
      return { ok: false, code: "TEST_NANO_UNAVAILABLE", error: "TEST_NANO_UNAVAILABLE" };
    }
    return { ok: true };
  };
  return calls;
}

async function waitingProcess(h) {
  await h.mod.startRun({ windowId: 1, goal: "Projekt: 900 - Syntetiskt testprojekt - Gf: GF-900." });
  let p = await loadProcessForWindow(1);
  p = await h.mod.tickSending(p);
  p = await h.mod.tickSending(p);
  assert.equal(p.phase, "WAITING");
  return p;
}

async function seedQueue(h, p, quanta) {
  const storage = h.chrome.storage.local;
  for (const [index, maxInteractions] of quanta.entries()) {
    await addMissionWorkItem(1, `Projekt: 90${index} - Syntetiskt testprojekt - Gf: GF-90${index}.`, {
      storage, workerId: p.workerId, savedMissionId: `gfw-90${index}`, priority: "NORMAL", maxInteractions, now: 1000 + index
    });
  }
  let queue = await loadMissionWorkQueue(1, storage, { workerId: p.workerId });
  const active = queue.items[0];
  queue.items = queue.items.map((item) => item.itemId === active.itemId ? { ...item, status: "ACTIVE" } : item);
  queue.activeItemId = active.itemId;
  queue.enabled = true; // a running queue
  queue = await saveMissionWorkQueue(queue, storage);
  return { queue, active: queue.items[0] };
}

async function analyzing(h, p, { queue, queueItem, interactionCount = 0, text }) {
  h.page.generating = false;
  h.page.assistantCount = 1;
  h.page.lastAssistantId = "assistant-test-1";
  h.page.assistantText = text;
  h.page.assistantHash = await sha256Hex(text);
  await saveProcess({
    ...p,
    phase: "ANALYZING",
    queueContext: createQueueContext(queue, queueItem, { interactionCount }),
    lastResponse: {
      text, hash: await sha256Hex(text), messageId: "assistant-test-1",
      observation: { documentId: h.page.documentId, conversationKey: conversationKey(h.page.url), messageId: "assistant-test-1" }
    },
    updatedAt: new Date().toISOString()
  });
  return loadProcessForWindow(1);
}

const answer = (overrides = {}) => JSON.stringify({
  schema: "eic.a2a.response.v1", status: "CONTINUE", summary: "Synthetic bounded work.",
  workPerformed: ["Read owner state."], evidence: ["Owner readback."], blockers: [],
  nextSuggestedAction: NEXT_STEP, ...overrides
});

async function scenario({ quanta = [1, 1], interactionCount = 0, text = answer(), decision = hjalmar(), before = null } = {}) {
  const h = await harness();
  const calls = countingAnalyzer(h, decision);
  let p = await waitingProcess(h);
  const sentBefore = h.sent.length;
  const { queue, active } = await seedQueue(h, p, quanta);
  p = await analyzing(h, p, { queue, queueItem: active, interactionCount, text: typeof text === "function" ? text(p, queue, active) : text });
  if (before) await before(h, p);
  const after = await h.mod.tickAnalyzing(p);
  const parked = (await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: p.workerId })).items.find((item) => item.itemId === active.itemId);
  return { h, calls, first: p, after, parked, active, queue, sentBefore };
}

test("v1.8.14 reproduction: quantum 1/1 complete -> next GFW without Nano/Hjalmar", async () => {
  const { h, calls, first, after, parked, sentBefore } = await scenario();
  assert.equal(calls.analyze, 0, "no Nano/Hjalmar analysis at a quantum boundary");
  assert.equal(calls.offscreen, 0, "the analyzer document is not even started");
  assert.notEqual(after.processId, first.processId, "the next GFW in the queue took over");
  assert.equal(after.phase, "ROTATING");
  assert.equal(parked.lastOutcome, "QUANTUM_EXHAUSTED");
  assert.equal(parked.quantumProgress, 0);
  assert.match(parked.resume.objective, /Read the synthetic owner state/, "the slot resumes from the answer's own next step");
  assert.equal(parked.processSnapshot.lastDecision.source, "QUEUE_BOUNDARY_NO_ANALYSIS");
  assert.equal(parked.resume.analysisEvidence.hjalmar, null, "no Hjalmar verdict is claimed");
  assert.equal(parked.resume.analysisEvidence.protocol.disposition, "CONTINUE");
  assert.equal(h.sent.length, sentBefore, "no prompt is planned or sent for the finished slot");
  const rows = (await readIncidentLog(h.chrome.storage.local)).rows;
  assert.ok(rows.some((row) => row.kind === "ANALYSIS_SKIPPED_AT_QUEUE_BOUNDARY" && row.code === "QUANTUM_EXHAUSTED"));
});

test("v1.8.14: 15/15 complete is a boundary as well", async () => {
  const { calls, after, first, parked } = await scenario({ quanta: [15, 1], interactionCount: 14 });
  assert.equal(calls.analyze, 0);
  assert.notEqual(after.processId, first.processId);
  assert.equal(parked.lastOutcome, "QUANTUM_EXHAUSTED");
});

test("v1.8.14: the answer's own YIELD_TO_QUEUE before the quantum ends skips analysis and keeps quantum progress", async () => {
  const { calls, after, first, parked } = await scenario({ quanta: [5, 1], interactionCount: 1, text: answer({ sessionAction: "YIELD_TO_QUEUE", sessionReason: "Wait for owner." }) });
  assert.equal(calls.analyze, 0);
  assert.notEqual(after.processId, first.processId);
  assert.equal(parked.lastOutcome, "EIC_YIELD_TO_QUEUE");
  assert.equal(parked.quantumProgress, 2);
});

test("v1.8.14: CONTINUE / PAUSE_PROCESS 3600 s at 1/1 (the reported screen) parks with the pause, no analysis", async () => {
  const t0 = Date.now();
  const { calls, after, first, parked } = await scenario({ text: answer({ sessionAction: "PAUSE_PROCESS", pauseSeconds: 3600, sessionReason: "Owner job runs for an hour." }) });
  assert.equal(calls.analyze, 0);
  assert.notEqual(after.processId, first.processId);
  assert.equal(parked.lastOutcome, "EIC_PAUSE_PARKED");
  assert.equal(parked.status, "PAUSED");
  assert.ok(parked.pauseUntilMs >= t0 + 3600_000 && parked.pauseUntilMs <= Date.now() + 3600_000);
});

test("v1.8.14: inside the quantum (1/3, KEEP) the answer is analysed and the next prompt is planned as before", async () => {
  const { calls, after, first } = await scenario({ quanta: [3, 1], interactionCount: 0 });
  assert.equal(calls.analyze, 1);
  assert.equal(after.processId, first.processId);
  assert.equal(after.phase, "SENDING");
});

test("v1.8.14: no other runnable slot -> analysed (this slot continues and needs a planned prompt)", async () => {
  const { calls, after, first } = await scenario({ quanta: [1] });
  assert.equal(calls.analyze, 1);
  assert.equal(after.processId, first.processId);
});

test("v1.8.14: a NANO_TASK request at the boundary is still executed through the analysis path", async () => {
  const { calls, after, first } = await scenario({ text: answer({ nextSuggestedAction: `NANO_TASK: Summarize "alpha beta gamma" in one word.\n${NEXT_STEP}` }) });
  assert.equal(calls.nanoTask, 1, "the explicit Nano task is attempted");
  assert.equal(after.processId, first.processId, "not parked by the boundary shortcut");
});

test("v1.8.14: status DONE at the boundary is decided by the full path (the GFW is retired)", async () => {
  const { calls, parked, h } = await scenario({ text: answer({ status: "DONE", nextSuggestedAction: "" }), decision: hjalmar("DONE") });
  assert.equal(calls.analyze, 1);
  assert.equal(parked, undefined, "the finished GFW's slot is retired, not parked");
  const rows = (await readIncidentLog(h.chrome.storage.local)).rows;
  assert.equal(rows.some((row) => row.kind === "ANALYSIS_SKIPPED_AT_QUEUE_BOUNDARY"), false);
});

test("v1.8.14: a waiting operator instruction keeps the analysis", async () => {
  const { calls } = await scenario({
    before: async (_h, p) => { await writeNextInstruction(p, "Operatören: kontrollera ägarläget först."); }
  });
  assert.equal(calls.analyze, 1, "the operator's instruction is weighed by the analysis as before");
});

test("v1.8.14: a plain-text answer without A2A control is analysed", async () => {
  const { calls } = await scenario({ text: "Klart för den här omgången. Nästa steg är att läsa ägarläget." });
  assert.equal(calls.analyze, 1);
});

test("v1.8.14: runtime control in the boundary answer is still applied (SET_PRIORITY LOW), without analysis", async () => {
  const { calls, after, first, h, active } = await scenario({
    text: (p, queue, item) => answer({
      runtimeControl: {
        target: { runId: p.runId, turn: p.turn, queueId: queue.queueId, itemId: item.itemId, savedMissionId: "gfw-900" },
        actions: [{ op: "SET_PRIORITY", priority: "LOW" }]
      }
    })
  });
  assert.equal(calls.analyze, 0);
  assert.notEqual(after.processId, first.processId);
  const item = (await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: first.workerId })).items.find((row) => row.itemId === active.itemId);
  assert.equal(item.priority, "LOW");
  assert.deepEqual(item.processSnapshot.runtimeControl.lastReceipts.map((row) => [row.op, row.status]), [["SET_PRIORITY", "APPLIED"]]);
});

test("v1.8.14: the AI cannot raise priority above the operator's at the boundary either (rejected with a receipt)", async () => {
  const { calls, h, first, active } = await scenario({
    text: (p, queue, item) => answer({
      runtimeControl: {
        target: { runId: p.runId, turn: p.turn, queueId: queue.queueId, itemId: item.itemId, savedMissionId: "gfw-900" },
        actions: [{ op: "SET_PRIORITY", priority: "HIGH" }]
      }
    })
  });
  assert.equal(calls.analyze, 0);
  const item = (await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: first.workerId })).items.find((row) => row.itemId === active.itemId);
  assert.equal(item.priority, "NORMAL");
  assert.deepEqual(item.processSnapshot.runtimeControl.lastReceipts.map((row) => [row.op, row.status, row.reason]),
    [["SET_PRIORITY", "REJECTED", "PRIORITY_ABOVE_OPERATOR_CEILING"]]);
});

test("v1.8.14 policy: only a certain queue boundary with structured CONTINUE skips analysis", () => {
  const base = { queueManaged: true, controlValid: true, targetDisposition: "CONTINUE", sessionAction: "KEEP", interactionCount: 0, maxInteractions: 1 };
  assert.equal(queueBoundaryAnalysisDecision(base).action, "SKIP");
  assert.equal(queueBoundaryAnalysisDecision({ ...base, maxInteractions: 1000, interactionCount: 999 }).outcome, "QUANTUM_EXHAUSTED");
  assert.equal(queueBoundaryAnalysisDecision({ ...base, maxInteractions: 2 }).code, "NOT_A_QUEUE_BOUNDARY");
  assert.equal(queueBoundaryAnalysisDecision({ ...base, queueManaged: false }).code, "NOT_QUEUE_MANAGED");
  assert.equal(queueBoundaryAnalysisDecision({ ...base, controlValid: false }).code, "NO_STRUCTURED_CONTROL");
  assert.equal(queueBoundaryAnalysisDecision({ ...base, targetDisposition: "BLOCKED" }).code, "TARGET_STATUS_NOT_CONTINUE");
  assert.equal(queueBoundaryAnalysisDecision({ ...base, sessionAction: "STOP_PROCESS" }).code, "TERMINAL_REQUESTED");
  assert.equal(queueBoundaryAnalysisDecision({ ...base, completionRequested: true }).code, "TERMINAL_REQUESTED");
  assert.equal(queueBoundaryAnalysisDecision({ ...base, nanoTaskRequested: true }).code, "NANO_TASK_REQUESTED");
  assert.equal(queueBoundaryAnalysisDecision({ ...base, maxInteractions: 3, sessionAction: "BACKGROUND_SLEEP", pauseSeconds: 600 }).pauseSeconds, 600);
  assert.equal(queueBoundaryAnalysisDecision({ ...base, maxInteractions: 3, sessionAction: "ROTATE_SESSION_NOW" }).code, "NOT_A_QUEUE_BOUNDARY");
  assert.equal(runtimeControlRequestsCompletion({ actions: [{ op: "COMPLETE_MISSION" }] }), true);
  assert.equal(runtimeControlRequestsCompletion({ actions: [{ op: "SET_PRIORITY" }] }), false);
});

test("v1.8.14 E2E: the parked GFW comes back with a valid FULL resume prompt built from the answer's own next step", async () => {
  const h = await harness();
  const calls = countingAnalyzer(h);
  let p = await waitingProcess(h);
  const { queue, active } = await seedQueue(h, p, [1, 1]);
  p = await analyzing(h, p, { queue, queueItem: active, text: answer() });
  const second = await h.mod.tickAnalyzing(p);
  assert.notEqual(second.processId, p.processId);
  // The second GFW finishes its 1/1 quantum the same way; the first comes back.
  const queue2 = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: p.workerId });
  const secondItem = queue2.items.find((item) => item.itemId === second.queueContext.itemId);
  // As after a real dispatch of the second GFW: a verified model and turn.
  const secondAnalyzing = await analyzing(h, { ...second, safety: p.safety, lastPrompt: { ...(p.lastPrompt || {}), a2a: { objective: "Second GFW objective." } } },
    { queue: queue2, queueItem: secondItem, text: answer({ nextSuggestedAction: "Second GFW: verify the synthetic owner readback." }) });
  const back = await h.mod.tickAnalyzing(secondAnalyzing);
  assert.equal(back.queueContext.itemId, active.itemId, "the first GFW is active again");
  assert.equal(calls.analyze, 0);
  // The FULL resume prompt is built at activation and sent after the new chat opens.
  const { validateA2AEnvelope } = await import("../lib/a2a.mjs");
  const env = JSON.parse(back.pendingPrompt.text);
  assert.deepEqual(validateA2AEnvelope(env).errors || [], []);
  assert.equal(env.messageType, "SESSION_ROTATION", "a parked GFW resumes as a session rotation");
  assert.match(env.objective, /Read the synthetic owner state/);
  assert.equal(env.analysisEvidence.hjalmar, null);
  assert.equal(env.analysisEvidence.protocol.disposition, "CONTINUE");
});
