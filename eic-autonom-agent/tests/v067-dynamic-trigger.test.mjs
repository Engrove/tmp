import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  assistantResponseIdentity,
  isAssistantResponseCandidate,
  waitingBaselinePolicy
} from "../lib/response-trigger.mjs";
import {
  CHATGPT_RESPONSE_STATES,
  classifyChatGptPage
} from "../lib/chatgpt-state-classifier.mjs";
import { advanceResponseCandidate } from "../lib/state-machine.mjs";

function snapshot(overrides = {}) {
  return {
    conversationKey: "chatgpt.com:c:conversation-1",
    taskFingerprint: "task-1",
    documentEpoch: "epoch-1",
    latestMessageRole: "assistant",
    latestAssistantHash: "assistant-hash-1",
    latestAssistantCandidate: true,
    latestAssistantComplete: false,
    assistantCount: 2,
    generating: true,
    foregroundSignals: {
      active: true,
      hardActive: false,
      softActive: true,
      stopControlVisible: true,
      streamingAssistant: false,
      composerBusy: true,
      dynamicCompletionCandidate: true,
      protocolCompletionOverride: false,
      evidenceCodes: [
        "VISIBLE_SCOPED_STOP_CONTROL",
        "COMPOSER_BUSY",
        "LATEST_ASSISTANT_HASH_CANDIDATE"
      ]
    },
    backgroundSignals: {
      sourceClass: "TRUSTED_PAGE_CHROME",
      trusted: false,
      active: false,
      cancelled: false,
      error: false,
      evidenceCodes: []
    },
    boundarySignals: {},
    ...overrides
  };
}

test("v0.6.7: stale Stop/composer busy cannot suppress a stable assistant candidate", () => {
  const page = snapshot();
  assert.equal(isAssistantResponseCandidate(page), true);
  const classified = classifyChatGptPage(page);
  assert.equal(classified.state, CHATGPT_RESPONSE_STATES.COMPLETE_DYNAMIC_CANDIDATE);

  let advanced = advanceResponseCandidate(null, page, {
    now: 1000,
    settleMs: 2500,
    minimumReads: 2
  });
  assert.equal(advanced.settled, false);

  advanced = advanceResponseCandidate(advanced.candidate, page, {
    now: 4000,
    settleMs: 2500,
    minimumReads: 2
  });
  assert.equal(advanced.settled, true);
});

test("v0.6.7: real assistant streaming remains non-triggering", () => {
  const page = snapshot({
    latestAssistantCandidate: false,
    foregroundSignals: {
      ...snapshot().foregroundSignals,
      hardActive: true,
      streamingAssistant: true,
      dynamicCompletionCandidate: false
    }
  });
  assert.equal(isAssistantResponseCandidate(page), false);
  assert.equal(
    classifyChatGptPage(page).state,
    CHATGPT_RESPONSE_STATES.GENERATING_FOREGROUND
  );
});

test("v0.6.7: latest user prompt never reprocesses the previous assistant", () => {
  const page = snapshot({
    latestMessageRole: "user",
    latestMessageHash: "user-hash-2",
    latestAssistantCandidate: false,
    latestAssistantComplete: false,
    generating: false,
    foregroundSignals: {
      active: false,
      hardActive: false,
      softActive: false,
      stopControlVisible: false,
      streamingAssistant: false,
      composerBusy: false,
      dynamicCompletionCandidate: false,
      protocolCompletionOverride: false,
      evidenceCodes: []
    }
  });
  assert.equal(isAssistantResponseCandidate(page), false);
  assert.equal(assistantResponseIdentity(page), "");
  assert.equal(waitingBaselinePolicy(page).waitForAssistant, true);
  assert.equal(
    classifyChatGptPage(page).reason,
    "LATEST_MESSAGE_IS_USER_WAIT_FOR_ASSISTANT"
  );
  assert.deepEqual(
    advanceResponseCandidate(null, page, { now: 1000 }),
    { candidate: null, settled: false }
  );
});

test("v0.6.7: WAITING arms an existing assistant answer at activation", () => {
  const policy = waitingBaselinePolicy(snapshot({
    latestAssistantComplete: true,
    generating: false,
    foregroundSignals: {
      ...snapshot().foregroundSignals,
      active: false,
      softActive: false,
      stopControlVisible: false,
      composerBusy: false
    }
  }));
  assert.equal(policy.latestMessageRole, "assistant");
  assert.equal(policy.armCurrentAssistant, true);
  assert.equal(policy.waitForAssistant, false);
});

test("v0.6.7: response identity includes the user task only after an assistant turn exists", () => {
  const assistantA = snapshot({
    taskFingerprint: "user-task-a",
    latestAssistantHash: "same-text-hash"
  });
  const assistantB = snapshot({
    taskFingerprint: "user-task-b",
    latestAssistantHash: "same-text-hash"
  });
  assert.notEqual(
    assistantResponseIdentity(assistantA),
    assistantResponseIdentity(assistantB)
  );

  const userOnly = snapshot({
    latestMessageRole: "user",
    latestAssistantCandidate: false
  });
  assert.equal(assistantResponseIdentity(userOnly), "");
});

test("v0.6.7: browser entrypoints wire role-first dynamic triggering without trailer dependency", () => {
  const content = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
  const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");

  assert.match(content, /function getLatestConversationMessage/);
  assert.match(content, /latestMessageRole/);
  assert.match(content, /latestAssistantCandidate/);
  assert.match(content, /LATEST_ASSISTANT_HASH_CANDIDATE/);

  assert.match(background, /waitingBaselinePolicy\(page\)/);
  assert.match(background, /assistantResponseIdentity\(page\)/);
  assert.match(background, /isAssistantResponseCandidate\(page\)/);
  assert.match(background, /latestMessageIsAssistant\(page\)/);
  assert.match(background, /waiting-start-dynamic-evaluation/);
  assert.match(background, /scheduleResponseStabilityProbe\(windowId, remainingMs\)/);
  assert.match(background, /response-stability-probe/);
  assert.match(background, /protocolVariablesRequired:\s*false/);
});
