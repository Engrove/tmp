import test from "node:test";
import assert from "node:assert/strict";

import { harness } from "./helpers/background-harness.mjs";
import { loadProcessForWindow, saveProcess } from "../lib/process-store.mjs";
import { sha256Hex } from "../lib/common.mjs";
import { ANALYSIS_SCHEMA } from "../lib/contracts.mjs";
import { conversationKey } from "../lib/restart-recovery.mjs";

// v1.7.8 regression for the live v1.7.7 session: a 33.7-minute EIC turn made
// Greenfield run its own stale-ladder F5 (tabs.reload of the same /c/ chat) at
// 30 minutes. The reload changed the content documentId, v1.7.7 treated that as
// a session boundary and turn 2 went out FULL (DOCUMENT_OR_CONVERSATION_CHANGED).
// The EIC context is the ChatGPT conversation, so a same-conversation reload
// must keep COMPACT continuity.

function mockAnalyzer(h) {
  h.chrome.offscreen = { createDocument: async () => {}, hasDocument: async () => true };
  h.chrome.runtime.sendMessage = async (message) => message?.type === "EIC_GF_ANALYZE_PIPELINE"
    ? {
        ok: true,
        nano: null,
        decision: {
          schema: ANALYSIS_SCHEMA,
          disposition: "CONTINUE",
          targetDisposition: "CONTINUE",
          objectiveStatus: "PENDING",
          nanoTaskAssessment: "NOT_REQUESTED",
          progressEvidence: "Bounded progress.",
          analysis: "Mocked controller verdict.",
          nextPrompt: "Continue with the next bounded owner-verified work package.",
          exactTarget: "Objective.",
          ownerEvidence: "Response.",
          reversibility: "YES",
          rollbackPath: "Owner state.",
          readbackPlan: "Readback.",
          materialAmbiguity: "NONE",
          humanAuthorityRequired: false,
          confidence: "HIGH"
        }
      }
    : { ok: true };
}

// A monotonic test clock. The usage governor paces posts (default minGapSeconds
// 180) and the stale ladder acts at 30 minutes, so every step moves time forward.
function clock() {
  const realNow = Date.now;
  let offset = 0;
  return {
    advance(ms) {
      offset += ms;
      Date.now = () => realNow() + offset;
    },
    restore() {
      Date.now = realNow;
    }
  };
}

function responseText(turn) {
  return JSON.stringify({
    schema: "eic.a2a.response.v1",
    status: "CONTINUE",
    summary: `Turn ${turn} completed a bounded package.`,
    workPerformed: [`Work of turn ${turn}.`],
    evidence: [`Evidence of turn ${turn}.`],
    blockers: [],
    nextSuggestedAction: "Continue with the next bounded owner-verified work package."
  });
}

async function showCompletedResponse(h, turn) {
  const text = responseText(turn);
  const hash = await sha256Hex(text);
  const assistantId = `assistant-${turn}`;
  Object.assign(h.page, {
    generating: false,
    assistantCount: turn,
    lastAssistantId: assistantId,
    assistantText: text,
    assistantHash: hash,
    autonomousTurn: {
      expectedUserTurnId: h.page.lastUserId,
      expectedUserIndex: h.page.userCount - 1,
      resolvedUserTurnId: h.page.lastUserId,
      resolvedBy: "USER_TURN_ID",
      userTextHash: h.page.lastUserHash,
      assistantFound: true,
      assistantId,
      assistantOwnerKind: "EXPLICIT_TURN_SHELL",
      assistantOwnerTrusted: true,
      assistantReplicaCount: 1,
      assistantText: text,
      assistantTextLength: text.length,
      assistantHash: hash,
      assistantGenerating: false,
      assistantSignals: {}
    }
  });
  return { text, hash };
}

async function sendPosted(h, start, t, expectedSent) {
  // The static harness page does not recompute the content script's
  // autonomous-turn view for a new user turn; start each post from the same
  // empty view the first prompt uses.
  h.page.autonomousTurn = {};
  let p = start;
  for (let i = 0; i < 6 && h.sent.length < expectedSent; i += 1) {
    t.advance(200_000);
    p = await h.mod.tickSending(p);
  }
  assert.equal(h.sent.length, expectedSent);
  for (let i = 0; i < 4 && p.phase === "SENDING"; i += 1) {
    t.advance(200_000);
    p = await h.mod.tickSending(p);
  }
  assert.equal(h.sent.length, expectedSent, "acknowledgement never re-posts");
  return p;
}

test("v1.7.8 live regression: Greenfield's own 30-minute stale-ladder F5 keeps turn 2 COMPACT (real capture path)", async () => {
  const h = await harness();
  mockAnalyzer(h);
  const reloads = [];
  h.chrome.tabs.reload = async (tabId, options) => {
    reloads.push({ tabId, options });
    h.page.documentId = `document-after-reload-${reloads.length}`;
  };
  const t = clock();
  try {
    await h.mod.startRun({ windowId: 1, goal: "Projekt: 2 - EIC backend - Gf: GF-007." });
    let p = await loadProcessForWindow(1);
    p = await h.mod.tickSending(p);
    p = await h.mod.tickSending(p);
    assert.equal(p.phase, "WAITING");
    assert.equal(p.lastPrompt.promptProfile.profile, "FULL");
    const firstDocument = h.page.documentId;

    t.advance(31 * 60 * 1000);
    p = await h.mod.tickWaiting(p);
    assert.equal(p.waitingRefresh.stage, "F5_30");
    assert.equal(p.sessionHealth.recoveryChurn, 1, "matches the live transcript");
    assert.equal(reloads.length, 1);
    assert.notEqual(h.page.documentId, firstDocument);

    await showCompletedResponse(h, 1);
    for (let i = 0; i < 8 && p.phase === "WAITING"; i += 1) {
      t.advance(3000);
      p = await h.mod.tickWaiting(p);
    }
    assert.equal(p.phase, "ANALYZING");
    assert.equal(p.lastResponse.observation.documentId, h.page.documentId);
    assert.equal(p.lastResponse.observation.conversationKey, "https://chatgpt.com/c/abc-123");

    p = await h.mod.tickAnalyzing(p);
    assert.equal(p.phase, "SENDING");
    assert.equal(p.pendingPrompt.promptProfile.profile, "COMPACT");
    assert.equal(p.pendingPrompt.promptProfile.reason, "SAME_CONVERSATION_FOLLOW_UP");
    assert.equal(p.pendingPrompt.promptProfile.ordinal, 2);
    p = await sendPosted(h, p, t, 2);
    const posted = JSON.parse(h.sent[1].prompt);
    assert.equal(posted.promptProfile.profile, "COMPACT");
    assert.ok(h.sent[1].prompt.length < h.sent[0].prompt.length / 2);
  } finally {
    t.restore();
  }
});

test("v1.7.8 twelve real turns in one conversation: FULL exactly at 1 and 11 despite a Greenfield F5 and a manual reload", async () => {
  const h = await harness();
  mockAnalyzer(h);
  h.chrome.tabs.reload = async () => {
    h.page.documentId = `document-${crypto.randomUUID()}`;
  };
  const t = clock();
  const profiles = [];
  try {
    await h.mod.startRun({ windowId: 1, goal: "Mission with many interactions." });
    let p = await loadProcessForWindow(1);
    p = await sendPosted(h, p, t, 1);
    profiles.push(JSON.parse(h.sent[0].prompt).promptProfile.profile);
    for (let turn = 1; turn <= 11; turn += 1) {
      assert.equal(p.phase, "WAITING", `turn ${turn}`);
      if (turn === 3) {
        t.advance(31 * 60 * 1000);
        p = await h.mod.tickWaiting(p);
        assert.equal(p.waitingRefresh.stage, "F5_30");
      }
      if (turn === 6) h.page.documentId = "document-after-manual-f5";
      const { text, hash } = await showCompletedResponse(h, turn);
      // Response capture is exercised for real in the regression above; here the
      // captured response is committed directly to keep the long loop bounded.
      await saveProcess({
        ...(await loadProcessForWindow(1)),
        phase: "ANALYZING",
        lastResponse: {
          text,
          hash,
          messageId: `assistant-${turn}`,
          observation: {
            documentId: h.page.documentId,
            conversationKey: conversationKey(h.page.url),
            messageId: `assistant-${turn}`
          }
        }
      });
      p = await h.mod.tickAnalyzing(await loadProcessForWindow(1));
      assert.equal(p.phase, "SENDING", `turn ${turn}`);
      p = await sendPosted(h, p, t, turn + 1);
      profiles.push(JSON.parse(h.sent[turn].prompt).promptProfile.profile);
    }
  } finally {
    t.restore();
  }
  assert.deepEqual(profiles, [
    "FULL", "COMPACT", "COMPACT", "COMPACT", "COMPACT", "COMPACT",
    "COMPACT", "COMPACT", "COMPACT", "COMPACT", "FULL", "COMPACT"
  ]);
});
