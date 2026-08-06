import test from "node:test";
import assert from "node:assert/strict";
import {
  CHATGPT_RESPONSE_STATES,
  advanceStableCompletion,
  classifyChatGptPage,
  detectBackgroundLanguage,
  normalizeStatusText
} from "../lib/chatgpt-state-classifier.mjs";
import {
  backgroundWaitAgeMs,
  enterBackgroundWait,
  leaveBackgroundWait,
  preserveBackgroundForSuspendedTab,
  refreshBackgroundWait,
  shouldApplyResponseTimeout
} from "../lib/background-wait-controller.mjs";
import { createRun, STATES } from "../lib/state-machine.mjs";

function run(now = 1000) {
  return createRun({
    windowId: 1,
    targetTabId: 2,
    conversationKey: "chatgpt.com:abc",
    maxAutonomousMode: true,
    now
  });
}

function page(overrides = {}) {
  return {
    supported: true,
    conversationKey: "chatgpt.com:abc",
    latestAssistantHash: "a1",
    latestAssistantComplete: false,
    assistantCount: 1,
    generating: false,
    taskFingerprint: "task-1",
    snapshotHash: "snap-1",
    backgroundSignals: {
      sourceClass: "TRUSTED_PAGE_CHROME",
      trusted: true,
      active: true,
      language: "sv",
      evidenceCodes: ["STRUCTURED_STATUS", "CANCEL_HIDE_PAIR", "SV_BACKGROUND_TEXT"],
      statusText: "Jag jobbar på din förfrågan. Arbetar i bakgrunden."
    },
    boundarySignals: {},
    ...overrides
  };
}

test("normaliserar svensk status deterministiskt", () => {
  assert.equal(normalizeStatusText("  Arbetar  i BAKGRUNDEN… "), "arbetar i bakgrunden");
});

test("svenska background-signaler klassificeras WAITING_BACKGROUND", () => {
  assert.equal(classifyChatGptPage(page()).state, CHATGPT_RESPONSE_STATES.WAITING_BACKGROUND);
});

test("engelska background-signaler klassificeras WAITING_BACKGROUND", () => {
  const p = page({
    backgroundSignals: {
      sourceClass: "TRUSTED_PAGE_CHROME",
      trusted: true,
      active: true,
      language: "en",
      evidenceCodes: ["STRUCTURED_STATUS", "PROGRESS_SEMANTICS", "EN_BACKGROUND_TEXT"],
      statusText: "I'm working on your request. Working in the background."
    }
  });
  assert.equal(classifyChatGptPage(p).state, CHATGPT_RESPONSE_STATES.WAITING_BACKGROUND);
});

test("språkdetektion känner svenska", () => {
  assert.equal(detectBackgroundLanguage({ statusText: "Behöver mer tid. Arbetar i bakgrunden" }), "sv");
});

test("språkdetektion känner engelska", () => {
  assert.equal(detectBackgroundLanguage({ statusText: "Needs more time. Working in the background" }), "en");
});

test("samma text i assistantsvar utan trusted struktur triggar inte background", () => {
  const p = page({
    latestAssistant: "Jag jobbar på din förfrågan. Arbetar i bakgrunden.",
    backgroundSignals: {
      sourceClass: "UNTRUSTED_CONTENT",
      trusted: false,
      active: false,
      statusText: "Jag jobbar på din förfrågan"
    },
    latestAssistantComplete: true
  });
  assert.equal(classifyChatGptPage(p).state, CHATGPT_RESPONSE_STATES.COMPLETE_STABLE);
});

test("trusted struktur utan tillräcklig signal fail-closed unknown", () => {
  const p = page({
    backgroundSignals: {
      sourceClass: "TRUSTED_PAGE_CHROME",
      trusted: true,
      active: false,
      evidenceCodes: ["STRUCTURED_STATUS"],
      statusText: "Status"
    }
  });
  assert.equal(classifyChatGptPage(p).state, CHATGPT_RESPONSE_STATES.UNKNOWN_RECONCILE);
});

test("foreground stop control klassificeras GENERATING_FOREGROUND", () => {
  const p = page({
    generating: true,
    backgroundSignals: { sourceClass: "TRUSTED_PAGE_CHROME", trusted: false, active: false }
  });
  assert.equal(classifyChatGptPage(p).state, CHATGPT_RESPONSE_STATES.GENERATING_FOREGROUND);
});


test("terminal EIC CONTINUE-trailer vinner över stale scoped stop control", () => {
  const p = page({
    latestAssistantComplete: true,
    latestAssistantHash: "final-continue",
    generating: false,
    backgroundSignals: { sourceClass: "TRUSTED_PAGE_CHROME", trusted: false, active: false },
    foregroundSignals: {
      active: false,
      scopedStopControl: true,
      streamingAssistant: false,
      composerBusy: false,
      protocolCompletionOverride: true,
      evidenceCodes: ["SCOPED_STOP_CONTROL", "TERMINAL_EIC_TRAILER", "PROTOCOL_COMPLETION_OVERRIDE"]
    }
  });
  const result = classifyChatGptPage(p);
  assert.equal(result.state, CHATGPT_RESPONSE_STATES.COMPLETE_PROTOCOL_OVERRIDE);
  assert.equal(result.confidence, "HIGH");
});

test("verklig streaming eller composer busy får inte överskrivas", () => {
  const p = page({
    latestAssistantComplete: false,
    generating: true,
    backgroundSignals: { sourceClass: "TRUSTED_PAGE_CHROME", trusted: false, active: false },
    foregroundSignals: {
      active: true,
      scopedStopControl: true,
      streamingAssistant: true,
      composerBusy: false,
      protocolCompletionOverride: false,
      evidenceCodes: ["ASSISTANT_STREAMING", "SCOPED_STOP_CONTROL"]
    }
  });
  assert.equal(classifyChatGptPage(p).state, CHATGPT_RESPONSE_STATES.GENERATING_FOREGROUND);
});

test("auth signal är hard state", () => {
  const p = page({ boundarySignals: { authenticationRequired: true } });
  assert.equal(classifyChatGptPage(p).state, CHATGPT_RESPONSE_STATES.AUTH_REQUIRED);
});

test("trusted cancellation klassificeras CANCELLED", () => {
  const p = page({ backgroundSignals: { ...page().backgroundSignals, active: false, cancelled: true } });
  assert.equal(classifyChatGptPage(p).state, CHATGPT_RESPONSE_STATES.CANCELLED);
});

test("trusted error klassificeras ERROR", () => {
  const p = page({ backgroundSignals: { ...page().backgroundSignals, active: false, error: true } });
  assert.equal(classifyChatGptPage(p).state, CHATGPT_RESPONSE_STATES.ERROR);
});

test("enter background clears normal TTL", () => {
  const initial = run();
  initial.responseDeadlineAt = 5000;
  const next = enterBackgroundWait(initial, page(), { active: false, windowId: 1 }, { now: 2000 });
  assert.equal(next.state, STATES.WAITING_BACKGROUND);
  assert.equal(next.responseDeadlineAt, null);
  assert.equal(next.timeoutSuspended, true);
});

test("background wait has no application TTL after many hours", () => {
  const next = enterBackgroundWait(run(0), page(), {}, { now: 1000 });
  assert.equal(shouldApplyResponseTimeout(next), false);
  assert.equal(backgroundWaitAgeMs(next, 1000 + 12 * 60 * 60 * 1000), 12 * 60 * 60 * 1000);
});

test("refresh background preserves original waitStartedAt", () => {
  const first = enterBackgroundWait(run(), page(), {}, { now: 2000 });
  const second = refreshBackgroundWait(first, page(), {}, { now: 9000 });
  assert.equal(second.waitStartedAt, first.waitStartedAt);
  assert.equal(second.lastBackgroundEvidenceAt, new Date(9000).toISOString());
});

test("discarded target remains logical WAITING_BACKGROUND", () => {
  const first = enterBackgroundWait(run(), page(), {}, { now: 2000 });
  const next = preserveBackgroundForSuspendedTab(first, { discarded: true, active: false }, { now: 3000 });
  assert.equal(next.state, STATES.WAITING_BACKGROUND);
  assert.equal(next.tabState.discarded, true);
  assert.equal(next.nextReconcileReason, "RECONCILE_ON_RESUME");
});

test("frozen target remains logical WAITING_BACKGROUND", () => {
  const first = enterBackgroundWait(run(), page(), {}, { now: 2000 });
  const next = preserveBackgroundForSuspendedTab(first, { frozen: true }, { now: 3000 });
  assert.equal(next.tabState.frozen, true);
  assert.equal(next.responseDeadlineAt, null);
});

test("leaving background requires transition back to response verification", () => {
  const first = enterBackgroundWait(run(), page(), {}, { now: 2000 });
  const next = leaveBackgroundWait(first, { now: 5000 });
  assert.equal(next.state, STATES.WAITING_FOR_RESPONSE);
  assert.equal(next.timeoutSuspended, false);
  assert.equal(next.nextReconcileReason, "VERIFY_STABLE_COMPLETION");
});

test("one completion snapshot is insufficient", () => {
  const c = advanceStableCompletion(null, {
    latestAssistantComplete: true,
    latestAssistantHash: "h",
    assistantCount: 2
  }, { now: 1000, settleMs: 2500 });
  assert.equal(c.stable, false);
  assert.equal(c.reads, 1);
});

test("two separated identical snapshots become stable", () => {
  const first = advanceStableCompletion(null, {
    latestAssistantComplete: true,
    latestAssistantHash: "h",
    assistantCount: 2
  }, { now: 1000, settleMs: 2500 });
  const second = advanceStableCompletion(first, {
    latestAssistantComplete: true,
    latestAssistantHash: "h",
    assistantCount: 2
  }, { now: 4000, settleMs: 2500 });
  assert.equal(second.stable, true);
});

test("partial response resets completion candidate", () => {
  assert.equal(advanceStableCompletion({ hash: "h", count: 2, reads: 1 }, {
    latestAssistantComplete: false,
    latestAssistantHash: "h",
    assistantCount: 2
  }), null);
});
