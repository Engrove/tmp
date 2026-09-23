import test from "node:test";
import assert from "node:assert/strict";
import { PHASES } from "../lib/contracts.mjs";
import {
  createProcess,
  isCurrentToken,
  ownerToken,
  transitionProcess,
  withRecovery
} from "../lib/state.mjs";

test("process starts with one canonical owner in SENDING", () => {
  const p = createProcess({ windowId: 1, tabId: 2, goal: "g", initialPrompt: "p" });
  assert.equal(p.phase, PHASES.SENDING);
  assert.equal(p.generation, 1);
  assert.ok(p.processId);
  assert.ok(p.runId);
  assert.equal(p.objectiveState.status, "PENDING");
  assert.equal(p.lastNanoTask, null);
});

test("generation rejects stale callbacks", () => {
  const p = createProcess({ windowId: 1, tabId: 2, goal: "g", initialPrompt: "p" });
  const token = ownerToken(p, "op-1");
  assert.equal(isCurrentToken(p, token), true);
  const stopped = transitionProcess(p, PHASES.STOPPED, { generation: 2 });
  assert.equal(isCurrentToken(stopped, token), false);
});

test("illegal phase jump is rejected", () => {
  const p = createProcess({ windowId: 1, tabId: 2, goal: "g", initialPrompt: "p" });
  assert.throws(() => transitionProcess(p, PHASES.DONE), /ILLEGAL_TRANSITION/);
});

test("transient recovery has no fatal retry budget", () => {
  let p = createProcess({ windowId: 1, tabId: 2, goal: "g", initialPrompt: "p" });
  for (let i = 0; i < 50; i += 1) {
    const source = p.phase === PHASES.RECOVERING
      ? transitionProcess(p, PHASES.SENDING)
      : p;
    p = withRecovery(source, { reason: "TRANSIENT", recoverTo: PHASES.SENDING });
    assert.equal(p.phase, PHASES.RECOVERING);
  }
  assert.equal(p.recovery.attempts >= 1, true);
});


test("DONE is reached from ANALYZING controller decision, never directly from WAITING protocol metadata", () => {
  let p = createProcess({ windowId: 1, tabId: 2, goal: "g", initialPrompt: "p" });
  p = transitionProcess(p, PHASES.WAITING);
  assert.throws(() => transitionProcess(p, PHASES.DONE), /ILLEGAL_TRANSITION:WAITING->DONE/);
  p = transitionProcess(p, PHASES.ANALYZING);
  p = transitionProcess(p, PHASES.DONE);
  assert.equal(p.phase, PHASES.DONE);
});


test("ROTATING is non-terminal and invalidates prior generation ownership", () => {
  let p = createProcess({
    windowId: 1,
    tabId: 2,
    goal: "g",
    initialPrompt: "p",
    gptRoot: "https://chatgpt.com/g/g-example"
  });
  const old = ownerToken(p, "old");
  p = transitionProcess(p, PHASES.ROTATING, { generation: 2, sessionSeq: 2 });
  assert.equal(p.completedAt, null);
  assert.equal(isCurrentToken(p, old), false);
  p = transitionProcess(p, PHASES.SENDING);
  assert.equal(p.phase, PHASES.SENDING);
});

test("process persists GPT root and starts at session sequence 1", () => {
  const p = createProcess({
    windowId: 1,
    tabId: 2,
    goal: "g",
    initialPrompt: "p",
    gptRoot: "https://chatgpt.com/g/g-example"
  });
  assert.equal(p.gptRoot, "https://chatgpt.com/g/g-example");
  assert.equal(p.sessionSeq, 1);
  assert.equal(p.sessionRotation, null);
});
