import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { harness } from "./helpers/background-harness.mjs";
import { loadProcessForWindow, saveProcess } from "../lib/process-store.mjs";
import { sha256Hex } from "../lib/common.mjs";
import { ANALYSIS_SCHEMA } from "../lib/contracts.mjs";
import {
  addMissionWorkItem,
  createQueueContext,
  loadMissionWorkQueue,
  saveMissionWorkQueue
} from "../lib/mission-work-queue.mjs";
import { promptCausalMarker } from "../lib/turn-causality.mjs";
import {
  workerActionAvailability,
  workerActionConfirmText,
  workerActionMessage
} from "../lib/operations-view.mjs";

// Operator request 2026-09-28: "Gå till nästa uppgift i kön" and "Läs svar"
// so the operator can push a worker on when Greenfield does not see that the
// answer is delivered. Synthetic ids.
const U5 = "00000000-0000-4000-8000-0000000000e5";
const U6 = "00000000-0000-4000-8000-0000000000e6";
const A5 = "00000000-0000-4000-8000-0000000000f5";
const A6 = "00000000-0000-4000-8000-0000000000f6";
const ANSWER = JSON.stringify({ schema: "eic.a2a.response.v1", status: "CONTINUE", summary: "syntetiskt svar" });
const EXPORTS = ["operatorReadResponse", "operatorNextQueueItem", "activateQueueItem", "queueRuntimeSettings"];

function fakeClock() {
  const realNow = Date.now;
  let offset = 0;
  return { advance(ms) { offset += ms; Date.now = () => realNow() + offset; }, restore() { Date.now = realNow; } };
}

function mockAnalyzer(h) {
  h.chrome.offscreen = { createDocument: async () => {}, hasDocument: async () => true };
  h.chrome.runtime.sendMessage = async (message) => message?.type === "EIC_GF_ANALYZE_PIPELINE"
    ? {
        ok: true,
        nano: null,
        decision: {
          schema: ANALYSIS_SCHEMA, disposition: "CONTINUE", targetDisposition: "CONTINUE", objectiveStatus: "PENDING",
          nanoTaskAssessment: "NOT_REQUESTED", progressEvidence: "Bounded progress.", analysis: "Mocked controller verdict.",
          nextPrompt: "Continue with the next bounded owner-verified work package.", exactTarget: "Objective.",
          ownerEvidence: "Response.", reversibility: "YES", rollbackPath: "Owner state.", readbackPlan: "Readback.",
          materialAmbiguity: "NONE", humanAuthorityRequired: false, confidence: "HIGH"
        }
      }
    : { ok: true };
}

// A page the content script cannot prove the prompt on: ChatGPT's virtualized
// thread, seen by a bridge that finds no marker (e.g. the operator scrolled,
// or the text was changed). `showPrompt:false` = the prompt never appeared.
function unprovableThread(h, { showPrompt = true } = {}) {
  const thread = { submits: 0, answered: false };
  Object.assign(h.page, {
    userCount: 5, assistantCount: 5, lastUserId: U5, lastUserHash: "u5-collapsed", lastAssistantId: A5,
    assistantText: "svar tur 5", assistantHash: "a5-hash", generating: false
  });
  const send = h.chrome.tabs.sendMessage;
  h.chrome.tabs.sendMessage = async (id, msg) => {
    if (msg.type === "EIC_GF_SUBMIT_PROMPT") {
      thread.submits += 1;
      const permit = await h.mod.authorizeDispatch(msg, { id: h.chrome.runtime.id, tab: h.tab });
      if (!permit.ok) return { ok: false, effectPossible: false, code: permit.code, error: permit.code };
      if (showPrompt) Object.assign(h.page, { lastUserId: U6, lastUserHash: "u6-collapsed", generating: true });
      return { ok: true, effectPossible: true, dispatchId: msg.dispatchId, documentId: h.page.documentId, acknowledged: true,
        acknowledgementEvidence: "GENERATION_STARTED", method: "send-button", materializedReceipt: null };
    }
    if (msg.type === "EIC_GF_GET_PAGE_STATE") {
      const result = await send(id, msg);
      const byId = showPrompt && msg.expectedUserTurnId === U6;
      const auto = { expectedUserTurnId: msg.expectedUserTurnId || "", expectedUserIndex: msg.expectedUserIndex ?? null,
        expectedPromptMarker: msg.expectedPromptMarker || "", promptMarkerMatches: 0,
        resolvedUserTurnId: byId ? U6 : "", resolvedBy: byId ? "USER_TURN_ID" : "NONE",
        assistantFound: false, assistantId: "", assistantText: "", assistantTextLength: 0, assistantHash: "",
        assistantGenerating: false, assistantSignals: {} };
      if (byId && thread.answered) {
        Object.assign(auto, { assistantFound: true, assistantId: A6, assistantText: ANSWER, assistantTextLength: ANSWER.length,
          assistantHash: await sha256Hex(ANSWER), assistantOwnerKind: "SHELL_MESSAGE", assistantOwnerTrusted: true, assistantReplicaCount: 1 });
      }
      result.state.autonomousTurn = auto;
      return result;
    }
    return send(id, msg);
  };
  thread.answer = async () => {
    thread.answered = true;
    Object.assign(h.page, { generating: false, lastAssistantId: A6, assistantText: ANSWER, assistantHash: await sha256Hex(ANSWER) });
  };
  return thread;
}

async function stuckSending(h, clock) {
  await h.mod.startRun({ windowId: 1, goal: "Projekt: 2 - EIC backend - Gf: GF-900." });
  let p = await loadProcessForWindow(1);
  for (let i = 0; i < 12 && p.safety?.hold?.code !== "DISPATCH_EFFECT_UNRESOLVED"; i += 1) {
    await h.mod.tickSending(p);
    clock.advance(31_000);
    p = await loadProcessForWindow(1);
  }
  assert.equal(p.safety?.hold?.code, "DISPATCH_EFFECT_UNRESOLVED");
  return p;
}

async function tickUntil(h, clock, until, max = 12, step = 3_000) {
  let p = await loadProcessForWindow(1);
  for (let i = 0; i < max && p && !until(p); i += 1) {
    const tick = p.phase === "WAITING" ? h.mod.tickWaiting : p.phase === "ANALYZING" ? h.mod.tickAnalyzing : h.mod.tickSending;
    await tick(p);
    clock.advance(step);
    p = await loadProcessForWindow(1);
  }
  return p;
}

test("v1.8.11 Läs svar: binds ChatGPT's newest user turn when the prompt cannot be proven, then reads the answer; no resend", async () => {
  const h = await harness({ extraExports: EXPORTS });
  mockAnalyzer(h);
  const thread = unprovableThread(h);
  const clock = fakeClock();
  try {
    const stuck = await stuckSending(h, clock);
    await thread.answer();
    const result = await h.mod.operatorReadResponse({ windowId: 1, processId: stuck.processId });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.boundByOperator, true);
    assert.equal(result.phase, "WAITING");
    assert.match(result.outcome, /^(PROMPT_FOUND_READING|READING|RESPONSE_CAPTURED)$/);
    let p = await loadProcessForWindow(1);
    assert.equal(p.lastPrompt.dispatchedUserTurnId, U6);
    assert.equal(p.lastPrompt.dispatchedUserTurnBoundBy, "OPERATOR");
    assert.equal(p.lastPrompt.operatorOverride.action, "READ_RESPONSE");
    assert.equal(p.lastPrompt.operatorOverride.previousUserTurnId, "", "first turn: no earlier Greenfield turn");
    assert.equal(p.safety.hold, null);
    // In WAITING the button reads at once (capture still needs a stable answer).
    clock.advance(3_000);
    const again = await h.mod.operatorReadResponse({ windowId: 1, processId: stuck.processId });
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.equal(again.boundByOperator, false);
    assert.match(again.outcome, /^(READING|RESPONSE_CAPTURED)$/);
    p = await tickUntil(h, clock, (q) => q.phase !== "WAITING");
    assert.equal(p.phase, "ANALYZING");
    assert.equal(p.lastResponse.text, ANSWER);
    assert.equal(thread.submits, 1, "Läs svar never sends");
  } finally {
    clock.restore();
  }
});

test("v1.8.11 Läs svar: with no new user turn after the send nothing is bound and nothing is sent", async () => {
  const h = await harness({ extraExports: EXPORTS });
  const thread = unprovableThread(h, { showPrompt: false });
  const clock = fakeClock();
  try {
    const stuck = await stuckSending(h, clock);
    // The earlier Greenfield turn is the page's newest user turn.
    await saveProcess({ ...stuck, lastPrompt: { ...(stuck.lastPrompt || {}), dispatchedUserTurnId: U5 } });
    const result = await h.mod.operatorReadResponse({ windowId: 1, processId: stuck.processId });
    assert.equal(result.ok, false);
    assert.equal(result.code, "READ_RESPONSE_NO_NEW_USER_TURN");
    const p = await loadProcessForWindow(1);
    assert.equal(p.phase, "SENDING");
    assert.equal(p.pendingPrompt.dispatch.materializedUserTurnId, "");
    assert.equal(p.safety.hold.code, "DISPATCH_EFFECT_UNRESOLVED");
    assert.equal(thread.submits, 1);
  } finally {
    clock.restore();
  }
});

test("v1.8.11 Läs svar: refuses an unsent prompt, another hold and a changed process", async () => {
  const h = await harness({ extraExports: EXPORTS });
  const thread = unprovableThread(h);
  await h.mod.startRun({ windowId: 1, goal: "Projekt: 2 - EIC backend - Gf: GF-900." });
  const p = await loadProcessForWindow(1);
  assert.equal((await h.mod.operatorReadResponse({ windowId: 1, processId: p.processId })).code, "READ_RESPONSE_PROMPT_NOT_SENT");
  assert.equal((await h.mod.operatorReadResponse({ windowId: 1, processId: "process-other" })).code, "READ_RESPONSE_PROCESS_CHANGED");
  await saveProcess({ ...p, safety: { ...(p.safety || {}), hold: { code: "LOCAL_TOKENS24H_BUDGET", retryAtMs: Date.now() + 60_000, sinceMs: Date.now() } } });
  const held = await h.mod.operatorReadResponse({ windowId: 1, processId: p.processId });
  assert.equal(held.code, "READ_RESPONSE_SAFETY_HOLD");
  assert.equal(held.holdCode, "LOCAL_TOKENS24H_BUDGET");
  assert.equal(thread.submits, 0);
});

async function queuedProcess(h, slots) {
  await h.mod.startRun({ windowId: 1, goal: slots[0].goal });
  let p = await loadProcessForWindow(1);
  const storage = h.chrome.storage.local;
  for (const slot of slots) {
    await addMissionWorkItem(1, slot.goal, { storage, workerId: p.workerId, savedMissionId: slot.savedMissionId, priority: "NORMAL", maxInteractions: 5 });
  }
  let queue = await loadMissionWorkQueue(1, storage, { workerId: p.workerId });
  queue.items[0] = { ...queue.items[0], status: "ACTIVE" };
  queue.activeItemId = queue.items[0].itemId;
  queue.enabled = true;
  queue = await saveMissionWorkQueue(queue, storage);
  await saveProcess({ ...p, queueContext: createQueueContext(queue, queue.items[0], { interactionCount: 2 }) });
  return loadProcessForWindow(1);
}

const SLOTS = [
  { goal: "Projekt: 2 - EIC backend - Gf: GF-007.", savedMissionId: "gfw-007" },
  { goal: "Projekt: 78 - EIC Pulse - Gf: GF-052.", savedMissionId: "gfw-052" }
];

test("v1.8.11 Gå till nästa uppgift i kön: an unresolved send is parked with its checkpoint and the next slot starts", async () => {
  const h = await harness({ extraExports: EXPORTS });
  const thread = unprovableThread(h);
  const clock = fakeClock();
  try {
    await queuedProcess(h, SLOTS);
    const stuck = await stuckSending(h, clock);
    const promptHash = stuck.pendingPrompt.hash;
    const result = await h.mod.operatorNextQueueItem({ windowId: 1, processId: stuck.processId });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.outcome, "QUEUE_ADVANCED");
    assert.equal(result.sourceResponseState, "PROMPT_EFFECT_UNKNOWN");
    const next = await loadProcessForWindow(1);
    assert.notEqual(next.processId, stuck.processId);
    assert.equal(next.queueContext.savedMissionId, "gfw-052");
    assert.equal(next.phase, "ROTATING", "the next task starts in a fresh chat");
    const queue = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: stuck.workerId });
    const byMission = Object.fromEntries(queue.items.map((item) => [item.savedMissionId, item]));
    const parked = byMission["gfw-007"];
    assert.equal(byMission["gfw-052"].status, "ACTIVE");
    assert.equal(parked.status, "READY", "parked, not blocked and not retired");
    assert.equal(parked.lastOutcome, "OPERATOR_QUEUE_ADVANCE");
    assert.equal(parked.quantumProgress, 2, "the unanswered turn is not counted");
    assert.equal(parked.resume.previousDisposition, "OPERATOR_QUEUE_ADVANCE");
    assert.equal(parked.resume.sourceResponseState, "PROMPT_EFFECT_UNKNOWN");
    assert.equal(parked.processSnapshot.pendingPrompt, null);
    assert.equal(parked.processSnapshot.safety.hold, null, "the dispatch hold stays with the conversation left behind");
    assert.equal(queue.history.length, 0);
    assert.equal(thread.submits, 1, "nothing resent");

    // When the parked mission comes around it resumes in a fresh chat told
    // that its last prompt's effect is unknown.
    const settings = await h.mod.queueRuntimeSettings();
    const resumed = await h.mod.activateQueueItem({ queue, item: parked, settings, windowId: 1, priorProcess: next, auditSessionId: "" });
    const envelope = resumed.process.pendingPrompt.a2a;
    assert.equal(envelope.messageType, "SESSION_ROTATION");
    assert.equal(envelope.continuity.previousDisposition, "OPERATOR_QUEUE_ADVANCE");
    assert.equal(envelope.continuity.sessionRotation.sourceResponseState, "PROMPT_EFFECT_UNKNOWN");
    assert.equal(resumed.process.processId, stuck.processId, "the same logical process resumes");
    assert.notEqual(resumed.process.pendingPrompt.hash, promptHash, "a new prompt, never the old one again");
  } finally {
    clock.restore();
  }
});

test("v1.8.11 Gå till nästa uppgift i kön: an unanswered WAITING turn is parked as acknowledged-without-response", async () => {
  const h = await harness({ extraExports: EXPORTS });
  await queuedProcess(h, SLOTS);
  let p = await h.mod.tickSending(await loadProcessForWindow(1));
  p = await h.mod.tickSending(p);
  assert.equal(p.phase, "WAITING");
  const result = await h.mod.operatorNextQueueItem({ windowId: 1, processId: p.processId });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.sourceResponseState, "PROMPT_ACKNOWLEDGED_NO_COMPLETED_RESPONSE");
  const queue = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: p.workerId });
  const parked = queue.items.find((item) => item.savedMissionId === "gfw-007");
  assert.equal(parked.processSnapshot.lastPrompt.hash, p.lastPrompt.hash);
  assert.equal(h.sent.length, 1, "one prompt in total");
});

test("v1.8.11 Gå till nästa uppgift i kön: nothing changes without another runnable slot, outside a queue or mid-analysis", async () => {
  const h = await harness({ extraExports: EXPORTS });
  await queuedProcess(h, [SLOTS[0]]);
  let p = await h.mod.tickSending(await loadProcessForWindow(1));
  p = await h.mod.tickSending(p);
  const lonely = await h.mod.operatorNextQueueItem({ windowId: 1, processId: p.processId });
  assert.equal(lonely.ok, false);
  assert.equal(lonely.code, "QUEUE_NEXT_NONE_RUNNABLE");
  const after = await loadProcessForWindow(1);
  assert.equal(after.processId, p.processId);
  assert.equal(after.phase, "WAITING");

  await saveProcess({ ...after, phase: "ANALYZING" });
  assert.equal((await h.mod.operatorNextQueueItem({ windowId: 1, processId: p.processId })).code, "QUEUE_NEXT_BUSY");

  const plain = await harness({ extraExports: EXPORTS });
  await plain.mod.startRun({ windowId: 1, goal: "Projekt: 2 - EIC backend - Gf: GF-900." });
  const q = await loadProcessForWindow(1);
  assert.equal((await plain.mod.operatorNextQueueItem({ windowId: 1, processId: q.processId })).code, "QUEUE_NEXT_NOT_QUEUE_MANAGED");
});

test("v1.8.11 panel: the card offers the actions where they apply and says what happened", () => {
  assert.deepEqual(workerActionAvailability({ phase: "SENDING", pendingDispatch: { effectPossible: true }, queueContext: { itemId: "i" } }, { enabled: true, readyCount: 3 }),
    { readResponse: true, nextQueueItem: true, nextReady: true });
  assert.deepEqual(workerActionAvailability({ phase: "SENDING", pendingDispatch: null, queueContext: { itemId: "i" } }, { enabled: true, readyCount: 0 }),
    { readResponse: false, nextQueueItem: true, nextReady: false });
  assert.equal(workerActionAvailability({ phase: "WAITING" }, null).readResponse, true);
  assert.equal(workerActionAvailability({ phase: "ANALYZING", queueContext: { itemId: "i" } }, { enabled: true, readyCount: 2 }).nextQueueItem, false);
  assert.equal(workerActionAvailability({ phase: "QUEUE_WAIT" }, { enabled: true, readyCount: 1 }).nextQueueItem, true);
  assert.match(workerActionMessage("read-response", { ok: true, outcome: "PROMPT_FOUND_READING", boundByOperator: true }), /ditt beslut/);
  assert.match(workerActionMessage("read-response", { ok: false, code: "READ_RESPONSE_NO_NEW_USER_TURN" }), /Inget skickades om/);
  assert.match(workerActionMessage("next-queue-item", { ok: true, outcome: "QUEUE_ADVANCED" }), /checkpoint/);
  assert.match(workerActionMessage("next-queue-item", { ok: false, code: "QUEUE_NEXT_BUSY", phase: "ANALYZING" }), /ANALYZING/);
  assert.match(workerActionConfirmText("next-queue-item", { phase: "SENDING" }), /Läs svar först/);
  assert.equal(workerActionConfirmText("read-response", { phase: "WAITING" }), "", "reading a WAITING answer needs no confirmation");

  const panel = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  assert.match(panel, /type: action === "read-response" \? "EIC_GF_OPERATOR_READ_RESPONSE" : "EIC_GF_OPERATOR_NEXT_QUEUE_ITEM"/);
  assert.match(panel, />Läs svar<\/button>/);
  assert.match(panel, />Gå till nästa uppgift i kön<\/button>/);
  assert.match(panel, /processId\n\s*\}\);/, "the action names the process shown on the card");
  const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(background, /case "EIC_GF_OPERATOR_READ_RESPONSE":\s*return respond\(withVerifiedWorkerMessage/);
  assert.match(background, /case "EIC_GF_OPERATOR_NEXT_QUEUE_ITEM":\s*return respond\(withVerifiedWorkerMessage/);
  assert.equal(promptCausalMarker(""), "");
});

test("v1.8.11 Gå till nästa uppgift i kön: a pause the mission asked for still holds on its parked slot", async () => {
  const h = await harness({ extraExports: EXPORTS });
  await queuedProcess(h, SLOTS);
  const p = await loadProcessForWindow(1);
  const resumeAtMs = Date.now() + 45 * 60_000;
  await saveProcess({ ...p, phase: "PAUSED", pendingPrompt: null,
    missionPause: { pauseId: "pause-1", state: "ARMED", durationSeconds: 2700, reason: "EIC bad om paus", requestedAtMs: Date.now(), resumeAtMs } });
  const result = await h.mod.operatorNextQueueItem({ windowId: 1, processId: p.processId });
  assert.equal(result.ok, true, JSON.stringify(result));
  const queue = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: p.workerId });
  const parked = queue.items.find((item) => item.savedMissionId === "gfw-007");
  assert.equal(parked.status, "PAUSED");
  assert.equal(parked.pauseUntilMs, resumeAtMs);
  assert.equal((await loadProcessForWindow(1)).queueContext.savedMissionId, "gfw-052");
});
