import test from "node:test";
import assert from "node:assert/strict";

import {
  RESPONSE_TRACE_MAX,
  appendResponseTrace,
  responseStructuralCompleteness,
  responseTraceDetail
} from "../lib/response-observation.mjs";
import { createStartupDiagnostics } from "../lib/startup-diagnostics.mjs";
import { harness } from "./helpers/background-harness.mjs";
import { loadProcessForWindow, saveProcess } from "../lib/process-store.mjs";
import {
  addMissionWorkItem,
  createQueueContext,
  loadMissionWorkQueue,
  saveMissionWorkQueue
} from "../lib/mission-work-queue.mjs";
import { sha256Hex } from "../lib/common.mjs";
import { ANALYSIS_SCHEMA } from "../lib/contracts.mjs";

// The distinct short "responses" Greenfield 1.8.0 admitted as complete in the
// live diagnostics export of 2026-09-24 (45 of 78 recorded turns were short).
const LIVE_PREFIX_CAPTURES = [
  "UM0007-REVA-IRL-2600-and-3000-Trailed-Mower.pdfPDF{\n\"",
  "gf010_wp5_explicit_attachment_candidate_queue_v2.jsonFil{\n\"schema\": \"eic",
  "{",
  "{\n\"",
  "{\n\"schema",
  "{\n\"schema\": \"eic.a",
  "{\n\"schema\": \"eic.a2",
  "{\n\"schema\": \"eic.a2Profi+1GK Agri PartsProfifarmersjournal.ieProfi",
  "{\n\"schema\": \"eic.a2a",
  "{\""
];

const FULL_RESPONSE = JSON.stringify({
  schema: "eic.a2a.response.v1",
  status: "CONTINUE",
  summary: "Bounded work was performed; braces in text } { are fine.",
  workPerformed: ["Read owner state."],
  evidence: ["Owner readback."],
  blockers: [],
  nextSuggestedAction: "Continue with the next bounded owner-verified work package."
}, null, 1);

// ---------------------------------------------------------------------------
// 1. Structural completeness.

test("v1.8.2 every short capture from the live export is recognised as an unfinished JSON object", () => {
  for (const text of LIVE_PREFIX_CAPTURES) {
    const verdict = responseStructuralCompleteness(text);
    assert.equal(verdict.complete, false, JSON.stringify(text));
    assert.equal(verdict.reason, "UNTERMINATED_JSON_OBJECT");
  }
});

test("v1.8.2 finished answers pass: closed JSON, code-block label, trailing prose, plain prose", () => {
  const complete = [
    FULL_RESPONSE,
    `JSON${FULL_RESPONSE}`,
    `\`\`\`json\n${FULL_RESPONSE}\n\`\`\``,
    `${FULL_RESPONSE}\n\nStatus: CONTINUE / YIELD_TO_QUEUE\nTime: 2026-09-24T06:01:32Z\nProject: EIC Learning`,
    `report.jsonFil${FULL_RESPONSE}`,
    "A plain prose answer without any JSON.",
    "Prose with {curly} braces and a closed object {\"a\": [1, {\"b\": \"}\"}]}.",
    "{}"
  ];
  for (const text of complete) {
    assert.equal(responseStructuralCompleteness(text).complete, true, JSON.stringify(text.slice(0, 60)));
  }
  assert.equal(responseStructuralCompleteness(FULL_RESPONSE.slice(0, -1)).complete, false, "one missing brace");
  assert.equal(responseStructuralCompleteness("{\"a\": \"unterminated string }").complete, false);
  assert.equal(responseStructuralCompleteness("Working on it {").complete, false, "a trailing opening brace");
});

// ---------------------------------------------------------------------------
// 2. Trace ring.

test("v1.8.2 the trace keeps ids, lengths and reasons only, and never response text", () => {
  const detail = responseTraceDetail({
    documentId: "doc-1",
    generating: false,
    lastAssistantId: "request-WEB:abc-6",
    assistantHash: "1234567890abcdef1234",
    autonomousTurn: {
      expectedUserTurnId: "user-1",
      resolvedUserTurnId: "user-1",
      assistantFound: true,
      assistantId: "request-WEB:abc-6",
      assistantText: "SECRET RESPONSE TEXT",
      assistantTextLength: 20,
      assistantOwnerTrusted: true
    }
  }, { stabilityReads: 3 });
  assert.equal(JSON.stringify(detail).includes("SECRET"), false);
  assert.equal(detail.assistantTextLength, 20);
  assert.equal(detail.pageAssistantHash, "1234567890ab", "hashes are cut to 12 chars");
  assert.equal(detail.stabilityReads, 3);
});

test("v1.8.2 an unchanged reason is refreshed at most once per minute; streaming hashes do not add entries", () => {
  const t0 = Date.parse("2026-09-24T06:00:00Z");
  const base = { reason: "AUTONOMOUS_RESPONSE_STILL_GENERATING", turn: 2, promptHash: "p", detail: { assistantId: "a", assistantHash: "h1" } };
  let { trace, changed } = appendResponseTrace([], base, { now: t0 });
  assert.equal(changed, true);
  ({ trace, changed } = appendResponseTrace(trace, { ...base, detail: { assistantId: "a", assistantHash: "h2" } }, { now: t0 + 30_000 }));
  assert.equal(changed, false, "a new stream hash is detail, not identity");
  ({ trace, changed } = appendResponseTrace(trace, base, { now: t0 + 61_000 }));
  assert.equal(changed, true);
  assert.equal(trace.length, 1);
  assert.equal(trace[0].count, 2);
  assert.equal(trace[0].firstAt, "2026-09-24T06:00:00.000Z");
  ({ trace } = appendResponseTrace(trace, { ...base, reason: "RESPONSE_CAPTURED" }, { now: t0 + 62_000 }));
  assert.deepEqual(trace.map((row) => row.reason), ["AUTONOMOUS_RESPONSE_STILL_GENERATING", "RESPONSE_CAPTURED"]);
  for (let i = 0; i < 40; i += 1) ({ trace } = appendResponseTrace(trace, { ...base, reason: `R${i}` }, { now: t0 + i }));
  assert.equal(trace.length, RESPONSE_TRACE_MAX);
  assert.equal(trace.at(-1).reason, "R39");
});

// ---------------------------------------------------------------------------
// 3. E2E through background.js.

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

function clock() {
  const realNow = Date.now;
  let offset = 0;
  return {
    advance(ms) { offset += ms; Date.now = () => realNow() + offset; },
    restore() { Date.now = realNow; }
  };
}

// The page shows a finished-looking assistant turn (no generation signal)
// whose text is `text`, causally paired with Greenfield's dispatched turn.
async function showAssistant(h, text, id = "request-WEB:live-6") {
  const hash = await sha256Hex(text);
  Object.assign(h.page, {
    generating: false,
    assistantCount: 1,
    lastAssistantId: id,
    assistantText: text,
    assistantHash: hash,
    autonomousTurn: {
      expectedUserTurnId: h.page.lastUserId,
      expectedUserIndex: h.page.userCount - 1,
      resolvedUserTurnId: h.page.lastUserId,
      resolvedBy: "USER_TURN_ID",
      userTextHash: h.page.lastUserHash,
      assistantFound: true,
      assistantId: id,
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
}

async function waiting(h) {
  mockAnalyzer(h);
  await h.mod.startRun({ windowId: 1, goal: "Projekt: 67 - EIC Learning - Gf: GF-WC-RISK-001." });
  let p = await loadProcessForWindow(1);
  p = await h.mod.tickSending(p);
  p = await h.mod.tickSending(p);
  assert.equal(p.phase, "WAITING");
  return p;
}

test("v1.8.2 E2E: a stalled JSON prefix with no generation signal is never captured; the finished answer is", async () => {
  const h = await harness();
  const t = clock();
  try {
    let p = await waiting(h);
    await showAssistant(h, "{\n\"schema\": \"eic.a2a");
    for (let i = 0; i < 12; i += 1) {
      t.advance(5000);
      p = await h.mod.tickWaiting(p);
    }
    assert.equal(p.phase, "WAITING", "one minute of a stable prefix is still not a response");
    assert.equal(p.lastResponse, null);
    const held = p.responseObservationTrace.find((row) => row.reason === "RESPONSE_STRUCTURALLY_INCOMPLETE:UNTERMINATED_JSON_OBJECT");
    assert.ok(held, JSON.stringify(p.responseObservationTrace.map((row) => row.reason)));
    assert.equal(held.detail.assistantTextLength, 20);
    assert.equal(held.detail.assistantId, "request-WEB:live-6");
    assert.ok(p.responseObservationTrace.some((row) => row.reason === "COMPLETED_ASSISTANT_SEEN_STALE_CLOCK_RESET"),
      "the moment a finished-looking answer appeared is recorded");

    await showAssistant(h, FULL_RESPONSE);
    for (let i = 0; i < 10 && p.phase === "WAITING"; i += 1) {
      t.advance(3000);
      p = await h.mod.tickWaiting(p);
    }
    assert.equal(p.phase, "ANALYZING");
    assert.equal(p.lastResponse.text, FULL_RESPONSE);
    assert.equal(p.lastResponse.contract.parseMode, "STRICT");
    const captured = p.responseObservationTrace.at(-1);
    assert.equal(captured.reason, "RESPONSE_CAPTURED");
    assert.equal(captured.detail.capturedTextLength, FULL_RESPONSE.length);
  } finally {
    t.restore();
  }
});

test("v1.8.2 E2E: an unchanged held reason is not written to storage on every tick", async () => {
  const h = await harness();
  const t = clock();
  try {
    let p = await waiting(h);
    for (let i = 0; i < 3; i += 1) { t.advance(2000); p = await h.mod.tickWaiting(p); }
    // Count persisted changes of the trace itself. (Other periodic process
    // writes, e.g. the model-observation refresh, are pre-existing behaviour.)
    const storage = h.chrome.storage.local;
    const originalSet = storage.set.bind(storage);
    let lastTrace = JSON.stringify(p.responseObservationTrace);
    let traceWrites = 0;
    storage.set = async (items) => {
      for (const [key, value] of Object.entries(items || {})) {
        if (!key.startsWith("eic.gf.process.worker.")) continue;
        const trace = JSON.stringify((value?.value || value)?.responseObservationTrace);
        if (trace !== lastTrace) { traceWrites += 1; lastTrace = trace; }
      }
      return originalSet(items);
    };
    for (let i = 0; i < 10; i += 1) { t.advance(4000); p = await h.mod.tickWaiting(p); }
    assert.equal(traceWrites, 0, "40 s of the same held reason: the trace is not rewritten");
    t.advance(61_000);
    p = await h.mod.tickWaiting(p);
    assert.equal(traceWrites, 1, "one refresh after a minute");
    const reasons = p.responseObservationTrace.map((row) => row.reason);
    assert.equal(new Set(reasons).size, reasons.length, "no duplicate consecutive entries");
    assert.ok(p.responseObservationTrace.at(-1).count >= 2);
  } finally {
    t.restore();
  }
});

test("v1.8.2 E2E: the trace survives the 120-minute queue rotation and is indexed in the diagnostics export", async () => {
  const h = await harness();
  mockAnalyzer(h);
  await h.mod.startRun({ windowId: 1, goal: "Projekt: 67 - EIC Learning - Gf: GF-WC-RISK-001." });
  let p = await loadProcessForWindow(1);
  const storage = h.chrome.storage.local;
  for (const [goal, savedMissionId] of [["Projekt: 67 - EIC Learning - Gf: GF-WC-RISK-001.", "gfw-risk"], ["Projekt: 59 - EIC Backend - Gf: GF-002.", "gfw-002"]]) {
    await addMissionWorkItem(1, goal, { storage, workerId: p.workerId, savedMissionId, maxInteractions: 3 });
  }
  let queue = await loadMissionWorkQueue(1, storage, { workerId: p.workerId });
  queue.items[0] = { ...queue.items[0], status: "ACTIVE" };
  queue.activeItemId = queue.items[0].itemId;
  queue.enabled = true;
  queue = await saveMissionWorkQueue(queue, storage);
  await saveProcess({ ...p, queueContext: createQueueContext(queue, queue.items[0], { interactionCount: 1 }) });
  p = await h.mod.tickSending(await loadProcessForWindow(1));
  p = await h.mod.tickSending(p);
  assert.equal(p.phase, "WAITING");

  h.chrome.tabs.reload = async () => { h.page.documentId = `document-${Date.now()}`; };
  const realNow = Date.now;
  try {
    for (const minute of [1, 31, 61, 91, 121]) {
      Date.now = () => realNow() + minute * 60_000;
      p = await h.mod.tickWaiting(p);
    }
  } finally {
    Date.now = realNow;
  }
  assert.equal(p.queueContext.savedMissionId, "gfw-002", "rotated to the next slot");
  const after = await loadMissionWorkQueue(1, storage, { workerId: p.workerId });
  const parked = after.items.find((item) => item.savedMissionId === "gfw-risk");
  const reasons = parked.processSnapshot.responseObservationTrace.map((row) => row.reason);
  assert.ok(reasons.includes("WAITING_REFRESH_F5"), reasons.join(","));
  assert.ok(reasons.includes("WAITING_REFRESH_CTRL_F5"));
  assert.equal(reasons.at(-1), "STALE_SESSION_120M_ROTATE");
  assert.ok(reasons.length <= 8, "a parked snapshot keeps only the newest entries");
  assert.ok(reasons.some((reason) => !reason.startsWith("WAITING_REFRESH") && reason !== "STALE_SESSION_120M_ROTATE"),
    "the held reason before the ladder is kept");

  const diagnostics = await createStartupDiagnostics(storage, { version: "1.8.2" });
  const row = diagnostics.responseObservation.find((entry) => entry.source === "PARKED_QUEUE_SLOT" && entry.processId === parked.processSnapshot.processId);
  assert.ok(row);
  assert.equal(row.lastOutcome, "STALE_SESSION_120M_QUEUE_ROTATION");
  assert.deepEqual(row.trace.map((entry) => entry.reason), reasons);
});
