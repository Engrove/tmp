import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { harness } from "./helpers/background-harness.mjs";
import { loadProcessForWindow } from "../lib/process-store.mjs";
import { reconcileDispatchObservation } from "../lib/dispatch-reconciliation.mjs";

// Operator report 2026-09-26 (v1.8.9): "Greenfield förstår inte ännu att en
// prompt verkligen har skickats". Diagnostics 09:38/09:40: SENDING, dispatch
// EFFECT_POSSIBLE, acknowledged false, no acknowledgement evidence, no
// materialized user turn, baselineUserCount 0; hold DISPATCH_EFFECT_UNRESOLVED
// / AUTONOMOUS_USER_TURN_NOT_RESOLVED re-checked every 30 s while ChatGPT
// showed the prompt and a finished answer. Cause: ChatGPT's app shell renders
// no data-message-author-role, so content.js counted 0 user turns. Page states
// below are what content.js reports on tools/verify-new-shell-dispatch.mjs's
// page (v1.8.9 vs v1.8.10). Synthetic ids.
const USER_ID = "00000000-0000-4000-8000-0000000000e1";

function fakeClock() {
  const realNow = Date.now;
  let offset = 0;
  return { advance(ms) { offset += ms; Date.now = () => realNow() + offset; }, restore() { Date.now = realNow; } };
}

// What v1.8.9's content.js returned for the send (diagnostics: 15 s, no evidence).
const V189_SEND_RESULT = (msg, documentId) => ({
  ok: true, effectPossible: true, dispatchId: msg.dispatchId, documentId, acknowledged: false,
  acknowledgementEvidence: "", method: "send-button", materializedReceipt: null
});

async function stuckInSending() {
  const h = await harness();
  const send = h.chrome.tabs.sendMessage;
  const submits = [];
  h.chrome.tabs.sendMessage = async (id, msg) => {
    if (msg.type !== "EIC_GF_SUBMIT_PROMPT") return send(id, msg);
    submits.push(msg);
    const permit = await h.mod.authorizeDispatch(msg, { id: h.chrome.runtime.id, tab: h.tab });
    if (!permit.ok) return { ok: false, effectPossible: false, code: permit.code, error: permit.code };
    // ChatGPT answered, but v1.8.9 saw neither the turn nor "Stoppa": the page
    // state stays at userCount 0, not generating.
    return V189_SEND_RESULT(msg, h.page.documentId);
  };
  await h.mod.startRun({ windowId: 1, goal: "Projekt: 71 - Greenfield Works - Gf: GF-900." });
  return { h, submits };
}

async function tickUntil(h, clock, until, max = 20) {
  let p = await loadProcessForWindow(1);
  for (let i = 0; i < max && p && !until(p); i += 1) {
    p = await h.mod.tickSending(p) || await loadProcessForWindow(1);
    clock.advance(31_000);
    p = await loadProcessForWindow(1);
  }
  return p;
}

test("v1.8.10 repro: v1.8.9's page view after a real send holds DISPATCH_EFFECT_UNRESOLVED with no resend", async () => {
  const { h, submits } = await stuckInSending();
  const clock = fakeClock();
  try {
    const p = await tickUntil(h, clock, (q) => q.safety?.hold?.code === "DISPATCH_EFFECT_UNRESOLVED");
    assert.equal(p.phase, "SENDING");
    assert.equal(p.safety.hold.code, "DISPATCH_EFFECT_UNRESOLVED");
    assert.equal(p.safety.hold.detail, "AUTONOMOUS_USER_TURN_NOT_RESOLVED");
    assert.equal(p.pendingPrompt.dispatch.status, "EFFECT_POSSIBLE");
    assert.equal(p.pendingPrompt.dispatch.acknowledged, false);
    assert.equal(p.pendingPrompt.dispatch.baselineUserCount, 0);
    for (let i = 0; i < 4; i += 1) { await h.mod.tickSending(await loadProcessForWindow(1)); clock.advance(31_000); }
    assert.equal(submits.length, 1, "exactly one send, never a blind resend");
    assert.equal((await loadProcessForWindow(1)).phase, "SENDING", "v1.8.9 view never resolves");
  } finally {
    clock.restore();
  }
});

test("v1.8.10: the stuck process resolves itself once content sees the app-shell user message (ordinal 0 + id), no resend", async () => {
  const { h, submits } = await stuckInSending();
  const clock = fakeClock();
  try {
    await tickUntil(h, clock, (q) => q.safety?.hold?.code === "DISPATCH_EFFECT_UNRESOLVED");
    // After the update the bridge is re-injected (version mismatch) and the
    // same page reads as below (v1.8.10 content.js on the app-shell page).
    const promptHash = (await loadProcessForWindow(1)).pendingPrompt.hash;
    Object.assign(h.page, {
      userCount: 1, assistantCount: 1, lastUserId: USER_ID, lastUserHash: promptHash,
      lastAssistantId: "00000000-0000-4000-8000-0000000000e2", generating: false,
      autonomousTurn: { expectedUserTurnId: "", expectedUserIndex: 0, resolvedUserTurnId: USER_ID, resolvedBy: "USER_ORDINAL", userTextHash: promptHash }
    });
    const p = await tickUntil(h, clock, (q) => q.phase !== "SENDING");
    assert.equal(p.phase, "WAITING");
    assert.equal(p.lastPrompt.dispatchedUserTurnId, USER_ID);
    assert.equal(p.lastPrompt.dispatchedUserTurnIndex, 0);
    assert.equal(submits.length, 1, "no second send");
  } finally {
    clock.restore();
  }
});

test("v1.8.10 reconciliation: the diagnostics' dispatch record, v1.8.9 view vs v1.8.10 view of the same page", () => {
  const process = {
    phase: "SENDING",
    pendingPrompt: {
      text: "prompt", hash: "h".repeat(64),
      dispatch: { status: "EFFECT_POSSIBLE", effectPossible: true, acknowledged: false, acknowledgementEvidence: "",
        baselineUserCount: 0, baselineAssistantCount: 0, baselineAssistantHash: "", materializedUserTurnId: "", materializedUserTurnIndex: null,
        method: "send-button", operationId: "send-test", startedAt: "2026-09-26T09:30:27.973Z" }
    }
  };
  const v189 = reconcileDispatchObservation(process, { userCount: 0, lastUserId: "", lastUserHash: "", autonomousTurn: { expectedUserIndex: 0, resolvedUserTurnId: "", resolvedBy: "NONE" } });
  assert.equal(v189.action, "HOLD_UNRESOLVED");
  assert.equal(v189.turnProof.code, "AUTONOMOUS_USER_TURN_NOT_RESOLVED");
  const v1810 = reconcileDispatchObservation(process, { userCount: 1, lastUserId: USER_ID, lastUserHash: "x", autonomousTurn: { expectedUserIndex: 0, resolvedUserTurnId: USER_ID, resolvedBy: "USER_ORDINAL" } });
  assert.equal(v1810.action, "ADVANCE_TO_WAITING");
  assert.equal(v1810.resolvedUserTurnId, USER_ID);
  assert.equal(v1810.resolvedUserTurnIndex, 0);
});

test("v1.8.10 content reads ChatGPT's app-shell thread (build read 2026-09-26)", () => {
  const content = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
  assert.match(content, /const SHELL_USER_MESSAGE_SELECTOR = "\[class~='group\/user-message'\]";/);
  assert.match(content, /\$\{SHELL_USER_MESSAGE_SELECTOR\}, \[data-chatgpt-search-message-ids\]/);
  assert.match(content, /\[data-conversation-role='assistant'\]/);
  assert.match(content, /form\[data-chatgpt-composer\] button\[aria-label='Stoppa'\]/);
  assert.match(content, /form\[data-chatgpt-composer\] button\[aria-label='Stop'\]/);
  const turnSelector = content.match(/const MESSAGE_TURN_SELECTOR = `([^`]*)`/)?.[1] || "";
  assert.match(turnSelector, /\$\{SHELL_MESSAGE_SELECTOR\}/, "text inside app-shell messages never counts as the Daybreak notice");
  assert.doesNotMatch(turnSelector, /data-content-search-turn-key/, "the notice sits in the turn row; the row itself must stay searchable");
  assert.match(content, /materializedUserTurnReceipt\(before, state\)\) \{/, "acknowledgement waits for a receiptable user turn");
});
