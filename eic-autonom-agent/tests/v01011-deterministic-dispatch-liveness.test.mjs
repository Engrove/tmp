import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DETERMINISTIC_CALLBACK_MAX_ATTEMPTS,
  DETERMINISTIC_CALLBACK_MAX_REARMS,
  DETERMINISTIC_GATE_ACTIONS,
  evaluateDeterministicDispatch,
  exhaustDeterministicDispatch,
  prepareDeterministicDispatch,
  rearmDeterministicDispatch
} from "../lib/deterministic-dispatch-gate.mjs";
import {
  SESSION_CONTEXT_INIT_FAILURE_CODE,
  SESSION_CONTEXT_INIT_MAX_OPERATOR_RETRIES,
  SESSION_CONTEXT_INIT_STALL_LIMIT_MS,
  SESSION_CONTEXT_INIT_STATE,
  advanceSessionContextInit,
  createSessionContextInit,
  evaluateSessionContextInitStall,
  failSessionContextInit,
  retrySessionContextInit,
  sessionContextInitBlocksWork,
  sessionContextInitOverlay,
  sessionContextInitRetryable
} from "../lib/session-context-init.mjs";
import {
  AUTO_CAPTURE_DEBOUNCE_MS,
  AUTO_CAPTURE_DEFER_BACKOFF_MAX_MS,
  autoCaptureDeferDelayMs
} from "../lib/auto-runtime-guards.mjs";
import { deriveAttentionTarget } from "../lib/attention-router.mjs";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, "..");
const source = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("v0.10.11 en återarmerad dispatchgeneration schemaläggs på nytt utan att ärva attempts", () => {
  const armed = {
    requestId: "nano-request-rearm",
    deterministicDispatchState: "ARMED",
    deterministicDispatchAttempts: 0
  };
  const dispatched = prepareDeterministicDispatch(armed, { decisionDigest: "d1", now: 1_000 });
  assert.equal(dispatched.deterministicDispatchAttempts, 1);
  assert.equal(evaluateDeterministicDispatch(dispatched, { now: 1_100 }).action,
    DETERMINISTIC_GATE_ACTIONS.WAIT);

  const rearmed = rearmDeterministicDispatch(dispatched);
  assert.equal(rearmed.requestId, "nano-request-rearm", "requestId måste bevaras för telemetribindning");
  assert.equal(rearmed.deterministicDispatchState, "ARMED");
  assert.equal(rearmed.deterministicDispatchAttempts, 0);
  assert.equal(rearmed.deterministicScheduledAt, null);
  assert.equal(rearmed.deterministicDecisionDigest, "");
  assert.equal(evaluateDeterministicDispatch(rearmed, { now: 1_100 }).action,
    DETERMINISTIC_GATE_ACTIONS.SCHEDULE);
});

test("v0.10.11 uttömd dispatch når RECOVER omedelbart utan att vänta ut ett lease", () => {
  const dispatched = prepareDeterministicDispatch({
    requestId: "nano-request-exhaust",
    deterministicDispatchState: "ARMED",
    deterministicDispatchAttempts: 0
  }, { decisionDigest: "d1", now: 1_000 });

  const exhausted = exhaustDeterministicDispatch(dispatched);
  const gate = evaluateDeterministicDispatch(exhausted, { now: 1_050 });
  assert.equal(gate.action, DETERMINISTIC_GATE_ACTIONS.RECOVER);
  assert.equal(gate.reason, "CALLBACK_ATTEMPTS_EXHAUSTED");
  assert.ok(exhausted.deterministicDispatchAttempts >= DETERMINISTIC_CALLBACK_MAX_ATTEMPTS);
});

test("v0.10.11 återarmeringsbudgeten är bounded och skild från lease-attempts", () => {
  assert.equal(DETERMINISTIC_CALLBACK_MAX_REARMS, 2);
  assert.equal(DETERMINISTIC_CALLBACK_MAX_ATTEMPTS, 2);
  assert.notEqual(DETERMINISTIC_CALLBACK_MAX_REARMS, 0);
});

test("v0.10.11 endast controller-ägda transientfaser är liveness-bundna", () => {
  const bounded = Object.keys(SESSION_CONTEXT_INIT_STALL_LIMIT_MS).sort();
  assert.deepEqual(bounded, [
    SESSION_CONTEXT_INIT_STATE.BASELINE_REQUEST_DISPATCHED,
    SESSION_CONTEXT_INIT_STATE.CATCH_CAPTURED
  ].sort());
  for (const unbounded of [
    SESSION_CONTEXT_INIT_STATE.WAITING_CHAT_READY,
    SESSION_CONTEXT_INIT_STATE.CATCH_ARMED,
    SESSION_CONTEXT_INIT_STATE.WAITING_BASELINE_RESPONSE,
    SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING
  ]) {
    const state = advanceSessionContextInit(
      createSessionContextInit({ runId: "r", now: 0 }), unbounded, {}, { now: 0 }
    );
    assert.equal(
      evaluateSessionContextInitStall(state, { now: 3_600_000 }).stalled,
      false,
      `${unbounded} får inte tidsbegränsas av controllern`
    );
  }
});

test("v0.10.11 CATCH_CAPTURED som inte lämnas i tid ger ett exakt stall-verdict", () => {
  const caught = advanceSessionContextInit(
    createSessionContextInit({ runId: "r", now: 0 }),
    SESSION_CONTEXT_INIT_STATE.CATCH_CAPTURED,
    {},
    { now: 0 }
  );
  const limit = SESSION_CONTEXT_INIT_STALL_LIMIT_MS[SESSION_CONTEXT_INIT_STATE.CATCH_CAPTURED];

  assert.equal(evaluateSessionContextInitStall(caught, { now: limit - 1 }).stalled, false);
  const verdict = evaluateSessionContextInitStall(caught, { now: limit });
  assert.equal(verdict.stalled, true);
  assert.equal(verdict.code, SESSION_CONTEXT_INIT_FAILURE_CODE.CATCH_HANDOFF_STALLED);
  assert.equal(verdict.limitMs, limit);
});

test("v0.10.11 stall-klockan startar om vid varje fasövergång", () => {
  const caught = advanceSessionContextInit(
    createSessionContextInit({ runId: "r", now: 0 }),
    SESSION_CONTEXT_INIT_STATE.CATCH_CAPTURED, {}, { now: 0 }
  );
  const limit = SESSION_CONTEXT_INIT_STALL_LIMIT_MS[SESSION_CONTEXT_INIT_STATE.CATCH_CAPTURED];
  const dispatched = advanceSessionContextInit(
    caught, SESSION_CONTEXT_INIT_STATE.BASELINE_REQUEST_DISPATCHED, {}, { now: limit - 1_000 }
  );
  assert.equal(evaluateSessionContextInitStall(dispatched, { now: limit }).stalled, false);
  assert.equal(evaluateSessionContextInitStall(dispatched, { now: limit * 2 }).stalled, true);
});

test("v0.10.11 FAILED tilldelas, är terminalt och bär en felkod", () => {
  const caught = advanceSessionContextInit(
    createSessionContextInit({ runId: "r", now: 0 }),
    SESSION_CONTEXT_INIT_STATE.CATCH_CAPTURED, {}, { now: 0 }
  );
  const failed = failSessionContextInit(caught, {
    code: SESSION_CONTEXT_INIT_FAILURE_CODE.CATCH_HANDOFF_STALLED,
    detail: "Fasen CATCH_CAPTURED slutfördes inte inom 120 s.",
    now: 200_000
  });
  assert.equal(failed.state, SESSION_CONTEXT_INIT_STATE.FAILED);
  assert.equal(failed.failureCode, SESSION_CONTEXT_INIT_FAILURE_CODE.CATCH_HANDOFF_STALLED);
  assert.match(failed.error, /CATCH_CAPTURED/);
  assert.ok(failed.completedAt);
  assert.equal(sessionContextInitBlocksWork(failed), true);

  // Terminal: an ordinary advance may not silently reopen it.
  const reopened = advanceSessionContextInit(failed, SESSION_CONTEXT_INIT_STATE.CATCH_CAPTURED);
  assert.equal(reopened.state, SESSION_CONTEXT_INIT_STATE.FAILED);
});

test("v0.10.11 operatörens återförsök är bounded och återarmerar från fas 1", () => {
  let init = failSessionContextInit(
    createSessionContextInit({ runId: "r", now: 0 }),
    { code: SESSION_CONTEXT_INIT_FAILURE_CODE.BASELINE_DISPATCH_FAILED, detail: "fel", now: 1 }
  );
  init.catchObservationId = "observation:abc";
  init.baselinePromptDigest = "digest";

  for (let attempt = 1; attempt <= SESSION_CONTEXT_INIT_MAX_OPERATOR_RETRIES; attempt += 1) {
    assert.equal(sessionContextInitRetryable(init), true);
    const retry = retrySessionContextInit(init, { now: attempt * 1_000 });
    assert.equal(retry.ok, true);
    assert.equal(retry.value.state, SESSION_CONTEXT_INIT_STATE.WAITING_CHAT_READY);
    assert.equal(retry.value.recoveryAttempts, attempt);
    assert.equal(retry.value.catchObservationId, "");
    assert.equal(retry.value.baselinePromptDigest, "");
    assert.equal(retry.value.completedAt, null);
    init = failSessionContextInit(retry.value, { detail: "fel igen", now: attempt * 1_000 + 1 });
  }
  assert.equal(sessionContextInitRetryable(init), false);
  assert.equal(retrySessionContextInit(init).ok, false);
});

test("v0.10.11 overlayfaserna är unikt numrerade och catch påstår inte komplett kontext", () => {
  const progresses = [
    SESSION_CONTEXT_INIT_STATE.WAITING_CHAT_READY,
    SESSION_CONTEXT_INIT_STATE.CATCH_ARMED,
    SESSION_CONTEXT_INIT_STATE.CATCH_CAPTURED,
    SESSION_CONTEXT_INIT_STATE.BASELINE_REQUEST_DISPATCHED,
    SESSION_CONTEXT_INIT_STATE.WAITING_BASELINE_RESPONSE,
    SESSION_CONTEXT_INIT_STATE.NANO_ANALYZING
  ].map((state) => sessionContextInitOverlay(
    advanceSessionContextInit(createSessionContextInit({ runId: "r" }), state)
  ).progress);
  assert.equal(new Set(progresses).size, progresses.length, "varje fas måste ha unik progress-etikett");

  const caught = sessionContextInitOverlay(advanceSessionContextInit(
    createSessionContextInit({ runId: "r" }), SESSION_CONTEXT_INIT_STATE.CATCH_CAPTURED
  ));
  assert.equal(caught.title, "Sessions-catch mottagen");
  assert.match(caught.detail, /inte komplett/i);
});

test("v0.10.11 ett misslyckat init exponerar retry-läge i overlayen", () => {
  const failed = failSessionContextInit(createSessionContextInit({ runId: "r" }), {
    code: SESSION_CONTEXT_INIT_FAILURE_CODE.BASELINE_DISPATCH_STALLED,
    detail: "Ingen prompt levererades."
  });
  const overlay = sessionContextInitOverlay(failed);
  assert.equal(overlay.visible, true);
  assert.equal(overlay.retryable, true);
  assert.equal(overlay.failureCode, SESSION_CONTEXT_INIT_FAILURE_CODE.BASELINE_DISPATCH_STALLED);
  assert.match(overlay.title, /kunde inte levereras/i);
});

test("v0.10.11 ett misslyckat init routas som kritiskt till operatören", () => {
  const failed = failSessionContextInit(createSessionContextInit({ runId: "r" }), {
    detail: "Ingen prompt levererades till målsessionen."
  });
  const target = deriveAttentionTarget({
    windowContext: { run: { sessionContextInit: failed } }
  });
  assert.equal(target.id, "SESSION_CONTEXT_INIT_FAILED");
  assert.equal(target.tone, "CRITICAL");
  assert.equal(target.anchorId, "sessionContextInitFailureCard");
});

test("v0.10.11 capture-defer backar av exponentiellt och mättas", () => {
  assert.equal(autoCaptureDeferDelayMs(0), AUTO_CAPTURE_DEBOUNCE_MS);
  assert.equal(autoCaptureDeferDelayMs(1), AUTO_CAPTURE_DEBOUNCE_MS * 2);
  assert.equal(autoCaptureDeferDelayMs(2), AUTO_CAPTURE_DEBOUNCE_MS * 4);
  assert.equal(autoCaptureDeferDelayMs(3), AUTO_CAPTURE_DEBOUNCE_MS * 8);
  assert.equal(autoCaptureDeferDelayMs(4), AUTO_CAPTURE_DEFER_BACKOFF_MAX_MS);
  assert.equal(autoCaptureDeferDelayMs(50), AUTO_CAPTURE_DEFER_BACKOFF_MAX_MS);
  assert.equal(autoCaptureDeferDelayMs(-3), AUTO_CAPTURE_DEBOUNCE_MS);

  // The 20 v0.10.10 cycles took ~50 s; the same wall time must now cost far fewer.
  let elapsed = 0;
  let cycles = 0;
  while (elapsed < 50_000) {
    elapsed += autoCaptureDeferDelayMs(cycles);
    cycles += 1;
  }
  assert.ok(cycles <= 6, `förväntade högst 6 cykler på 50 s, fick ${cycles}`);
});

test("v0.10.11 den detacherade deterministiska callbacken finns inte kvar i källan", () => {
  const background = source("background.js");
  assert.doesNotMatch(background, /scheduleDeterministicDecision/);
  assert.match(background, /async function applyNanoDecisionCommandUnlocked\(/);
  assert.match(background, /async function applyDeterministicDecisionInBand\(/);

  const inBand = background.match(/async function applyDeterministicDecisionInBand\([\s\S]*?\n\}/)?.[0] || "";
  assert.ok(inBand, "in-band-applikationen måste finnas");
  assert.doesNotMatch(inBand, /setTimeout/);
  assert.doesNotMatch(inBand, /\.catch\(console\.warn\)/);
  assert.match(inBand, /recordDeterministicDispatchFailureUnlocked/);
});

test("v0.10.11 dispatchfel ägs av run-state, audit och application log", () => {
  const background = source("background.js");
  assert.match(background, /run\.deterministicDispatchFailure = \{/);
  assert.match(background, /mission\.deterministic\.dispatch-failed/);
  for (const field of ["errorCode", "errorDetail", "stackDigest", "rearms", "disposition"]) {
    assert.match(background, new RegExp(field), `failure record saknar ${field}`);
  }
});

test("v0.10.11 en oleverererad observation får inte bokföras som processad", () => {
  const background = source("background.js");
  const block = background.match(
    /const exhaustedObservation = run\.pendingObservation;[\s\S]*?run\.pendingObservation = null;/
  )?.[0] || "";
  assert.ok(block, "exhausted-grenen måste finnas");
  assert.match(block, /if \(observationProducedDeliveredTurn\(run, exhaustedObservation\)\)/);
  const guardedLines = block.split("\n").filter((line) => line.includes("run.lastProcessed"));
  assert.equal(guardedLines.length, 4);
  for (const line of guardedLines) {
    assert.match(line, /^ {6}run\.lastProcessed/, "varje lastProcessed-skrivning måste ligga i guarden");
  }
});

test("v0.10.11 ett misslyckat init är människokrävande och blockerar spin", () => {
  const background = source("background.js");
  const block = background.match(/function pauseRequiresHuman\(run\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(block, /sessionContextInit\?\.state \|\| ""\) === "FAILED"/);
  assert.match(background, /function applySessionContextInitFailure\(/);
  assert.match(background, /STATES\.PROGRAM_BLOCKED, \{\s*origin: PAUSE_ORIGINS\.INTERNAL_INVARIANT/);
});
