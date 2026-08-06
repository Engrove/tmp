import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SESSION_CONTEXT_INIT_STATE,
  advanceSessionContextInit,
  createSessionContextInit,
  sessionContextInitBlocksWork,
  sessionContextInitOverlay
} from "../lib/session-context-init.mjs";
import {
  MAIN_TASK_BASELINE_REQUEST_PROMPT
} from "../lib/main-task-guard.mjs";
import { buildDeterministicDecision } from "../lib/fallback-planner.mjs";
import { validateNanoDecisionGrounding } from "../lib/nano-pipeline.mjs";
import { validateStopCriteria } from "../lib/task-integrity.mjs";
import { createRun } from "../lib/state-machine.mjs";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, "..");
const source = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("v0.10.10 every new run begins behind the session-context gate", () => {
  const run = createRun({ windowId: 1, targetTabId: 2, conversationKey: "chat:c" });
  assert.equal(run.schema, "eic.autonom.run.v11");
  assert.equal(run.sessionContextInit.state, SESSION_CONTEXT_INIT_STATE.WAITING_CHAT_READY);
  assert.equal(sessionContextInitBlocksWork(run.sessionContextInit), true);
});

test("v0.10.10 session initialization has an explicit ordered catch-to-Nano lifecycle", () => {
  let state = createSessionContextInit({ runId: "r1", conversationKey: "chat:c" });
  for (const next of [
    SESSION_CONTEXT_INIT_STATE.CATCH_ARMED,
    SESSION_CONTEXT_INIT_STATE.CATCH_CAPTURED,
    SESSION_CONTEXT_INIT_STATE.BASELINE_REQUEST_DISPATCHED,
    SESSION_CONTEXT_INIT_STATE.WAITING_BASELINE_RESPONSE,
    SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING,
    SESSION_CONTEXT_INIT_STATE.READY
  ]) {
    state = advanceSessionContextInit(state, next);
    assert.equal(state.state, next);
  }
  assert.equal(sessionContextInitBlocksWork(state), false);
  assert.ok(state.completedAt);
});

test("v0.10.10 overlay dismissal is scoped to one phase need key", () => {
  const base = createSessionContextInit({ runId: "r2", conversationKey: "chat:c" });
  const waiting = sessionContextInitOverlay(base);
  const caught = sessionContextInitOverlay(
    advanceSessionContextInit(base, SESSION_CONTEXT_INIT_STATE.CATCH_CAPTURED)
  );
  assert.notEqual(waiting.needKey, caught.needKey);
  assert.match(waiting.title, /sessionskontext/i);
  assert.match(caught.detail, /fångats/i);
});

test("v0.10.10 missing baseline produces the exact deterministic canonical prompt", () => {
  const observation = {
    mainTaskBaselineRequired: true,
    responseText: "Ett stabilt assistantsvar observerades.",
    conversationExcerpt: "Aktuell session.",
    targetResult: { valid: false, reason: "MAIN_TASK_BASELINE_REQUIRED" }
  };
  const projection = {
    intent: "",
    position: { workUnit: "" },
    verifiedFacts: [],
    targetClaims: [],
    inferences: [],
    blockers: [],
    nextDirections: [],
    evidenceRequirements: [],
    mainTaskBaseline: null
  };
  const decision = buildDeterministicDecision({
    run: {
      runId: "run-x",
      targetTabId: 7,
      conversationKey: "chat:c",
      pendingNanoRequest: {},
      nanoTelemetry: {}
    },
    observation,
    continuityProjection: projection,
    requestMode: "TAKEOVER_BOOTSTRAP"
  });
  assert.equal(decision.requestedAction, MAIN_TASK_BASELINE_REQUEST_PROMPT);
  assert.equal(decision.trackControl.correctionPrompt, MAIN_TASK_BASELINE_REQUEST_PROMPT);
  assert.equal(decision.trackControl.status, "BASELINE_REQUESTED");
  assert.equal(decision.requiredControl, true);
  assert.equal(decision.directProgramDelta, 0);
  const grounding = validateNanoDecisionGrounding(decision, {
    analysisMode: "TAKEOVER_BOOTSTRAP",
    continuityProjection: projection,
    observation
  });
  assert.deepEqual(grounding.errors, []);
  assert.equal(grounding.valid, true);
});

test("v0.10.10 deterministic recovery uses state-shaped stop criteria", () => {
  const decision = buildDeterministicDecision({
    run: { targetTabId: 7, conversationKey: "chat:c", pendingNanoRequest: {}, nanoTelemetry: {} },
    observation: {
      responseText: "Ett svar",
      conversationExcerpt: "Kontext",
      targetResult: { valid: false, reason: "PROTOCOL_MISSING" }
    },
    continuityProjection: {
      intent: "",
      position: { workUnit: "" },
      verifiedFacts: [],
      targetClaims: [],
      inferences: [],
      blockers: []
    },
    requestMode: "TAKEOVER_BOOTSTRAP"
  });
  assert.doesNotThrow(() => validateStopCriteria(decision.stopCriteria));
  assert.throws(
    () => validateStopCriteria(["Aktivera Nano och återuppta den bevarade observationen."]),
    /STOP_CRITERION_IS_ACTION/
  );
});

test("v0.10.10 manual and autostart mission commands converge on the same gate", () => {
  const background = source("background.js");
  assert.match(background, /Every manual and automatic start shares the same session-context gate/);
  assert.match(background, /return startWaiting\(windowId, continuationRequest, \{\s*deferredMissionStart:/s);
  assert.match(background, /sessionContextInitBlocksWork\(run\.sessionContextInit\)/);
});

test("v0.10.10 deterministic fast paths cannot bypass baseline Nano analysis", () => {
  const background = source("background.js");
  assert.match(background, /sessionInitNeedsNano/);
  assert.match(background, /!sessionInitNeedsNano/);
  assert.match(background, /SESSION_CONTEXT_INIT_STATE\.NANO_ANALYZING/);
});

test("v0.10.10 ChatGPT overlay is closable, phase-scoped and excluded from transcript scans", () => {
  const content = source("content.js");
  assert.match(content, /eic-autonom-agent-process-overlay/);
  assert.match(content, /data-eic-own-ui/);
  assert.match(content, /overlayDismissKey/);
  assert.match(content, /sessionStorage\.setItem/);
  assert.match(content, /needKey/);
  assert.match(content, /\[data-eic-own-ui='true'\]/);
});

test("v0.10.10 Nano stream has a bounded material-output idle watchdog", () => {
  const panel = source("sidepanel.js");
  assert.match(panel, /NANO_STREAM_IDLE_TIMEOUT_MS = 60_000/);
  assert.match(panel, /HOST_STREAM_STALLED/);
  assert.match(panel, /NanoStreamStalledError/);
  assert.match(panel, /const maxAttempts = telemetryOptions\?\.disableFreshTaskRetry \? 1 : 2/);
});

test("v0.10.10 sidepanel attention names session-context initialization", () => {
  const attention = source("lib/attention-router.mjs");
  assert.match(attention, /SESSION_CONTEXT_INIT/);
  assert.match(attention, /Väntar på initiering av sessionskontext/);
  assert.match(attention, /catch, baseline och Nano-spårkontroll/);
});
