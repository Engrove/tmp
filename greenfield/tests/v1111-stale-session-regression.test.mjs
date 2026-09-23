import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  createWaitingRefreshState,
  evaluateWaitingRefresh,
  hasNewCompletedAssistantResponse,
  normalizeWaitingRefreshStage,
  resetWaitingRefreshOnAssistantResponse,
  WAITING_REFRESH_ACTIONS,
  WAITING_REFRESH_STAGES,
  WAITING_STALE_INTERVAL_MS
} from "../lib/waiting-refresh.mjs";

const MIN30 = WAITING_STALE_INTERVAL_MS;

function iso(ms) {
  return new Date(ms).toISOString();
}

test("v1.2.3 stale ladder is exactly 30m F5 -> 60m Ctrl-F5 -> 90m Ctrl-F5 -> 120m session rotation", () => {
  const base = Date.parse("2026-09-01T10:00:00.000Z");

  let r = evaluateWaitingRefresh({
    now: base + MIN30 - 1,
    staleSince: iso(base),
    acknowledged: true
  });
  assert.equal(r.action, WAITING_REFRESH_ACTIONS.WAIT);

  r = evaluateWaitingRefresh({
    now: base + MIN30,
    staleSince: iso(base),
    acknowledged: true
  });
  assert.equal(r.action, WAITING_REFRESH_ACTIONS.F5);
  assert.equal(r.stage, WAITING_REFRESH_STAGES.F5_30);
  assert.equal(r.code, "STALE_SESSION_30M_F5");

  r = evaluateWaitingRefresh({
    now: base + 2 * MIN30 - 1,
    staleSince: iso(base),
    acknowledged: true,
    stage: WAITING_REFRESH_STAGES.F5_30
  });
  assert.equal(r.action, WAITING_REFRESH_ACTIONS.WAIT);

  r = evaluateWaitingRefresh({
    now: base + 2 * MIN30,
    staleSince: iso(base),
    acknowledged: true,
    stage: WAITING_REFRESH_STAGES.F5_30
  });
  assert.equal(r.action, WAITING_REFRESH_ACTIONS.CTRL_F5);
  assert.equal(r.stage, WAITING_REFRESH_STAGES.CTRL_F5_60);
  assert.equal(r.code, "STALE_SESSION_60M_CTRL_F5");

  r = evaluateWaitingRefresh({
    now: base + 3 * MIN30 - 1,
    staleSince: iso(base),
    acknowledged: true,
    stage: WAITING_REFRESH_STAGES.CTRL_F5_60
  });
  assert.equal(r.action, WAITING_REFRESH_ACTIONS.WAIT);

  r = evaluateWaitingRefresh({
    now: base + 3 * MIN30,
    staleSince: iso(base),
    acknowledged: true,
    stage: WAITING_REFRESH_STAGES.CTRL_F5_60
  });
  assert.equal(r.action, WAITING_REFRESH_ACTIONS.CTRL_F5);
  assert.equal(r.stage, WAITING_REFRESH_STAGES.CTRL_F5_90);
  assert.equal(r.code, "STALE_SESSION_90M_CTRL_F5");

  r = evaluateWaitingRefresh({
    now: base + 4 * MIN30 - 1,
    staleSince: iso(base),
    acknowledged: true,
    stage: WAITING_REFRESH_STAGES.CTRL_F5_90
  });
  assert.equal(r.action, WAITING_REFRESH_ACTIONS.WAIT);

  r = evaluateWaitingRefresh({
    now: base + 4 * MIN30,
    staleSince: iso(base),
    acknowledged: true,
    stage: WAITING_REFRESH_STAGES.CTRL_F5_90
  });
  assert.equal(r.action, WAITING_REFRESH_ACTIONS.ROTATE);
  assert.equal(r.code, "STALE_SESSION_120M_ROTATE");
});

test("every completed assistant response resets stale time and stage regardless of response semantics", () => {
  const base = Date.parse("2026-09-01T10:00:00.000Z");
  const current = {
    stage: WAITING_REFRESH_STAGES.CTRL_F5_60,
    requestedAt: iso(base + 2 * MIN30),
    staleSince: iso(base),
    resetCount: 2,
    lastAssistantId: "assistant-old",
    assistantHash: "same-text-hash",
    assistantCount: 5,
    promptHash: "prompt-hash",
    turn: 8,
    bypassCache: true
  };

  // Identical response text/hash still counts as a new response because a new
  // assistant turn exists. Protocol/status is intentionally not an input.
  const reset = resetWaitingRefreshOnAssistantResponse({
    current,
    page: {
      lastAssistantId: "assistant-new",
      assistantHash: "same-text-hash",
      assistantCount: 6,
      generating: false
    },
    now: base + 95 * 60 * 1000,
    promptHash: "prompt-hash",
    turn: 8
  });

  assert.equal(reset.reset, true);
  assert.equal(reset.state.stage, "");
  assert.equal(reset.state.resetCount, 3);
  assert.equal(reset.state.staleSince, iso(base + 95 * 60 * 1000));

  const after = evaluateWaitingRefresh({
    now: base + 95 * 60 * 1000 + MIN30 - 1,
    staleSince: reset.state.staleSince,
    acknowledged: true,
    stage: reset.state.stage
  });
  assert.equal(after.action, WAITING_REFRESH_ACTIONS.WAIT);
});

test("streaming/generating output is not treated as a returned response until completion", () => {
  const marker = {
    lastAssistantId: "assistant-old",
    assistantHash: "old",
    assistantCount: 2
  };
  assert.equal(hasNewCompletedAssistantResponse({
    marker,
    page: {
      lastAssistantId: "assistant-new",
      assistantHash: "partial",
      assistantCount: 3,
      generating: true
    }
  }), false);

  assert.equal(hasNewCompletedAssistantResponse({
    marker,
    page: {
      lastAssistantId: "assistant-new",
      assistantHash: "complete",
      assistantCount: 3,
      generating: false
    }
  }), true);
});

test("reload-only DOM identity churn with same response count/hash does not reset stale time", () => {
  const marker = {
    lastAssistantId: "dom-id-before-reload",
    assistantHash: "stable-response-hash",
    assistantCount: 7
  };
  assert.equal(hasNewCompletedAssistantResponse({
    marker,
    page: {
      lastAssistantId: "dom-id-after-reload",
      assistantHash: "stable-response-hash",
      assistantCount: 7,
      generating: false
    }
  }), false);
});

test("legacy v1.1.10 in-flight refresh stages migrate monotonically", () => {
  assert.equal(normalizeWaitingRefreshStage("F5"), WAITING_REFRESH_STAGES.F5_30);
  assert.equal(normalizeWaitingRefreshStage("CTRL_F5"), WAITING_REFRESH_STAGES.CTRL_F5_60);
});

test("response-ready short-circuits stale escalation", () => {
  const base = Date.parse("2026-09-01T10:00:00.000Z");
  const r = evaluateWaitingRefresh({
    now: base + 10 * MIN30,
    staleSince: iso(base),
    acknowledged: true,
    responseComplete: true,
    stage: WAITING_REFRESH_STAGES.CTRL_F5_90
  });
  assert.equal(r.action, WAITING_REFRESH_ACTIONS.WAIT);
  assert.equal(r.code, "RESPONSE_READY");
});

test("waiting state captures a stale anchor and assistant baseline", () => {
  const state = createWaitingRefreshState({
    now: Date.parse("2026-09-01T10:00:00.000Z"),
    page: {
      lastAssistantId: "a-1",
      assistantHash: "h-1",
      assistantCount: 4
    },
    promptHash: "p-1",
    turn: 3
  });
  assert.equal(state.stage, "");
  assert.equal(state.lastAssistantId, "a-1");
  assert.equal(state.assistantHash, "h-1");
  assert.equal(state.assistantCount, 4);
  assert.equal(state.promptHash, "p-1");
  assert.equal(state.turn, 3);
});

test("background implements stale-only 30/60/90/120 escalation and protocol-agnostic reset", () => {
  const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(background, /maybeResetStaleSessionCounter\(process,\s*page\)/);
  assert.match(background, /STALE_SESSION_COUNTER_RESET/);
  assert.match(background, /ANY_COMPLETED_ASSISTANT_RESPONSE/);
  assert.match(background, /causalBindingRequiredForReset:\s*false/);
  assert.match(background, /protocolAgnostic:\s*true/);

  assert.match(background, /WAITING_F5_TRIGGERED/);
  assert.match(background, /WAITING_CTRL_F5_60_TRIGGERED/);
  assert.match(background, /WAITING_CTRL_F5_90_TRIGGERED/);
  assert.match(background, /WAITING_REFRESH_ESCALATION_ROTATE/);
  assert.match(background, /30M_F5_60M_CTRL_F5_90M_CTRL_F5_120M_ROTATE/);
  assert.match(background, /chrome\.tabs\.reload\(armed\.tabId,\s*\{\s*bypassCache\s*\}\)/);

  const escalationStart = background.indexOf("async function maybeEscalateWaitingRefresh");
  const escalationEnd = background.indexOf("async function tabState", escalationStart);
  const escalation = background.slice(escalationStart, escalationEnd);
  assert.match(escalation, /process\.phase !== PHASES\.WAITING/);
});

test("stale ladder remains available at all unresolved WAIT exits but not as RECOVERING policy", () => {
  const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  const waitingStart = background.indexOf("async function tickWaiting");
  const waitingEnd = background.indexOf("async function ensureOffscreenAnalyzer", waitingStart);
  const waiting = background.slice(waitingStart, waitingEnd);
  const calls = waiting.match(/maybeEscalateWaitingRefresh\(/g) || [];
  assert.ok(calls.length >= 3, `expected stale escalation at unresolved WAIT exits, got ${calls.length}`);
  assert.match(waiting, /AUTONOMOUS_RESPONSE_STILL_GENERATING/);
  assert.match(waiting, /RESPONSE_STABILITY_/);

  const recoveryStart = background.indexOf("async function tickRecovering");
  if (recoveryStart >= 0) {
    const nextFn = background.indexOf("\nasync function ", recoveryStart + 1);
    const recovery = background.slice(recoveryStart, nextFn > recoveryStart ? nextFn : undefined);
    assert.doesNotMatch(recovery, /maybeEscalateWaitingRefresh/);
  }
});
