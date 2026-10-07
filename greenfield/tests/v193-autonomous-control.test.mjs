// v1.9.3 operator rule (2026-10-07): "Operatör är aldrig närvarande i en GFW
// session". No control path may wait for an operator; a no-delta state pauses
// and asks the EIC again. Also covers the 1.9.3 control-chain review findings
// (CC-01..CC-08). End-to-end tests run the real background.js and the real
// offscreen.js together with a stubbed Chrome LanguageModel; synthetic texts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { harness } from "./helpers/background-harness.mjs";
import { loadProcessForWindow, saveProcess } from "../lib/process-store.mjs";
import { sha256Hex } from "../lib/common.mjs";
import { ANALYSIS_SCHEMA } from "../lib/contracts.mjs";
import { conversationKey } from "../lib/restart-recovery.mjs";
import { readNextInstruction, writeNextInstruction } from "../lib/instruction-store.mjs";
import { addMissionWorkItem, loadMissionWorkQueue } from "../lib/mission-work-queue.mjs";
import { ensureWorkerBinding } from "../lib/worker-identity.mjs";
import {
  ADVISORY_DONE_CONTINUATION,
  ADVISORY_NO_DELTA_PAUSE_MAX_SECONDS,
  advisoryNoDeltaResumePrompt,
  OWNER_RESUME_CONTINUATION,
  TERMINAL_DEFERRED_CONTINUATION,
  advisoryNoDeltaPauseSeconds,
  applyGreenfieldControlToDecision,
  resolveGreenfieldControl
} from "../lib/greenfield-control.mjs";
import { evaluateContinuationAdmission } from "../lib/continuation-guard.mjs";

// ---------------------------------------------------------------- unit level

test("no-delta: a repeated local DONE without EIC terminal or handoff pauses with a doubling, capped pause instead of blocking", () => {
  const first = resolveGreenfieldControl({ targetDisposition: "UNKNOWN", decision: { disposition: "DONE" } });
  assert.equal(first.reason, "ADVISORY_DONE_WITHOUT_EIC_TERMINAL");
  assert.equal(first.effectiveNextPrompt, ADVISORY_DONE_CONTINUATION);
  let previous = first;
  const seconds = [];
  for (let i = 0; i < 8; i += 1) {
    const next = resolveGreenfieldControl({
      targetDisposition: "UNKNOWN", decision: { disposition: "DONE" },
      previousReason: previous.reason, previousNoDeltaStreak: previous.noDeltaPause?.streak || 0
    });
    assert.equal(next.reason, "ADVISORY_DONE_NO_DELTA_PAUSE");
    assert.equal(next.state, "ACTIVE");
    assert.equal(next.hardStop, false);
    assert.equal(next.effectiveDisposition, "CONTINUE");
    assert.notEqual(next.action, "OPERATOR");
    assert.equal(next.effectiveNextPrompt, advisoryNoDeltaResumePrompt(next.noDeltaPause));
    assert.match(next.effectiveNextPrompt, new RegExp(`no-delta pause ${i + 1} `));
    seconds.push(next.noDeltaPause.pauseSeconds);
    previous = next;
  }
  assert.deepEqual(seconds, [900, 1800, 3600, 7200, 14400, 21600, 21600, 21600]);
  assert.equal(advisoryNoDeltaPauseSeconds(99), ADVISORY_NO_DELTA_PAUSE_MAX_SECONDS);
  // An EIC handoff in between resets the streak.
  const handoff = resolveGreenfieldControl({ targetDisposition: "CONTINUE", targetNextSuggestedAction: "Slice 2.", decision: { disposition: "DONE" }, previousReason: previous.reason });
  assert.equal(handoff.reason, "ADVISORY_DONE_EIC_CONTINUES");
  const afterReset = resolveGreenfieldControl({ targetDisposition: "UNKNOWN", decision: { disposition: "DONE" }, previousReason: handoff.reason });
  assert.equal(afterReset.reason, "ADVISORY_DONE_WITHOUT_EIC_TERMINAL");
});

test("CC-01: a local DONE with ROTATE_SESSION_NOW or YIELD_TO_QUEUE never closes; the EIC handoff is the objective", () => {
  for (const sessionAction of ["ROTATE_SESSION_NOW", "YIELD_TO_QUEUE"]) {
    for (const target of ["CONTINUE", "UNKNOWN", "BLOCKED"]) {
      const control = resolveGreenfieldControl({
        targetDisposition: target, targetNextSuggestedAction: "Slice 3: verify the parser.",
        decision: { disposition: "DONE", objectiveStatus: "SATISFIED", nextPrompt: "" }, sessionAction
      });
      assert.equal(control.state, "ACTIVE", `${sessionAction}/${target}`);
      assert.equal(control.controllerOverride, true);
      const d = applyGreenfieldControlToDecision({ disposition: "DONE", objectiveStatus: "SATISFIED", nextPrompt: "" }, control);
      assert.equal(d.disposition, "CONTINUE");
      assert.equal(d.nextPrompt, "Slice 3: verify the parser.");
    }
    const bare = resolveGreenfieldControl({ targetDisposition: "UNKNOWN", decision: { disposition: "DONE" }, sessionAction });
    assert.equal(bare.effectiveNextPrompt, ADVISORY_DONE_CONTINUATION);
  }
  // The EIC's own terminal still closes.
  assert.equal(resolveGreenfieldControl({ targetDisposition: "DONE", decision: { disposition: "CONTINUE", nextPrompt: "x" } }).state, "DONE");
  assert.equal(resolveGreenfieldControl({ targetDisposition: "CONTINUE", decision: { disposition: "CONTINUE", nextPrompt: "x" }, sessionAction: "STOP_PROCESS" }).state, "DONE");
});

test("CC-04: the EIC CONTINUE handoff is forwarded verbatim with a Nano task, for READ_REQUIRED and with rotation or yield", () => {
  const nanoTask = { requested: true, status: "COMPLETED", result: "4" };
  const raw = "Implement slice 2: rotor ID granularity.\nNANO_TASK: Add 2 and 2";
  const withNano = resolveGreenfieldControl({ targetDisposition: "CONTINUE", targetNextSuggestedAction: raw, decision: { disposition: "CONTINUE", nextPrompt: "LOCAL REWRITE" }, nanoTask });
  assert.equal(withNano.reason, "EIC_HANDOFF_FORWARDED");
  assert.equal(withNano.effectiveNextPrompt, "Implement slice 2: rotor ID granularity.");
  const read = resolveGreenfieldControl({ targetDisposition: "CONTINUE", targetNextSuggestedAction: raw, decision: { disposition: "READ_REQUIRED", nextPrompt: "Read the file F and report." } });
  assert.equal(read.effectiveDisposition, "READ_REQUIRED");
  const readDecision = applyGreenfieldControlToDecision({ disposition: "READ_REQUIRED", nextPrompt: "Read the file F and report." }, read);
  assert.equal(readDecision.disposition, "READ_REQUIRED");
  assert.equal(readDecision.nextPrompt, "Implement slice 2: rotor ID granularity.");
  for (const sessionAction of ["ROTATE_SESSION_NOW", "YIELD_TO_QUEUE"]) {
    const c = resolveGreenfieldControl({ targetDisposition: "CONTINUE", targetNextSuggestedAction: raw, decision: { disposition: "CONTINUE", nextPrompt: "LOCAL REWRITE" }, sessionAction, nanoTask });
    const d = applyGreenfieldControlToDecision({ disposition: "CONTINUE", nextPrompt: "LOCAL REWRITE" }, c);
    assert.equal(d.nextPrompt, "Implement slice 2: rotor ID granularity.", sessionAction);
  }
});

test("CC-05: an advisory BLOCKED never re-attaches a NANO_TASK line and never leaves an empty prompt", () => {
  const nanoTask = { requested: true, status: "COMPLETED", result: "4" };
  const onlyNano = resolveGreenfieldControl({ targetDisposition: "CONTINUE", targetNextSuggestedAction: "NANO_TASK: Add 2 and 2", decision: { disposition: "BLOCKED" }, nanoTask });
  assert.equal(onlyNano.reason, "TARGET_CONTINUE_EXECUTABLE_NEXT_RECOVERY");
  assert.doesNotMatch(onlyNano.effectiveNextPrompt, /NANO_TASK\s*:/);
  assert.match(onlyNano.effectiveNextPrompt, /completed exactly once/);
  for (const sessionAction of ["ROTATE_SESSION_NOW", "YIELD_TO_QUEUE"]) {
    const empty = resolveGreenfieldControl({ targetDisposition: "CONTINUE", targetNextSuggestedAction: "", decision: { disposition: "BLOCKED" }, sessionAction });
    assert.equal(empty.effectiveNextPrompt, OWNER_RESUME_CONTINUATION, sessionAction);
    const nano = resolveGreenfieldControl({ targetDisposition: "CONTINUE", targetNextSuggestedAction: "Slice.\nNANO_TASK: Add 2 and 2", decision: { disposition: "BLOCKED" }, sessionAction, nanoTask });
    assert.equal(nano.effectiveNextPrompt, "Slice.", sessionAction);
  }
});

test("CC-02: admission never recovers a consumed NANO_TASK line from the EIC handoff", () => {
  const nanoTask = { requested: true, status: "COMPLETED", result: "4" };
  const r = evaluateContinuationAdmission({
    targetDisposition: "CONTINUE", currentObjective: "Objective.",
    targetNextSuggestedAction: "Verify the sum in owner state.\nNANO_TASK: {\"instruction\":\"Add 2 and 2\"}",
    decision: { disposition: "CONTINUE", nextPrompt: "Verify the sum in owner state." }, nanoTask
  });
  assert.equal(r.ok, true);
  assert.equal(r.effectiveNextPrompt, "Verify the sum in owner state.");
  assert.doesNotMatch(r.effectiveNextPrompt, /NANO_TASK/);
});

test("CC-07: the no-delta exit names only controls the current responseContract offers", () => {
  const args = { targetDisposition: "CONTINUE", currentObjective: "Same.", decision: { disposition: "CONTINUE", nextPrompt: "Same." } };
  const alone = evaluateContinuationAdmission(args);
  assert.match(alone.effectiveNextPrompt, /sessionAction PAUSE_PROCESS and pauseSeconds/);
  assert.doesNotMatch(alone.effectiveNextPrompt, /YIELD_TO_QUEUE|BACKGROUND_SLEEP|SET_SCHEDULE/);
  const queued = evaluateContinuationAdmission({ ...args, queueManaged: true });
  assert.match(queued.effectiveNextPrompt, /YIELD_TO_QUEUE or BACKGROUND_SLEEP, or runtimeControl SET_SCHEDULE/);
});

test("CC-08: an EIC terminal with a pending operator instruction is deferred, not routed to recovery", () => {
  for (const [targetDisposition, sessionAction] of [["DONE", "KEEP"], ["CONTINUE", "STOP_PROCESS"]]) {
    const c = resolveGreenfieldControl({ targetDisposition, sessionAction, decision: { disposition: "CONTINUE", nextPrompt: "x" }, operatorInstructionPending: true });
    assert.equal(c.state, "ACTIVE");
    assert.equal(c.reason, "EIC_TERMINAL_DEFERRED_FOR_OPERATOR_INSTRUCTION");
    assert.equal(c.effectiveNextPrompt, TERMINAL_DEFERRED_CONTINUATION);
    assert.equal(c.hardStop, false);
  }
});

// ------------------------------------------------- real background + offscreen

let offscreenSeq = 0;
async function attachRealOffscreen(h) {
  let listener = null;
  const saved = h.chrome.runtime.onMessage;
  h.chrome.runtime.onMessage = { addListener(fn) { listener = fn; } };
  let source = await readFile(new URL("../offscreen.js", import.meta.url), "utf8");
  const project = new URL("../", import.meta.url);
  source = source.replace(/(["'])\.\/lib\/([^"']+)["']/g, (_m, _q, p) => JSON.stringify(new URL(`lib/${p}`, project).href));
  await import(`data:text/javascript;base64,${Buffer.from(`${source}\n// offscreen ${offscreenSeq++}`).toString("base64")}`);
  h.chrome.runtime.onMessage = saved;
  h.chrome.offscreen = { createDocument: async () => {}, hasDocument: async () => true };
  h.offscreenCalls = [];
  h.chrome.runtime.sendMessage = async (message) => {
    if (!["EIC_GF_ANALYZE_PIPELINE", "EIC_GF_RUN_NANO_TASK"].includes(message?.type)) return { ok: true };
    h.offscreenCalls.push(message.type);
    return new Promise((resolve) => listener(message, null, resolve));
  };
}

// Stub Chrome LanguageModel: Hjalmar D2 returns h.hjalmar(); the Nano
// observer output is malformed (runtime fallback); a Nano task answers "4".
function stubLanguageModel(h, { availability = "available", createError = null } = {}) {
  h.nanoTaskPrompts = 0;
  globalThis.LanguageModel = {
    availability: async () => availability,
    create: async (options) => {
      if (createError) throw createError;
      const system = String(options?.initialPrompts?.[0]?.content || options?.systemPrompt || "");
      return {
        prompt: async () => {
          if (/Hjalmar D2/.test(system)) return JSON.stringify(h.hjalmar());
          if (/Nano Observer/.test(system)) return "not json";
          h.nanoTaskPrompts += 1;
          return "4";
        },
        destroy() {}
      };
    }
  };
}

function hjalmarDecision(disposition, { target = "CONTINUE", nextPrompt = "", objectiveStatus = disposition === "DONE" ? "SATISFIED" : "PENDING", nanoTaskAssessment = "NOT_REQUESTED" } = {}) {
  return {
    schema: ANALYSIS_SCHEMA, disposition, targetDisposition: target, objectiveStatus, nanoTaskAssessment,
    progressEvidence: "Synthetic evidence.", analysis: "Synthetic local verdict.", nextPrompt,
    exactTarget: "Synthetic objective.", ownerEvidence: "Synthetic response.", reversibility: "YES",
    rollbackPath: "Owner state.", readbackPlan: "Readback.", materialAmbiguity: "NONE",
    humanAuthorityRequired: false, confidence: "HIGH"
  };
}

async function respond(h, p, text) {
  const hash = await sha256Hex(text);
  const messageId = `assistant-${hash.slice(0, 8)}`;
  // The page shows the finished answer (composer idle again).
  Object.assign(h.page, { generating: false, assistantCount: h.page.userCount, lastAssistantId: messageId, assistantText: text, assistantHash: hash });
  await saveProcess({
    ...p, phase: "ANALYZING", lastManagedUrl: h.page.url,
    lastResponse: { text, hash, messageId, observation: { documentId: h.page.documentId, conversationKey: conversationKey(h.page.url), messageId } },
    updatedAt: new Date().toISOString()
  });
  return h.mod.tickAnalyzing(await loadProcessForWindow(p.windowId));
}

// Prompts keep Greenfield's minimum gap; t (a clock) moves time past it.
async function sendUntilWaiting(h, p, t = null) {
  for (let i = 0; i < 8 && p.phase !== "WAITING"; i += 1) {
    if (p.phase !== "SENDING") break;
    p = await h.mod.tickSending(p);
    if (p.phase !== "WAITING" && t) t.advance(200_000);
  }
  return p;
}

function clock() {
  const realNow = Date.now;
  let offset = 0;
  return {
    advance(ms) { offset += ms; Date.now = () => realNow() + offset; },
    restore() { Date.now = realNow; }
  };
}

const eic = (fields) => JSON.stringify({
  schema: "eic.a2a.response.v1", status: "CONTINUE", summary: "Synthetic summary.", workPerformed: ["Work."],
  evidence: ["Owner readback."], blockers: [], nextSuggestedAction: "", ...fields
});

async function started(options = {}) {
  const h = await harness();
  await attachRealOffscreen(h);
  stubLanguageModel(h, options);
  await h.mod.startRun({ windowId: 1, goal: "Projekt: 900 - Syntetiskt - Gf: GF-931." });
  const p = await sendUntilWaiting(h, await loadProcessForWindow(1));
  assert.equal(p.phase, "WAITING");
  return { h, p };
}

test("E2E no-delta: a repeated local DONE without EIC terminal pauses the GFW and asks the EIC again after the pause", async () => {
  const t = clock();
  try {
    const { h, p: start } = await started();
    h.hjalmar = () => hjalmarDecision("DONE", { target: "UNKNOWN" });
    let p = await respond(h, start, "The objective is met, I think.");
    assert.equal(p.phase, "SENDING", "first local DONE continues");
    assert.equal(p.greenfieldControl.reason, "ADVISORY_DONE_WITHOUT_EIC_TERMINAL");
    p = await sendUntilWaiting(h, p, t);
    assert.equal(p.phase, "WAITING");
    assert.equal(h.sent.length, 2);
    p = await respond(h, p, "Still met. Nothing more to do here.");
    assert.equal(p.phase, "PAUSED", JSON.stringify(p.lastError));
    assert.equal(p.greenfieldControl.reason, "ADVISORY_DONE_NO_DELTA_PAUSE");
    assert.equal(p.missionPause.requestedBy, "GREENFIELD_NO_DELTA");
    assert.equal(p.missionPause.durationSeconds, 900);
    assert.equal(p.pendingPrompt.a2a.objective, advisoryNoDeltaResumePrompt({ streak: 1, pauseSeconds: 900 }));
    const sentBefore = h.sent.length;
    p = await h.mod.tickProcess(p.processId, "test-pause-early") || await loadProcessForWindow(1);
    assert.equal((await loadProcessForWindow(1)).phase, "PAUSED", "still paused before the pause ends");
    t.advance(901_000);
    for (let i = 0; i < 4 && p.phase === "PAUSED"; i += 1) p = await h.mod.tickProcess(p.processId, "test-pause") || await loadProcessForWindow(1);
    p = await loadProcessForWindow(1);
    assert.equal(h.sent.length, sentBefore, "nothing is posted during the pause");
    p = await sendUntilWaiting(h, p, t);
    assert.equal(p.phase, "WAITING");
    assert.equal(h.sent.length, sentBefore + 1, "the EIC is asked again after the pause");
    // Third no-delta: the pause doubles.
    p = await respond(h, p, "Met.");
    assert.equal(p.phase, "PAUSED");
    assert.equal(p.missionPause.durationSeconds, 1800);
    assert.equal(p.greenfieldControl.noDeltaPause.streak, 2);
  } finally { t.restore(); }
});

test("E2E CC-01: a local DONE never closes the GFW when the EIC rotates or yields", async () => {
  for (const sessionAction of ["ROTATE_SESSION_NOW", "YIELD_TO_QUEUE"]) {
    const { h, p: start } = await started();
    h.hjalmar = () => hjalmarDecision("DONE");
    const p = await respond(h, start, eic({ nextSuggestedAction: "Slice 2: verify the parser.", sessionAction, sessionReason: "Context." }));
    assert.equal(p.phase, sessionAction === "ROTATE_SESSION_NOW" ? "ROTATING" : "SENDING", `${sessionAction} ${JSON.stringify(p.lastError)}`);
    assert.equal(p.sessionRotation?.objective || p.pendingPrompt?.a2a?.objective, "Slice 2: verify the parser.", sessionAction);
  }
});

test("E2E CC-02/CC-04: a consumed NANO_TASK line never reaches the next prompt; the EIC handoff is forwarded", async () => {
  const { h, p: start } = await started();
  h.hjalmar = () => hjalmarDecision("CONTINUE", { nextPrompt: "Verify the sum in owner state.", nanoTaskAssessment: "SATISFIED" });
  const p = await respond(h, start, eic({ nextSuggestedAction: "Verify the sum in owner state.\nNANO_TASK: Add 2 and 2 and return only the number." }));
  assert.equal(p.phase, "SENDING", JSON.stringify(p.lastError));
  assert.equal(h.nanoTaskPrompts, 1, "the Nano task ran exactly once");
  assert.equal(p.pendingPrompt.a2a.objective, "Verify the sum in owner state.");
  assert.doesNotMatch(JSON.stringify(p.pendingPrompt.a2a.objective), /NANO_TASK/);
});

test("E2E CC-03: a downloadable model or a failing create() falls back to the runtime decision instead of recovery", async () => {
  const notAllowed = Object.assign(new Error("Requires a user gesture."), { name: "NotAllowedError" });
  for (const options of [{ availability: "downloadable", createError: notAllowed }, { availability: "downloading" }, { availability: "available", createError: notAllowed }]) {
    const { h, p: start } = await started(options);
    h.hjalmar = () => hjalmarDecision("CONTINUE", { nextPrompt: "x" });
    const p = await respond(h, start, eic({ nextSuggestedAction: "Slice 2: verify the parser." }));
    assert.equal(p.phase, "SENDING", `${JSON.stringify(options.availability)} ${JSON.stringify(p.lastError)}`);
    assert.equal(p.pendingPrompt.a2a.objective, "Slice 2: verify the parser.");
  }
});

test("E2E CC-08: an EIC DONE with a pending operator instruction applies the instruction, then a later DONE closes", async () => {
  const t = clock();
  try {
  const { h, p: start } = await started();
  h.hjalmar = () => hjalmarDecision("DONE", { target: "DONE" });
  const instruction = await writeNextInstruction(start, "Also record the final checksum in the owner log.");
  let p = await respond(h, start, eic({ status: "DONE", summary: "Closed.", nextSuggestedAction: "" }));
  assert.equal(p.phase, "SENDING", JSON.stringify(p.lastError));
  assert.equal(p.greenfieldControl.reason, "EIC_TERMINAL_DEFERRED_FOR_OPERATOR_INSTRUCTION");
  assert.equal(p.pendingPrompt.a2a.objective, TERMINAL_DEFERRED_CONTINUATION);
  assert.match(JSON.stringify(p.pendingPrompt.a2a), /Also record the final checksum in the owner log\./);
  assert.equal(await readNextInstruction(p.processId), null, "the instruction was consumed");
  assert.ok(instruction.instructionId);
  p = await sendUntilWaiting(h, p, t);
  p = await respond(h, p, eic({ status: "DONE", summary: "Closed after the instruction.", nextSuggestedAction: "" }));
  assert.equal(p.phase, "DONE");
  } finally { t.restore(); }
});

test("E2E no-delta in a queue: the slot is paused and the next runnable slot runs", async () => {
  const t = clock();
  try {
    const h = await harness({ extraExports: ["startMissionQueue", "tickRotating"] });
    await attachRealOffscreen(h);
    stubLanguageModel(h);
    h.chrome.tabs.reload = async () => {};
    h.chrome.tabs.update = (update => async (id, patch) => {
      if (patch?.url) h.page.url = patch.url;
      return update(id, patch);
    })(h.chrome.tabs.update);
    const worker = await ensureWorkerBinding(1);
    for (const gf of ["GF-941", "GF-942"]) {
      await addMissionWorkItem(1, `Projekt: 900 - Syntetiskt testprojekt - Gf: ${gf}.`, { storage: h.chrome.storage.local, workerId: worker.workerId, maxInteractions: 5 });
    }
    const root = "https://chatgpt.com/g/g-test-eic";
    Object.assign(h.page, { url: root, userCount: 0, assistantCount: 0, lastUserId: "", generating: false, composerReady: true, composerEmpty: true });
    h.tab.url = root;
    await h.mod.startMissionQueue({ windowId: 1 });
    let p = await loadProcessForWindow(1);
    for (let i = 0; i < 80 && p.phase !== "WAITING"; i += 1) {
      const tick = p.phase === "ROTATING" ? h.mod.tickRotating : p.phase === "SENDING" ? h.mod.tickSending : null;
      if (!tick) break;
      await tick(p);
      t.advance(4000);
      p = await loadProcessForWindow(1);
    }
    assert.equal(p.phase, "WAITING");
    const firstItemId = p.queueContext.itemId;
    h.hjalmar = () => hjalmarDecision("DONE", { target: "UNKNOWN" });
    p = await respond(h, p, "Objective met.");
    assert.equal(p.greenfieldControl.reason, "ADVISORY_DONE_WITHOUT_EIC_TERMINAL");
    p = await sendUntilWaiting(h, p, t);
    assert.equal(p.phase, "WAITING");
    const next = await respond(h, p, "Objective still met.");
    assert.notEqual(next.queueContext?.itemId, firstItemId, "the next slot was activated");
    const queue = await loadMissionWorkQueue(1, h.chrome.storage.local, { workerId: worker.workerId });
    const parked = queue.items.find((item) => item.itemId === firstItemId);
    assert.equal(parked.status, "PAUSED");
    assert.equal(parked.lastOutcome, "ADVISORY_NO_DELTA_PAUSED");
    assert.ok(parked.pauseUntilMs - Date.now() > 800_000 && parked.pauseUntilMs - Date.now() <= 900_000);
    assert.equal(parked.quantumProgress, 2, "quantum progress is preserved");
  } finally { t.restore(); }
});
