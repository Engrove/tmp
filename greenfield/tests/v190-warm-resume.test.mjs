// v1.9.0 warm queue resume: a parked GFW returns to its own conversation and
// continues there (COMPACT when the v1.7.7 profile rules allow), instead of a
// fresh chat with a FULL prompt. End-to-end through the real background.js
// with the Chrome harness; synthetic ids and texts only.
import test from "node:test";
import assert from "node:assert/strict";

import { harness } from "./helpers/background-harness.mjs";
import { loadProcessForWindow, saveProcess } from "../lib/process-store.mjs";
import { addMissionWorkItem, loadMissionWorkQueue } from "../lib/mission-work-queue.mjs";
import { ensureWorkerBinding } from "../lib/worker-identity.mjs";
import { sha256Hex } from "../lib/common.mjs";
import { conversationKey } from "../lib/restart-recovery.mjs";
import { OPERATOR_SETTINGS_KEY, normalizeOperatorSettings } from "../lib/operator-settings.mjs";
import { readIncidentLog } from "../lib/incident-log.mjs";
import {
  WARM_RESUME_MAX_CHAT_PROMPTS,
  warmResumeDecision,
  warmResumeObjective,
  warmResumePageVerdict
} from "../lib/warm-resume.mjs";

const ROOT = "https://chatgpt.com/g/g-test-eic";
const CONV_A = `${ROOT}/c/00000000-0000-4000-8000-00000000000a`;
const CONV_B = `${ROOT}/c/00000000-0000-4000-8000-00000000000b`;

function clock() {
  const RealDate = globalThis.Date;
  let now = RealDate.now();
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  return { advance(ms) { now += ms; }, restore() { globalThis.Date = RealDate; } };
}

const answer = (overrides = {}) => JSON.stringify({
  schema: "eic.a2a.response.v1", status: "CONTINUE", summary: "Synthetic bounded work.",
  workPerformed: ["Read owner state."], evidence: ["Owner readback."], blockers: [],
  nextSuggestedAction: "Verify the synthetic owner readback and close the next bounded package.", ...overrides
});

// The tab follows navigation; the page shows whatever conversation the test sets.
function followNavigation(h) {
  const update = h.chrome.tabs.update;
  h.navigations = [];
  h.redirects = {};
  h.chrome.tabs.update = async (id, patch) => {
    if (patch?.url) {
      h.navigations.push(patch.url);
      const landed = h.redirects[patch.url] || patch.url;
      h.page.url = landed;
      return update(id, { ...patch, url: landed });
    }
    return update(id, patch);
  };
  h.chrome.tabs.reload = async () => {};
}

function showConversation(h, url, { userId = "", userCount = 1, assistantCount = 1 } = {}) {
  Object.assign(h.page, {
    url, userCount, assistantCount, lastUserId: userId, generating: false,
    composerReady: true, composerEmpty: true, signals: {}
  });
  h.tab.url = url;
}

function showFreshChat(h) {
  Object.assign(h.page, { url: ROOT, userCount: 0, assistantCount: 0, lastUserId: "", generating: false, composerReady: true, composerEmpty: true });
  h.tab.url = ROOT;
}

async function tickUntil(h, t, predicate, max = 80) {
  let p = await loadProcessForWindow(1);
  for (let i = 0; i < max && !predicate(p); i += 1) {
    const tick = p.phase === "ROTATING" ? h.mod.tickRotating : p.phase === "SENDING" ? h.mod.tickSending : null;
    if (!tick) break;
    await tick(p);
    t.advance(4000);
    p = await loadProcessForWindow(1);
  }
  return p;
}

// Parks the active slot with a captured CONTINUE answer in `conversation`
// (v1.8.14 queue boundary, quantum 1/1) and returns the activated next slot.
async function answerAndPark(h, p, conversation, text = answer()) {
  const hash = await sha256Hex(text);
  await saveProcess({
    ...p,
    phase: "ANALYZING",
    lastManagedUrl: conversation,
    lastResponse: {
      text, hash, messageId: `assistant-${hash.slice(0, 8)}`,
      observation: { documentId: h.page.documentId, conversationKey: conversationKey(conversation), messageId: `assistant-${hash.slice(0, 8)}` }
    },
    updatedAt: new Date().toISOString()
  });
  return h.mod.tickAnalyzing(await loadProcessForWindow(1));
}

async function queueOfTwo({ settings = {} } = {}) {
  const t = clock();
  const seed = Object.keys(settings).length ? { [OPERATOR_SETTINGS_KEY]: normalizeOperatorSettings(settings) } : {};
  const h = await harness({ seed, extraExports: ["startMissionQueue", "tickRotating"] });
  h.chrome.offscreen = { createDocument: async () => {}, hasDocument: async () => true };
  followNavigation(h);
  const worker = await ensureWorkerBinding(1);
  for (const gf of ["GF-901", "GF-902"]) {
    await addMissionWorkItem(1, `Projekt: 900 - Syntetiskt testprojekt - Gf: ${gf}.`, {
      storage: h.chrome.storage.local, workerId: worker.workerId, maxInteractions: 1
    });
  }
  showFreshChat(h);
  await h.mod.startMissionQueue({ windowId: 1 });
  // A: fresh chat, FULL, sent.
  let a = await tickUntil(h, t, (p) => p.phase === "WAITING");
  assert.equal(a.phase, "WAITING", `A reached ${a.phase}`);
  assert.equal(a.lastPrompt.promptProfile.profile, "FULL");
  const aUserId = h.page.lastUserId;
  // A answers in its conversation; the queue moves on to B (cold, first start).
  const b0 = await answerAndPark(h, a, CONV_A);
  assert.notEqual(b0.processId, a.processId);
  showFreshChat(h);
  let b = await tickUntil(h, t, (p) => p.phase === "WAITING");
  assert.equal(b.phase, "WAITING", `B reached ${b.phase}`);
  return { h, t, a, aUserId, b };
}

test("v1.9.0 policy: warm only after an answered turn in a known conversation, inside the caps", () => {
  const now = Date.parse("2026-10-06T08:00:00Z");
  const parked = {
    processId: "process-1", phase: "ANALYZING", lastManagedUrl: CONV_A, updatedAt: new Date(now - 60_000).toISOString(),
    lastPrompt: { hash: "p", dispatchedUserTurnId: "user-1", promptProfile: { schema: "eic.greenfield.prompt-profile.v1", ordinal: 1 } },
    lastResponse: { hash: "r", observation: { conversationKey: conversationKey(CONV_A) } }
  };
  const item = { lastOutcome: "QUANTUM_EXHAUSTED", lastLeftAtMs: now - 60_000, resume: {} };
  const warm = warmResumeDecision({ item, parked, now });
  assert.equal(warm.warm, true);
  assert.equal(warm.conversationKey, conversationKey(CONV_A));
  assert.equal(warm.expectedLastUserTurnId, "user-1");
  const cold = (patch) => warmResumeDecision({ now, item, parked, ...patch }).code;
  assert.equal(cold({ enabled: false }), "WARM_RESUME_DISABLED");
  assert.equal(cold({ parked: { ...parked, phase: "WAITING" } }), "LAST_TURN_NOT_ANSWERED");
  assert.equal(cold({ item: { ...item, lastOutcome: "STALE_SESSION_120M_QUEUE_ROTATION" } }), "PARK_OUTCOME_NEEDS_FRESH_CHAT");
  assert.equal(cold({ item: { ...item, lastOutcome: "OPERATOR_QUEUE_ADVANCE" } }), "PARK_OUTCOME_NEEDS_FRESH_CHAT");
  assert.equal(cold({ item: { ...item, resume: { sourceResponseState: "PROMPT_ACKNOWLEDGED_NO_COMPLETED_RESPONSE" } } }), "RESUME_SOURCE_NOT_COMPLETED");
  assert.equal(cold({ lastSessionAction: "ROTATE_SESSION_NOW" }), "AI_REQUESTED_NEW_CHAT");
  assert.equal(cold({ parked: { ...parked, lastManagedUrl: "", lastResponse: { hash: "r", observation: {} } } }), "CONVERSATION_UNKNOWN");
  assert.equal(cold({ parked: { ...parked, lastManagedUrl: CONV_B } }), "CONVERSATION_IDENTITY_CONFLICT");
  assert.equal(cold({ parked: { ...parked, lastPrompt: { ...parked.lastPrompt, promptProfile: { schema: "x", ordinal: WARM_RESUME_MAX_CHAT_PROMPTS } } } }), "CHAT_PROMPT_CAP_REACHED");
  assert.equal(cold({ item: { ...item, lastLeftAtMs: now - 25 * 3600_000 } }), "CHAT_IDLE_TOO_LONG");
  assert.equal(cold({ otherConversationKeys: [CONV_A] }), "CONVERSATION_USED_BY_OTHER_GFW");
  assert.equal(warmResumeDecision({ item, parked, now, otherConversationKeys: [CONV_B] }).warm, true);
  assert.match(warmResumeObjective({ objective: "Do X.", outcome: "QUANTUM_EXHAUSTED", idleMinutes: 12.4 }),
    /^Queue resume in this same conversation: .*QUANTUM_EXHAUSTED.* 12 min ago.*re-read fresh owner state.*Next step: Do X\.$/);
});

test("v1.9.0 policy: the page verdict proves the conversation, waits for it, or gives up", () => {
  const warm = { conversationKey: conversationKey(CONV_A), expectedLastUserTurnId: "user-1" };
  const page = { url: CONV_A, userCount: 1, assistantCount: 1, lastUserId: "user-1", composerReady: true, composerEmpty: true };
  assert.equal(warmResumePageVerdict({ warm, page }).action, "READY");
  assert.equal(warmResumePageVerdict({ warm, page: { ...page, url: ROOT }, navigationAgeMs: 5000 }).code, "CONVERSATION_LOADING");
  assert.equal(warmResumePageVerdict({ warm, page: { ...page, url: ROOT }, navigationAgeMs: 20000 }).code, "CONVERSATION_NOT_SHOWN");
  assert.equal(warmResumePageVerdict({ warm, page: { ...page, userCount: 0, assistantCount: 0 } }).code, "THREAD_LOADING");
  assert.equal(warmResumePageVerdict({ warm, page: { ...page, generating: true } }).code, "CONVERSATION_GENERATING");
  assert.equal(warmResumePageVerdict({ warm, page: { ...page, composerEmpty: false } }).code, "COMPOSER_HAS_DRAFT");
  assert.equal(warmResumePageVerdict({ warm, page: { ...page, lastUserId: "user-operator" } }).code, "CONVERSATION_CONTINUED_ELSEWHERE");
  assert.equal(warmResumePageVerdict({ warm, page: { ...page, generating: true }, navigationAgeMs: 91_000 }).code, "WARM_RESUME_READY_TIMEOUT");
});

test("v1.9.0 E2E: a parked GFW comes back to its own conversation with a COMPACT prompt", async () => {
  const { h, t, a, aUserId, b } = await queueOfTwo();
  try {
    const fullLength = a.lastPrompt.text.length;
    const back = await answerAndPark(h, b, CONV_B);
    assert.equal(back.processId, a.processId, "A is active again");
    assert.equal(back.sessionRotation.warmResume.state, "PLANNED");
    assert.equal(back.sessionRotation.reasonCode, "QUEUE_MISSION_WARM_RESUME");
    assert.equal(back.sessionSeq, a.sessionSeq, "same ChatGPT session");
    assert.equal(back.pendingPrompt.promptProfile.profile, "COMPACT");
    assert.equal(back.pendingPrompt.a2a.messageType, "CONTINUATION");
    assert.match(back.pendingPrompt.a2a.objective, /^Queue resume in this same conversation/);
    assert.equal(back.pendingPrompt.a2a.continuity.sessionRotation, null);

    showConversation(h, ROOT, { userCount: 0, assistantCount: 0 });
    let p = await tickUntil(h, t, () => h.navigations.at(-1) === CONV_A);
    assert.equal(h.navigations.at(-1), CONV_A, "the tab returns to A's conversation");
    showConversation(h, CONV_A, { userId: aUserId });
    p = await tickUntil(h, t, (row) => row.phase !== "ROTATING");
    assert.equal(p.phase, "SENDING");
    assert.equal(p.sessionRotation.warmResume.state, "VERIFIED");
    const sentBefore = h.sent.length;
    p = await tickUntil(h, t, (row) => row.phase === "WAITING");
    assert.equal(h.sent.length, sentBefore + 1, "exactly one prompt");
    const sent = h.sent.at(-1).prompt;
    assert.equal(JSON.parse(sent).responseContract.profile, "COMPACT_REFERENCE");
    assert.ok(sent.length < fullLength / 2, `COMPACT ${sent.length} < FULL ${fullLength} / 2`);
    const rows = (await readIncidentLog(h.chrome.storage.local)).rows;
    assert.ok(rows.some((row) => row.kind === "WARM_RESUME_READY" && row.processId === a.processId));
  } finally { t.restore(); }
});

test("v1.9.0 E2E: the conversation does not open (e.g. deleted chat) -> fresh chat with FULL, nothing sent before", async () => {
  const { h, t, a, b } = await queueOfTwo();
  try {
    const back = await answerAndPark(h, b, CONV_B);
    assert.equal(back.sessionRotation.warmResume.state, "PLANNED");
    const sentBefore = h.sent.length;
    // ChatGPT redirects the address of a deleted conversation to the GPT start page.
    h.redirects[CONV_A] = ROOT;
    showFreshChat(h);
    let p = await tickUntil(h, t, (row) => row.sessionRotation?.warmResume?.state === "ABANDONED" || row.phase !== "ROTATING");
    assert.equal(p.sessionRotation.warmResume.state, "ABANDONED");
    assert.equal(p.sessionRotation.warmResume.abandonCode, "CONVERSATION_NOT_SHOWN");
    assert.equal(h.sent.length, sentBefore, "nothing sent during the warm attempt");
    assert.equal(p.pendingPrompt.promptProfile.profile, "FULL");
    assert.equal(p.pendingPrompt.a2a.messageType, "SESSION_ROTATION");
    assert.equal(p.sessionSeq, a.sessionSeq + 1, "a fresh chat is a new session");
    showFreshChat(h);
    p = await tickUntil(h, t, (row) => row.phase === "WAITING");
    assert.equal(p.phase, "WAITING");
    assert.equal(h.sent.length, sentBefore + 1);
    assert.equal(JSON.parse(h.sent.at(-1).prompt).messageType, "SESSION_ROTATION");
  } finally { t.restore(); }
});

test("v1.9.0 E2E: someone wrote in A's conversation meanwhile -> fresh chat, A's thread is not reused", async () => {
  const { h, t, b } = await queueOfTwo();
  try {
    await answerAndPark(h, b, CONV_B);
    showConversation(h, ROOT, { userCount: 0, assistantCount: 0 });
    await tickUntil(h, t, () => h.navigations.at(-1) === CONV_A);
    showConversation(h, CONV_A, { userId: "user-operator-typed-here", userCount: 2, assistantCount: 2 });
    const p = await tickUntil(h, t, (row) => row.sessionRotation?.warmResume?.state === "ABANDONED" || row.phase !== "ROTATING");
    assert.equal(p.sessionRotation.warmResume.abandonCode, "CONVERSATION_CONTINUED_ELSEWHERE");
    assert.equal(p.pendingPrompt.promptProfile.profile, "FULL");
  } finally { t.restore(); }
});

test("v1.9.0 E2E: Fortsätt i egen chatt turned off -> the v1.8.14 cold resume (fresh chat, FULL)", async () => {
  const { h, t, a, b } = await queueOfTwo({ settings: { warmQueueResume: false } });
  try {
    const back = await answerAndPark(h, b, CONV_B);
    assert.equal(back.processId, a.processId);
    assert.equal(back.sessionRotation.warmResume.state, "COLD");
    assert.equal(back.sessionRotation.warmResume.code, "WARM_RESUME_DISABLED");
    assert.equal(back.sessionRotation.reasonCode, "QUEUE_MISSION_RESUME");
    assert.equal(back.pendingPrompt.promptProfile.profile, "FULL");
    assert.equal(back.pendingPrompt.a2a.messageType, "SESSION_ROTATION");
    assert.equal(back.sessionSeq, a.sessionSeq + 1);
    const before = h.navigations.length;
    showConversation(h, CONV_B, { userCount: 1, assistantCount: 1 });
    await tickUntil(h, t, () => h.navigations.length > before);
    assert.equal(h.navigations.at(-1), ROOT, "a fresh chat is opened");
  } finally { t.restore(); }
});

test("v1.9.0 E2E: the AI asked for a new chat in its last answer -> cold", async () => {
  const { h, t, b } = await queueOfTwo();
  try {
    // A is parked already; B's answer moves on. Re-park A with ROTATE_SESSION_NOW by editing its snapshot.
    const queue = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: b.workerId });
    const aItem = queue.items.find((item) => item.processSnapshot && item.itemId !== b.queueContext.itemId);
    const text = answer({ sessionAction: "ROTATE_SESSION_NOW", sessionReason: "Context drift." });
    aItem.processSnapshot.lastResponse = { ...aItem.processSnapshot.lastResponse, text, hash: await sha256Hex(text), contract: null };
    const { saveMissionWorkQueue } = await import("../lib/mission-work-queue.mjs");
    await saveMissionWorkQueue(queue, h.chrome.storage.local);
    const back = await answerAndPark(h, b, CONV_B);
    assert.equal(back.sessionRotation.warmResume.code, "AI_REQUESTED_NEW_CHAT");
    assert.equal(back.pendingPrompt.promptProfile.profile, "FULL");
  } finally { t.restore(); }
});

test("v1.9.0 E2E: the saved mission text changed while parked -> same conversation, but FULL", async () => {
  const { h, t, a, b } = await queueOfTwo();
  try {
    const queue = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: b.workerId });
    const aItem = queue.items.find((item) => item.itemId === a.queueContext.itemId);
    aItem.goal = `${aItem.goal}\nNytt delmål i uppdragstexten.`;
    const { saveMissionWorkQueue } = await import("../lib/mission-work-queue.mjs");
    await saveMissionWorkQueue(queue, h.chrome.storage.local);
    const back = await answerAndPark(h, b, CONV_B);
    assert.equal(back.sessionRotation.warmResume.state, "PLANNED", "still its own conversation");
    assert.equal(back.pendingPrompt.promptProfile.profile, "FULL", "the mission text must be re-sent in full");
  } finally { t.restore(); }
});

test("v1.9.0: warm resume is on by default and can be turned off", () => {
  assert.equal(normalizeOperatorSettings({}).warmQueueResume, true);
  assert.equal(normalizeOperatorSettings({ warmQueueResume: false }).warmQueueResume, false);
  assert.equal(normalizeOperatorSettings({ warmQueueResume: "yes" }).warmQueueResume, false);
});

test("v1.9.0 E2E: another GFW answered in A's conversation -> A's thread is no longer A's alone -> cold", async () => {
  const { h, t, b } = await queueOfTwo();
  try {
    const back = await answerAndPark(h, b, CONV_A);
    assert.equal(back.sessionRotation.warmResume.code, "CONVERSATION_USED_BY_OTHER_GFW");
    assert.equal(back.pendingPrompt.promptProfile.profile, "FULL");
    assert.equal(back.pendingPrompt.a2a.messageType, "SESSION_ROTATION");
  } finally { t.restore(); }
});
