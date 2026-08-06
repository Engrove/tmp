/**
 * v0.10.11: the first test that executes `background.js`.
 *
 * Every earlier suite either imported a pure `lib/*.mjs` module or read
 * `background.js` as a string and asserted on its source text. 835 tests could
 * therefore pass while the very first live run stalled before sending a single
 * prompt. This file imports the service worker against a fake Chrome runtime and
 * drives the real chain:
 *
 *   START_WAITING → stable catch → deterministic dispatch → effect journal
 *                 → EIC_SUBMIT_PROMPT → ACK → WAITING_BASELINE_RESPONSE
 *
 * `page.submittedPrompts` is the only accepted proof of delivery, exactly as the
 * v0.10.11 delivery law requires: dispatch bookkeeping proves nothing.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { CONTENT_SCRIPT_VERSION } from "../lib/contracts.mjs";
import { createUiCommand } from "../lib/ui-contract.mjs";
import { deriveAttentionTarget } from "../lib/attention-router.mjs";
import { SESSION_CONTEXT_INIT_STATE } from "../lib/session-context-init.mjs";
import {
  createFakeChrome,
  createFakeIndexedDb,
  createFakePage,
  createTab
} from "./helpers/fake-chrome.mjs";

const WINDOW_ID = 9001;
const TAB_ID = 1001;

// v0.10.12: the fake bridge reports the version from the shipped content.js, not
// the contract. If those two drift apart again — as they did in v0.10.11 — the
// background rejects the bridge here exactly as it does in Chrome, and this
// suite fails instead of silently agreeing with itself.
const page = createFakePage();
const chrome = createFakeChrome({ onTabMessage: (tabId, message) => page.handle(message) });
chrome.__tabs.set(TAB_ID, createTab({ tabId: TAB_ID, windowId: WINDOW_ID }));
globalThis.chrome = chrome;
globalThis.indexedDB = createFakeIndexedDb();

// The service worker registers its listeners at import time.
await import("../background.js");

const listener = chrome.runtime.onMessage.listeners[0];
assert.ok(listener, "background.js måste registrera en runtime.onMessage-lyssnare");

function send(command, payload = {}) {
  return new Promise((resolve, reject) => {
    listener(createUiCommand({ command, windowId: WINDOW_ID, payload }), {}, (result) => {
      if (result?.ok === false) {
        reject(new Error(result.error?.message || JSON.stringify(result.error)));
        return;
      }
      resolve(result.uiSnapshot?.model || result);
    });
  });
}

function tick() {
  return new Promise((resolve) => {
    listener(
      { type: "EIC_OBSERVATION_DIRTY" },
      { tab: { windowId: WINDOW_ID, id: TAB_ID } },
      resolve
    );
  });
}

const settle = (ms = 90) => new Promise((resolve) => setTimeout(resolve, ms));

async function pump(cycles = 4, delayMs = 90) {
  for (let index = 0; index < cycles; index += 1) {
    await tick();
    await settle(delayMs);
  }
}

const snapshot = async () => send("GET_SNAPSHOT");

async function applicationLogEntries() {
  const result = await send("GET_APPLICATION_LOG");
  const log = result.data?.applicationLog || result.applicationLog || {};
  return (log.segments || []).flatMap((segment) => segment.entries || []);
}
const runState = async () => (await snapshot()).window?.run || {};
const auditTitles = async () => ((await snapshot()).audit || []).map((entry) => entry.title);

async function withClockOffset(offsetMs, body) {
  const realNow = Date.now;
  Date.now = () => realNow.call(Date) + offsetMs;
  try {
    return await body();
  } finally {
    Date.now = realNow;
  }
}

test("v0.10.11 runtime: background.js startar och armerar sin watchdog", async () => {
  await settle(150);
  assert.ok(chrome.__alarms.size >= 1, "watchdog-alarmet måste vara skapat");
  assert.ok(chrome.__storage.has("eicAutonomAgent.v106.runtime"));
  // v0.10.12: the harness bridge derives its version from the shipped content.js.
  // If that drifts from the contract, LINK_ACTIVE_TAB below fails exactly as it
  // did in the field, instead of the harness agreeing with itself.
  assert.equal(
    page.state().version,
    CONTENT_SCRIPT_VERSION,
    "content.js-literalen och CONTENT_SCRIPT_VERSION måste vara identiska"
  );
  await send("GET_SNAPSHOT");
  await send("LINK_ACTIVE_TAB");
  await send("SAVE_CONFIG", { config: { settleMs: 1 } });
  const model = await snapshot();
  assert.equal(model.window?.selectedTabId, TAB_ID);
});

test("v0.10.11 runtime: catch → dispatch → effekt → levererad prompt utan Nano", async () => {
  await send("START_WAITING");
  await pump(6);

  assert.equal(page.submittedPrompts.length, 1, "exakt en baselineprompt måste ha nått målsessionen");

  const run = await runState();
  assert.equal(run.sessionContextInit?.state, SESSION_CONTEXT_INIT_STATE.WAITING_BASELINE_RESPONSE);
  assert.ok(run.sessionContextInit?.baselinePromptDigest, "promptdigest måste vara journalförd");
  assert.equal(run.effectJournal.length, 1);

  const effect = run.effectJournal[0];
  assert.equal(effect.sessionContextBaseline, true);
  assert.equal(effect.status, "ACKED");
  assert.ok(effect.promptDigest);
  assert.ok(effect.submittedAt);
  assert.equal(effect.turnId, run.promptHistory[0].turnId);

  // The exported v0.10.10 state had all four of these empty while claiming to wait.
  assert.notEqual(run.currentTurn, null);
  assert.equal(run.currentTurn.kind, "SESSION_CONTEXT_BASELINE_REQUEST");
  assert.equal(run.promptHistory.length, 1);
  assert.equal(run.deterministicDispatchFailure ?? null, null);

  const titles = await auditTitles();
  assert.ok(titles.includes("Sessions-catch klar — kanonisk baselineprompt schemalagd"));
  assert.ok(titles.includes("Prompt levererad och kvitterad"));
});

test("v0.10.11 runtime: upprepade ticks skapar ingen andra baselineprompt", async () => {
  await pump(8);
  assert.equal(page.submittedPrompts.length, 1);
  const run = await runState();
  assert.equal(run.state, "WAITING_FOR_RESPONSE");
  assert.equal(run.sessionContextInit?.state, SESSION_CONTEXT_INIT_STATE.WAITING_BASELINE_RESPONSE);
});

test("v0.10.11 runtime: WAITING_FOR_RESPONSE bärs av en levererad tur", async () => {
  const run = await runState();
  // The v0.10.11 invariant is not "WAITING_FOR_RESPONSE ⇒ currentTurn" — takeover
  // legitimately waits for a response it did not cause — it is that a wait must
  // never rest on nothing. Here the wait is backed by a real delivered turn.
  const armed = Boolean(run.currentTurn) ||
    Boolean(run.pendingObservation) ||
    Boolean(run.pendingNanoRequest);
  assert.equal(armed, true);
  assert.equal(run.currentTurn.effectState, "ACKED");
});

test("v0.10.11 runtime: ett dispatchfel ägs, journalförs och återarmeras", async () => {
  // Fresh run against a target whose decision-freshness read fails.
  await send("STOP");
  await settle(120);
  page.replyAsAssistant("Ett nytt stabilt assistantsvar efter stoppet.");
  page.submittedPrompts.length = 0;
  page.failPageReadSources.add("nano-decision-freshness");

  await send("START_WAITING");
  await pump(8);

  assert.equal(page.submittedPrompts.length, 0, "ingen prompt får skickas när dispatchen fallerar");

  const run = await runState();
  const failure = run.deterministicDispatchFailure;
  assert.ok(failure, "dispatchfelet måste vara persisterat i run-state");
  assert.equal(failure.errorCode, "TARGET_PAGE_READ_FAILED");
  assert.ok(failure.errorDetail);
  assert.ok(failure.stackDigest);
  assert.equal(failure.source, "DETERMINISTIC_PROTOCOL");
  assert.ok(["REARMED", "RECONCILE_REQUIRED"].includes(failure.disposition));

  const titles = await auditTitles();
  assert.ok(
    titles.some((title) => title.startsWith("Deterministisk dispatch")),
    `förväntade en dispatch-auditpost, fick ${JSON.stringify(titles)}`
  );

  const dispatchEntries = (await applicationLogEntries())
    .filter((entry) => entry.event === "mission.deterministic.dispatch-failed");
  assert.ok(dispatchEntries.length >= 1, "felet måste finnas i applikationsloggen");
  assert.equal(dispatchEntries[0].data.errorCode, "TARGET_PAGE_READ_FAILED");
  assert.ok(["warning", "error"].includes(dispatchEntries[0].level));
});

test("v0.10.11 runtime: återarmeringsbudgeten är bounded och inte oändlig", async () => {
  await pump(10);
  const run = await runState();
  assert.ok(
    Number(run.deterministicDispatchRearms || 0) <= 2,
    `återarmeringar måste vara bounded, fick ${run.deterministicDispatchRearms}`
  );
  assert.equal(page.submittedPrompts.length, 0);
});

test("v0.10.11 runtime: en oleverererad observation bokförs inte som processad", async () => {
  const run = await runState();
  // The failed generation never produced an effect, so the response identity must
  // stay reconcilable. In v0.10.10 it was consumed here, which is what made the
  // resume plan's "changed response identity" requirement unsatisfiable — the
  // agent was told to wait for evidence only it could have produced.
  assert.equal(run.effectJournal.length, 0, "inget levererat effektkvitto ska finnas");

  const observedHash = String(run.responseCandidate?.hash || "");
  assert.ok(observedHash, "en observation måste ha setts för att testet ska vara meningsfullt");
  assert.notEqual(
    run.lastProcessedAssistantHash,
    observedHash,
    "hashen för en oskickad observation får inte markeras som processad"
  );
  assert.ok(
    !String(run.lastProcessedResponseIdentity || "").includes(observedHash),
    "response identity för en oskickad observation får inte konsumeras"
  );
});

test("v0.10.11 runtime: en stannad initieringsfas failar synligt i stället för att vänta för evigt", async () => {
  await withClockOffset(130_000, async () => {
    await pump(3, 120);
  });

  const run = await runState();
  assert.equal(run.sessionContextInit?.state, SESSION_CONTEXT_INIT_STATE.FAILED);
  assert.ok(run.sessionContextInit?.failureCode);
  assert.match(run.sessionContextInit?.error || "", /prompt/i);
  assert.equal(run.state, "PROGRAM_BLOCKED");
  assert.equal(run.pause?.origin, "INTERNAL_INVARIANT");
  assert.equal(page.submittedPrompts.length, 0);

  const titles = await auditTitles();
  assert.ok(titles.includes("Sessionsinitiering misslyckades — ingen prompt skickades"));

  const attention = deriveAttentionTarget({ windowContext: { run } });
  assert.equal(attention.id, "SESSION_CONTEXT_INIT_FAILED");
  assert.equal(attention.tone, "CRITICAL");
});

test("v0.10.11 runtime: ett misslyckat init spinner inte tillbaka till RECOVERING", async () => {
  const before = await runState();
  await pump(5);
  const after = await runState();
  assert.equal(after.state, "PROGRAM_BLOCKED");
  assert.equal(after.sessionContextInit?.state, SESSION_CONTEXT_INIT_STATE.FAILED);
  // A stuck-but-blocked run must not burn storage revisions on every tick.
  assert.ok(
    Number(after.stateRevision) - Number(before.stateRevision) <= 1,
    `PROGRAM_BLOCKED får inte generera revisionsspin (${before.stateRevision} → ${after.stateRevision})`
  );
});

test("v0.10.11 runtime: operatörens Försök igen levererar baselineprompten", async () => {
  page.failPageReadSources.clear();
  await send("RETRY_SESSION_CONTEXT_INIT");
  await settle(120);

  let run = await runState();
  // The retry re-arms from phase 1 and immediately re-ticks, so by the time the
  // snapshot is read the chain may already have advanced. What must hold is that
  // it left FAILED, left PROGRAM_BLOCKED, and counted the attempt.
  assert.notEqual(run.sessionContextInit?.state, SESSION_CONTEXT_INIT_STATE.FAILED);
  assert.equal(run.sessionContextInit?.recoveryAttempts, 1);
  assert.equal(run.sessionContextInit?.failureCode, "");
  assert.notEqual(run.state, "PROGRAM_BLOCKED");
  assert.ok((await auditTitles()).includes("Sessionsinitiering återarmerad av operatören"));

  await pump(8);

  assert.equal(page.submittedPrompts.length, 1, "återförsöket måste leverera exakt en baselineprompt");
  run = await runState();
  assert.equal(run.sessionContextInit?.state, SESSION_CONTEXT_INIT_STATE.WAITING_BASELINE_RESPONSE);
  assert.equal(run.effectJournal.length, 1);
  assert.equal(run.effectJournal[0].status, "ACKED");
  assert.equal(run.deterministicDispatchFailure ?? null, null);
});

test("v0.10.11 runtime: inget prompt-kritiskt fel når bara service worker-konsolen", async () => {
  // Regression guard for the v0.10.10 root cause: `applyNanoDecisionCommand`
  // referenced `applicationLog` without destructuring it, so every deterministic
  // decision threw a ReferenceError into `.catch(console.warn)`.
  const referenceErrors = (await applicationLogEntries()).filter((entry) =>
    /is not defined/i.test(JSON.stringify(entry.data || {})));
  assert.deepEqual(referenceErrors, [], "ReferenceError på den prompt-kritiska vägen är en regression");
  assert.equal(page.submittedPrompts.length, 1);
});
