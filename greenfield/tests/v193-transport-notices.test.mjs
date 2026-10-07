// v1.9.3 ChatGPT transport notices (operator report 2026-10-07: "Våra system
// bearbetar den här begäran …" followed by "Anslutningen bröts. Väntar på
// hela svaret", and Greenfield in SENDING while the banner was shown).
// Content-script detection is verified in Chromium by
// tools/verify-transport-notices.mjs; these tests cover the background
// decisions through the real background.js with the Chrome harness.
import test from "node:test";
import assert from "node:assert/strict";

import { harness } from "./helpers/background-harness.mjs";
import { loadProcessForWindow } from "../lib/process-store.mjs";
import { sha256Hex } from "../lib/common.mjs";
import { ANALYSIS_SCHEMA } from "../lib/contracts.mjs";
import { readIncidentLog } from "../lib/incident-log.mjs";
import {
  evaluateWaitingRefresh,
  hasCurrentGenerationEvidence,
  providerTransportPending,
  staleTurnCapacityDecision
} from "../lib/waiting-refresh.mjs";
import { warmResumePageVerdict } from "../lib/warm-resume.mjs";
import { conversationKey } from "../lib/restart-recovery.mjs";

function mockAnalyzer(h) {
  h.chrome.offscreen = { createDocument: async () => {}, hasDocument: async () => true };
  h.chrome.runtime.sendMessage = async (message) => message?.type === "EIC_GF_ANALYZE_PIPELINE"
    ? {
        ok: true, nano: null,
        decision: {
          schema: ANALYSIS_SCHEMA, disposition: "CONTINUE", targetDisposition: "CONTINUE", objectiveStatus: "PENDING",
          nanoTaskAssessment: "NOT_REQUESTED", progressEvidence: "Bounded progress.", analysis: "Mocked verdict.",
          nextPrompt: "Continue with the next bounded slice.", exactTarget: "Objective.", ownerEvidence: "Response.",
          reversibility: "YES", rollbackPath: "Owner state.", readbackPlan: "Readback.", materialAmbiguity: "NONE",
          humanAuthorityRequired: false, confidence: "HIGH"
        }
      }
    : { ok: true };
}

function clock() {
  const realNow = Date.now;
  let offset = 0;
  return {
    advance(ms) { offset += ms; Date.now = () => realNow() + offset; },
    restore() { Date.now = realNow; }
  };
}

async function showAssistant(h, text) {
  const hash = await sha256Hex(text);
  Object.assign(h.page, {
    generating: false, assistantCount: 1, lastAssistantId: "assistant-1", assistantText: text, assistantHash: hash,
    autonomousTurn: {
      expectedUserTurnId: h.page.lastUserId, expectedUserIndex: h.page.userCount - 1, resolvedUserTurnId: h.page.lastUserId,
      resolvedBy: "USER_TURN_ID", userTextHash: h.page.lastUserHash, assistantFound: true, assistantId: "assistant-1",
      assistantOwnerKind: "EXPLICIT_TURN_SHELL", assistantOwnerTrusted: true, assistantReplicaCount: 1,
      assistantText: text, assistantTextLength: text.length, assistantHash: hash, assistantGenerating: false, assistantSignals: {}
    }
  });
}

const COMPLETE = JSON.stringify({
  schema: "eic.a2a.response.v1", status: "CONTINUE", summary: "Bounded slice done.", workPerformed: ["Work."],
  evidence: ["Owner readback."], blockers: [], nextSuggestedAction: "Run the next bounded slice."
});

async function waitingProcess() {
  const h = await harness();
  mockAnalyzer(h);
  h.reloads = [];
  h.chrome.tabs.reload = async (tabId, options) => { h.reloads.push({ tabId, options }); };
  await h.mod.startRun({ windowId: 1, goal: "Projekt: 900 - Syntetiskt - Gf: GF-901." });
  let p = await loadProcessForWindow(1);
  p = await h.mod.tickSending(p);
  p = await h.mod.tickSending(p);
  assert.equal(p.phase, "WAITING");
  return { h, p };
}

test("v1.9.3 pure: a provider notice is pending generation for the ladder, the slot hand-back and warm resume", () => {
  const page = { providerNotices: { processingNotice: true, connectionInterrupted: false }, generating: false, signals: {} };
  assert.equal(providerTransportPending(page), true);
  assert.equal(hasCurrentGenerationEvidence(page), true);
  assert.equal(hasCurrentGenerationEvidence({ generating: true, signals: { composerBusy: true } }), false, "composer busy alone still does not count");
  const sentAt = "2026-10-07T06:00:00.000Z";
  const at = (min) => Date.parse(sentAt) + min * 60_000;
  const ladder = (min, generating) => evaluateWaitingRefresh({
    now: at(min), staleSince: sentAt, waitingSince: sentAt, acknowledged: true, stage: "", generating
  });
  assert.equal(ladder(31, false).action, "F5", "control: without evidence the 30-min F5 fires");
  const deferred = ladder(31, hasCurrentGenerationEvidence(page));
  assert.equal(deferred.action, "WAIT", JSON.stringify(deferred));
  assert.equal(deferred.code, "WAITING_ACTIVE_GENERATION");
  assert.notEqual(ladder(4 * 60 + 1, true).code, "WAITING_ACTIVE_GENERATION", "the 4 h respite still ends");
  const capacity = staleTurnCapacityDecision({
    now: at(40), promptHash: "h", turn: 1, acknowledged: true,
    refreshState: { promptHash: "h", turn: 1, stage: "F5_30", requestedAt: new Date(at(31)).toISOString() },
    page: { ...page, pageHealth: { readyState: "complete" } }
  });
  assert.equal(capacity.code, "PROVIDER_NOTICE");
  const warm = { conversationKey: conversationKey("https://chatgpt.com/c/abc"), expectedLastUserTurnId: "u" };
  const verdict = warmResumePageVerdict({ warm, page: { url: "https://chatgpt.com/c/abc", userCount: 1, assistantCount: 1, lastUserId: "u", composerReady: true, composerEmpty: true, providerNotices: { connectionInterrupted: true } } });
  assert.equal(verdict.code, "CONVERSATION_PROVIDER_NOTICE");
});

test("v1.9.3 E2E: background processing defers the 30-min F5, blocks capture of a partial answer and is recorded as pressure", async () => {
  const t = clock();
  try {
    const { h, p: start } = await waitingProcess();
    let p = start;
    h.page.providerNotices = { processingNotice: true, connectionInterrupted: false };
    t.advance(31 * 60 * 1000);
    p = await h.mod.tickWaiting(p);
    t.advance(45_000);
    p = await h.mod.tickWaiting(p);
    assert.equal(h.reloads.length, 0, "no F5 while ChatGPT is still processing");
    assert.ok(p.sessionHealth.activeTurn.processingNotice, "the notice is on the active turn");
    let rows = (await readIncidentLog(h.chrome.storage.local)).rows.filter((row) => row.kind === "PROVIDER_TRANSPORT_NOTICE");
    assert.equal(rows.length, 1, "one incident per kind and turn");
    assert.equal(rows[0].code, "PROVIDER_PROCESSING");
    assert.equal(rows[0].detail.processingNotice, true);

    // The connection drops: a partial, non-A2A answer is visible.
    h.page.providerNotices = { processingNotice: false, connectionInterrupted: true };
    await showAssistant(h, "Delvis svar: steg 1 av 3 är klart och");
    for (let i = 0; i < 6; i += 1) { t.advance(4000); p = await h.mod.tickWaiting(p); }
    assert.equal(p.phase, "WAITING", "a partial answer under the banner is not captured");
    assert.equal(h.reloads.length, 0);
    rows = (await readIncidentLog(h.chrome.storage.local)).rows.filter((row) => row.kind === "PROVIDER_TRANSPORT_NOTICE");
    assert.deepEqual(rows.map((row) => row.code), ["PROVIDER_PROCESSING", "CONNECTION_INTERRUPTED"]);

    // The provider delivers the full answer and the banner goes away.
    h.page.providerNotices = { processingNotice: false, connectionInterrupted: false };
    await showAssistant(h, COMPLETE);
    for (let i = 0; i < 8 && p.phase === "WAITING"; i += 1) { t.advance(3000); p = await h.mod.tickWaiting(p); }
    assert.equal(p.phase, "ANALYZING");
    const sample = p.sessionHealth.samples.at(-1);
    assert.equal(sample.processingNotice, true);
    assert.equal(sample.connectionInterrupted, true);
    assert.ok(sample.processingNoticeMs >= 45_000);
    const metrics = (await readIncidentLog(h.chrome.storage.local)).rows.filter((row) => row.kind === "TURN_METRICS").at(-1);
    assert.equal(metrics.detail.processingNotice, true);
    assert.equal(metrics.detail.connectionInterrupted, true);
    assert.ok(metrics.detail.promptChars > 1000);
    assert.match(metrics.detail.signals, /PROVIDER_BACKGROUND_PROCESSING/);
    assert.match(metrics.detail.signals, /TRANSPORT_INTERRUPTED/);

    // The next prompt tells the EIC to shrink the slice.
    p = await h.mod.tickAnalyzing(p);
    assert.equal(p.phase, "SENDING");
    assert.equal(p.pendingPrompt.a2a.control.interactionSlicing.slicePressure.level, "SHRINK");
  } finally { t.restore(); }
});

test("v1.9.3 E2E: a complete A2A answer is captured even if a connection banner lingers", async () => {
  const t = clock();
  try {
    const { h, p: start } = await waitingProcess();
    let p = start;
    h.page.providerNotices = { processingNotice: false, connectionInterrupted: true };
    await showAssistant(h, COMPLETE);
    for (let i = 0; i < 8 && p.phase === "WAITING"; i += 1) { t.advance(3000); p = await h.mod.tickWaiting(p); }
    assert.equal(p.phase, "ANALYZING");
  } finally { t.restore(); }
});

test("v1.9.3 E2E: no prompt is posted while a provider notice is shown; the hold is bounded", async () => {
  const t = clock();
  try {
    const h = await harness();
    mockAnalyzer(h);
    await h.mod.startRun({ windowId: 1, goal: "Projekt: 900 - Syntetiskt - Gf: GF-901." });
    let p = await loadProcessForWindow(1);
    h.page.providerNotices = { processingNotice: false, connectionInterrupted: true };
    for (let i = 0; i < 4; i += 1) { t.advance(200_000); p = await h.mod.tickSending(p); }
    assert.equal(h.sent.length, 0, "nothing posted under the banner");
    assert.ok(p.pendingPrompt.providerNoticeHoldSinceMs > 0);
    const held = (await readIncidentLog(h.chrome.storage.local)).rows.filter((row) => row.kind === "PROMPT_DISPATCH_HELD_PROVIDER_NOTICE");
    assert.equal(held.length, 1);
    assert.equal(held[0].detail.connectionInterrupted, true);
    // The banner clears: the prompt goes out.
    h.page.providerNotices = { processingNotice: false, connectionInterrupted: false };
    for (let i = 0; i < 4 && h.sent.length === 0; i += 1) { t.advance(200_000); p = await h.mod.tickSending(p); }
    assert.equal(h.sent.length, 1);

    // A banner that never clears holds at most WAITING_GENERATION_LIMIT_MS.
    const h2 = await harness();
    mockAnalyzer(h2);
    await h2.mod.startRun({ windowId: 1, goal: "Projekt: 900 - Syntetiskt - Gf: GF-902." });
    let q = await loadProcessForWindow(1);
    h2.page.providerNotices = { processingNotice: true, connectionInterrupted: false };
    q = await h2.mod.tickSending(q);
    assert.equal(h2.sent.length, 0);
    t.advance(4 * 60 * 60 * 1000 + 1000);
    for (let i = 0; i < 4 && h2.sent.length === 0; i += 1) { t.advance(200_000); q = await h2.mod.tickSending(q); }
    assert.equal(h2.sent.length, 1, "released after the bounded hold");
  } finally { t.restore(); }
});
