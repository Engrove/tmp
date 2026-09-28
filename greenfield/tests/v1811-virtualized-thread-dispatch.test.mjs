import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { harness } from "./helpers/background-harness.mjs";
import { loadProcessForWindow } from "../lib/process-store.mjs";
import { sha256Hex } from "../lib/common.mjs";
import { ANALYSIS_SCHEMA } from "../lib/contracts.mjs";
import { reconcileDispatchObservation } from "../lib/dispatch-reconciliation.mjs";
import { sendFenceDecision } from "../lib/send-fence.mjs";
import {
  autonomousUserTurnProof,
  expectedAutonomousUserTurn,
  expectedPromptMarker,
  promptCausalMarker
} from "../lib/turn-causality.mjs";

// Operator report 2026-09-28 (v1.8.10): "Sessionen vet inte om att svaret
// redan är levererat". Diagnostics 11:22 (process at turn 6): SENDING, hold
// DISPATCH_EFFECT_UNRESOLVED / AUTONOMOUS_USER_TURN_NOT_RESOLVED since the
// send at 10:56; dispatch ACKNOWLEDGED by GENERATION_STARTED, baselineUserCount
// 5, no materialized user turn; turns 1-5 had been captured (STRICT). The same
// in two other conversations at 4 turns. ChatGPT had answered at 11:17.
// Cause (ChatGPT's production JS, manifests 4da31bb4 and 4ad86f39): the thread
// is virtualized (only turns near the viewport are in the DOM) and a long user
// message is collapsed with an extra "…" element, so the DOM user count stops
// at the window size, the ordinal points past the window and the user text
// never hashes to the prompt. The page views below are what content.js
// reports on tools/verify-virtualized-thread-dispatch.mjs's page (v1.8.10 vs
// v1.8.11). Synthetic ids.
const U5 = "00000000-0000-4000-8000-0000000000e5";
const U6 = "00000000-0000-4000-8000-0000000000e6";
const A5 = "00000000-0000-4000-8000-0000000000f5";
const A6 = "00000000-0000-4000-8000-0000000000f6";
const ANSWER = JSON.stringify({ schema: "eic.a2a.response.v1", status: "CONTINUE", summary: "syntetiskt svar tur 6" });

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

// ChatGPT's virtualized thread as content.js reports it. Five earlier turns
// fill the render window; after the send the oldest row is unmounted, so the
// DOM still holds five user messages and the newest one is the prompt. Its
// collapsed text never hashes to the prompt. `contentVersion` selects what the
// content script can resolve: "1.8.10" (count/ordinal/hash only) or "1.8.11"
// (also the prompt's A2A messageId).
function virtualizedThread(h, { contentVersion = "1.8.11", answer = ANSWER } = {}) {
  const thread = { contentVersion, submits: [], pageRequests: [], marker: "", sentPrompt: "", answered: false };
  Object.assign(h.page, {
    userCount: 5, assistantCount: 5, lastUserId: U5, lastUserHash: "u5-collapsed-text-hash",
    lastAssistantId: A5, assistantText: "svar tur 5", assistantHash: "a5-hash", generating: false
  });
  const markerAware = () => thread.contentVersion === "1.8.11";
  const autonomousView = async (msg) => {
    const expectedId = String(msg.expectedUserTurnId || "");
    const marker = markerAware() ? String(msg.expectedPromptMarker || "") : "";
    const sent = Boolean(thread.sentPrompt);
    let resolvedBy = "NONE";
    if (sent && expectedId === U6) resolvedBy = "USER_TURN_ID";
    else if (sent && !expectedId && marker && marker === thread.marker) resolvedBy = "PROMPT_MARKER";
    const view = {
      expectedUserTurnId: expectedId,
      expectedUserIndex: Number.isInteger(msg.expectedUserIndex) ? msg.expectedUserIndex : null,
      ...(markerAware() ? { expectedPromptMarker: marker, promptMarkerMatches: marker ? (marker === thread.marker && sent ? 1 : 0) : null } : {}),
      resolvedUserTurnId: resolvedBy === "NONE" ? "" : U6,
      resolvedBy,
      userTextHash: resolvedBy === "NONE" ? "" : "u6-collapsed-text-hash",
      assistantFound: false, assistantId: "", assistantText: "", assistantTextLength: 0, assistantHash: "",
      assistantGenerating: false, assistantSignals: {}, assistantOwnerKind: "NONE", assistantOwnerTrusted: false, assistantReplicaCount: 0
    };
    if (resolvedBy !== "NONE" && thread.answered) {
      Object.assign(view, {
        assistantFound: true, assistantId: A6, assistantText: answer, assistantTextLength: answer.length,
        assistantHash: await sha256Hex(answer), assistantOwnerKind: "SHELL_MESSAGE", assistantOwnerTrusted: true, assistantReplicaCount: 1
      });
    }
    return view;
  };
  const send = h.chrome.tabs.sendMessage;
  h.chrome.tabs.sendMessage = async (id, msg) => {
    if (msg.type === "EIC_GF_SUBMIT_PROMPT") {
      thread.submits.push({ promptMarker: msg.promptMarker || "" });
      const permit = await h.mod.authorizeDispatch(msg, { id: h.chrome.runtime.id, tab: h.tab });
      if (!permit.ok) return { ok: false, effectPossible: false, code: permit.code, error: permit.code };
      thread.sentPrompt = msg.prompt;
      thread.marker = promptCausalMarker(msg.prompt);
      Object.assign(h.page, { userCount: 5, lastUserId: U6, lastUserHash: "u6-collapsed-text-hash", generating: true });
      let materializedReceipt = null;
      if (markerAware() && msg.promptMarker && msg.promptMarker === thread.marker) {
        const receipt = { userTurnId: U6, userTurnIndex: 5, userCount: 5, userTextHash: "u6-collapsed-text-hash",
          resolvedBy: "PROMPT_MARKER", promptMarker: thread.marker };
        const reported = await h.mod.recordDispatchMaterialization({
          type: "EIC_GF_DISPATCH_MATERIALIZED", dispatchId: msg.dispatchId, promptHash: msg.promptHash,
          documentId: h.page.documentId, evidence: "GENERATION_STARTED", receipt
        }, { id: h.chrome.runtime.id, tab: h.tab });
        thread.receiptResult = reported;
        materializedReceipt = reported?.ok ? receipt : null;
      }
      return { ok: true, effectPossible: true, dispatchId: msg.dispatchId, documentId: h.page.documentId, acknowledged: true,
        acknowledgementEvidence: "GENERATION_STARTED", method: "send-button", materializedReceipt };
    }
    if (msg.type === "EIC_GF_GET_PAGE_STATE") {
      thread.pageRequests.push({ expectedUserTurnId: msg.expectedUserTurnId || "", expectedUserIndex: msg.expectedUserIndex ?? null,
        expectedPromptMarker: msg.expectedPromptMarker || "" });
      const result = await send(id, msg);
      result.state.autonomousTurn = await autonomousView(msg);
      return result;
    }
    return send(id, msg);
  };
  thread.answer = async () => {
    thread.answered = true;
    Object.assign(h.page, { generating: false, assistantCount: 5, lastAssistantId: A6, assistantText: answer,
      assistantHash: await sha256Hex(answer) });
  };
  return thread;
}

async function started(h) {
  await h.mod.startRun({ windowId: 1, goal: "Projekt: 2 - EIC backend - Gf: GF-900." });
  return loadProcessForWindow(1);
}

async function tickUntil(h, clock, until, max = 24, step = 31_000) {
  let p = await loadProcessForWindow(1);
  for (let i = 0; i < max && p && !until(p); i += 1) {
    const tick = p.phase === "WAITING" ? h.mod.tickWaiting : p.phase === "ANALYZING" ? h.mod.tickAnalyzing : h.mod.tickSending;
    await tick(p);
    clock.advance(step);
    p = await loadProcessForWindow(1);
  }
  return p;
}

test("v1.8.11: the prompt's A2A messageId is its marker", () => {
  const envelope = { schema: "eic.a2a.message.v1", protocol: "EIC-A2A/1", messageType: "CONTINUATION",
    messageId: "a2a-00000000-0000-4000-8000-0000000000a6", correlationId: "run-x", process: { turn: 6 } };
  assert.equal(promptCausalMarker(JSON.stringify(envelope)), "a2a-00000000-0000-4000-8000-0000000000a6");
  assert.equal(promptCausalMarker(`${JSON.stringify(envelope)} trailing`), "a2a-00000000-0000-4000-8000-0000000000a6",
    "non-JSON text: the first messageId is used");
  assert.equal(promptCausalMarker("Kör nästa paket."), "");
  assert.equal(promptCausalMarker(JSON.stringify({ ...envelope, messageId: "a2a-short" })), "", "only a2a-<uuid>");
  assert.equal(promptCausalMarker(""), "");
});

test("v1.8.11 repro: v1.8.10's view of the virtualized thread holds DISPATCH_EFFECT_UNRESOLVED with no resend", async () => {
  const h = await harness({ extraExports: ["recordDispatchMaterialization"] });
  const thread = virtualizedThread(h, { contentVersion: "1.8.10" });
  const clock = fakeClock();
  try {
    await started(h);
    let p = await tickUntil(h, clock, (q) => q.safety?.hold?.code === "DISPATCH_EFFECT_UNRESOLVED");
    await thread.answer();
    p = await tickUntil(h, clock, () => false, 6);
    assert.equal(p.phase, "SENDING", "never leaves SENDING although ChatGPT answered");
    assert.equal(p.safety.hold.code, "DISPATCH_EFFECT_UNRESOLVED");
    assert.equal(p.safety.hold.detail, "AUTONOMOUS_USER_TURN_NOT_RESOLVED");
    const dispatch = p.pendingPrompt.dispatch;
    assert.equal(dispatch.acknowledged, true);
    assert.equal(dispatch.acknowledgementEvidence, "GENERATION_STARTED");
    assert.equal(dispatch.baselineUserCount, 5);
    assert.equal(dispatch.materializedUserTurnId, "");
    assert.equal(thread.submits.length, 1, "exactly one send");
    // What v1.8.11 now sends along; the v1.8.10 content ignores it.
    assert.equal(dispatch.promptMarker, promptCausalMarker(p.pendingPrompt.text));
    assert.equal(dispatch.baselineLastUserId, U5);
    assert.ok(thread.pageRequests.some((r) => r.expectedPromptMarker === dispatch.promptMarker && r.expectedUserIndex === 5));
  } finally {
    clock.restore();
  }
});

test("v1.8.11: the stuck process resolves by the prompt marker once the new bridge is in, then captures the answer", async () => {
  const h = await harness({ extraExports: ["recordDispatchMaterialization"] });
  mockAnalyzer(h);
  const thread = virtualizedThread(h, { contentVersion: "1.8.10" });
  const clock = fakeClock();
  try {
    await started(h);
    await tickUntil(h, clock, (q) => q.safety?.hold?.code === "DISPATCH_EFFECT_UNRESOLVED");
    await thread.answer();
    // Update: "Läs in igen" re-injects the v1.8.11 bridge into the same page.
    thread.contentVersion = "1.8.11";
    let p = await tickUntil(h, clock, (q) => q.phase !== "SENDING");
    assert.equal(p.phase, "WAITING");
    assert.equal(p.lastPrompt.dispatchedUserTurnId, U6);
    assert.equal(p.lastPrompt.dispatchedUserTurnIndex, 5, "the baseline index, kept only as a logical label");
    assert.equal(p.safety.hold, null);
    p = await tickUntil(h, clock, (q) => q.phase !== "WAITING", 12, 3_000);
    assert.equal(p.phase, "ANALYZING");
    assert.equal(p.lastResponse.text, ANSWER);
    assert.equal(p.lastResponse.observation.pairedUserTurnId, U6);
    assert.equal(thread.submits.length, 1, "no resend at any point");
  } finally {
    clock.restore();
  }
});

test("v1.8.11: a fresh send is receipted by the prompt marker although the user count stays at 5", async () => {
  const h = await harness({ extraExports: ["recordDispatchMaterialization"] });
  const thread = virtualizedThread(h, { contentVersion: "1.8.11" });
  const clock = fakeClock();
  try {
    await started(h);
    const p = await tickUntil(h, clock, (q) => q.phase !== "SENDING");
    assert.equal(thread.receiptResult?.ok, true, JSON.stringify(thread.receiptResult));
    assert.equal(p.phase, "WAITING");
    assert.equal(p.lastPrompt.dispatchedUserTurnId, U6);
    assert.equal(p.lastPrompt.acknowledgementEvidence, "MATERIALIZED_USER_TURN_ID");
    assert.equal(thread.submits.length, 1);
    assert.equal(thread.submits[0].promptMarker, promptCausalMarker(p.lastPrompt.text), "the send carries the marker");
  } finally {
    clock.restore();
  }
});

test("v1.8.11: the receipt handler checks the marker and refuses the previous turn", async () => {
  const h = await harness({ extraExports: ["recordDispatchMaterialization"] });
  const thread = virtualizedThread(h, { contentVersion: "1.8.10" });
  const clock = fakeClock();
  try {
    await started(h);
    const p = await tickUntil(h, clock, (q) => q.safety?.hold?.code === "DISPATCH_EFFECT_UNRESOLVED");
    const dispatch = p.pendingPrompt.dispatch;
    const report = (receipt) => h.mod.recordDispatchMaterialization({
      type: "EIC_GF_DISPATCH_MATERIALIZED", dispatchId: dispatch.operationId, promptHash: p.pendingPrompt.hash,
      documentId: h.page.documentId, evidence: "GENERATION_STARTED", receipt
    }, { id: h.chrome.runtime.id, tab: h.tab });
    const base = { userTurnIndex: 5, userCount: 5, userTextHash: "x", resolvedBy: "PROMPT_MARKER" };
    assert.equal((await report({ ...base, userTurnId: U6, promptMarker: "a2a-00000000-0000-4000-8000-00000000dead" })).code,
      "DISPATCH_MATERIALIZATION_TARGET_MISMATCH", "another prompt's marker");
    assert.equal((await report({ ...base, userTurnId: U5, promptMarker: dispatch.promptMarker })).code,
      "DISPATCH_MATERIALIZATION_PRIOR_TURN", "the turn before the send");
    assert.equal((await report({ userTurnId: U6, userTurnIndex: 5, userCount: 5, userTextHash: "x" })).code,
      "DISPATCH_MATERIALIZATION_TARGET_MISMATCH", "without a marker the count proof is still required");
    const accepted = await report({ ...base, userTurnId: U6, promptMarker: dispatch.promptMarker });
    assert.equal(accepted.ok, true);
    const after = (await loadProcessForWindow(1)).pendingPrompt.dispatch;
    assert.equal(after.materializedUserTurnId, U6);
    assert.equal(after.materializedUserTurnIndex, 5);
    assert.equal(after.materializedBy, "PROMPT_MARKER");
    assert.equal(after.acknowledgementEvidence, "PROMPT_MARKER");
    assert.equal(thread.submits.length, 1);
  } finally {
    clock.restore();
  }
});

test("v1.8.11 reconciliation and fence: the marker proves the turn; another marker or none does not", () => {
  const text = JSON.stringify({ schema: "eic.a2a.message.v1", messageId: "a2a-00000000-0000-4000-8000-0000000000a6" });
  const marker = promptCausalMarker(text);
  const process = {
    phase: "SENDING",
    lastPrompt: { dispatchedUserTurnId: U5, dispatchedUserTurnIndex: 4, text: "{}" },
    pendingPrompt: {
      text, hash: "h".repeat(64),
      dispatch: { status: "ACKNOWLEDGED", effectPossible: true, acknowledged: true, acknowledgementEvidence: "GENERATION_STARTED",
        baselineUserCount: 5, materializedUserTurnId: "", materializedUserTurnIndex: null, promptMarker: marker }
    }
  };
  assert.deepEqual(expectedAutonomousUserTurn(process), { id: "", index: 5 });
  assert.equal(expectedPromptMarker(process), marker);
  const page = (auto) => ({ userCount: 5, lastUserId: U6, lastUserHash: "collapsed", autonomousTurn: auto });
  const v1810 = reconcileDispatchObservation(process, page({ expectedUserIndex: 5, resolvedUserTurnId: "", resolvedBy: "NONE" }));
  assert.equal(v1810.action, "HOLD_UNRESOLVED");
  const v1811 = reconcileDispatchObservation(process, page({ expectedUserIndex: 5, expectedPromptMarker: marker, resolvedUserTurnId: U6, resolvedBy: "PROMPT_MARKER" }));
  assert.equal(v1811.action, "ADVANCE_TO_WAITING");
  assert.equal(v1811.turnProof.code, "AUTONOMOUS_USER_TURN_MARKER_MATCH");
  assert.equal(v1811.resolvedUserTurnId, U6);
  assert.equal(v1811.resolvedUserTurnIndex, 5);
  const otherMarker = autonomousUserTurnProof(process, page({ expectedPromptMarker: "a2a-00000000-0000-4000-8000-00000000dead", resolvedUserTurnId: U6, resolvedBy: "PROMPT_MARKER" }));
  assert.equal(otherMarker.ok, false, "a resolution for another marker proves nothing");
  // Before any dispatch: the marker already in the thread means the prompt is
  // there (e.g. a send whose effect was reported impossible) - never send it again.
  const undispatched = { text, hash: "h".repeat(64), dispatch: null };
  assert.deepEqual(sendFenceDecision(undispatched, page({ expectedPromptMarker: marker, resolvedUserTurnId: U6, resolvedBy: "PROMPT_MARKER" })),
    { action: "ALREADY_MATERIALIZED", evidence: "PAGE_PROMPT_MARKER", acknowledged: true });
  assert.equal(sendFenceDecision(undispatched, page({ expectedPromptMarker: marker, resolvedUserTurnId: "", resolvedBy: "NONE" })).action,
    "READY_TO_DISPATCH");
  const noEffect = { ...undispatched, dispatch: { effectPossible: false, status: "NO_EFFECT_CONFIRMED" } };
  assert.equal(sendFenceDecision(noEffect, page({ expectedPromptMarker: marker, resolvedUserTurnId: U6, resolvedBy: "PROMPT_MARKER" })).action,
    "WAIT_NO_RESEND", "a 'no effect' send that did land is reconciled, not retried");
});

test("v1.8.11: an answer without JSON is captured like any other (completion does not depend on the protocol)", async () => {
  const plain = "Klart. Jag uppdaterade dokumentationen och körde testerna.\n\nStatus: CONTINUE";
  const h = await harness({ extraExports: ["recordDispatchMaterialization"] });
  mockAnalyzer(h);
  const thread = virtualizedThread(h, { contentVersion: "1.8.11", answer: plain });
  const clock = fakeClock();
  try {
    await started(h);
    let p = await tickUntil(h, clock, (q) => q.phase !== "SENDING");
    assert.equal(p.phase, "WAITING");
    await thread.answer();
    p = await tickUntil(h, clock, (q) => q.phase !== "WAITING", 12, 3_000);
    assert.equal(p.phase, "ANALYZING");
    assert.equal(p.lastResponse.text, plain);
    assert.equal(p.lastResponse.contract.found, false, "no A2A JSON in the answer");
    assert.equal(p.lastResponse.contract.requiredForContinuation, false);
  } finally {
    clock.restore();
  }
});

test("v1.8.11 content resolves the prompt's user turn by its marker in ChatGPT's virtualized thread", () => {
  const content = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
  assert.match(content, /function resolveAutonomousTurn\(entries, expectedUserTurnId = "", expectedUserIndex = null, expectedPromptMarker = ""\)/);
  assert.match(content, /messageText\(entry\)\.includes\(marker\)/);
  assert.match(content, /resolvedBy = "PROMPT_MARKER"/);
  assert.match(content, /!\(marker && virtualizedThread\)/, "no ordinal guess in the app shell when a marker is given");
  assert.match(content, /resolvedBy: "PROMPT_MARKER",\s*promptMarker: marker/, "the receipt names the marker");
  assert.match(content, /expectedPromptMarker: message\.expectedPromptMarker \|\| ""/);
  assert.match(content, /submitPrompt\(prompt, promptHash, message\.dispatchId, message\.safetyContext, message\.promptMarker \|\| ""\)/);
  const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(background, /promptMarker: pending\.dispatch\?\.promptMarker \|\| promptCausalMarker\(pending\.text\)/);
  assert.equal((background.match(/expectedPromptMarker: (expectedPromptMarker\(process\)|promptMarker)/g) || []).length, 3,
    "every expected-turn page-state request carries the marker");
});
