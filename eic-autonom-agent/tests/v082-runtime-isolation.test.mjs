import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  EXPORT_SCHEMA,
  EXPORT_VERSION,
  NANO_WALL_TIMEOUT_MS,
  RUN_MODES
} from "../lib/contracts.mjs";
import {
  applyNanoDecision,
  createContinuity,
  projectContinuity,
  seedContinuityFromStartAnalysis
} from "../lib/continuity.mjs";
import {
  bindContinuityScope,
  cloneSpecializedRunState,
  continuityScopeWindowId,
  initializeWindowContinuity,
  rootContinuityAdoptionDecision,
  promoteContinuityConversation,
  resolveStickyRunMode
} from "../lib/scoped-continuity.mjs";
import { responseEligibleForNano } from "../lib/response-completion-policy.mjs";
import { reconcileStartPromptReceipts } from "../lib/start-receipt-reconcile.mjs";

const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
const panel = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");

test("unscoped continuity never aliases Chrome window 0", () => {
  const continuity = createContinuity();
  assert.equal(continuity.scope.windowId, null);
  assert.equal(continuityScopeWindowId(continuity), null);
  assert.equal(continuityScopeWindowId({ scope: { windowId: null } }), null);
});

test("v0.8.2 scopes continuity independently per window and exact legacy locator", () => {
  const legacy = createContinuity({ intent: "Legacy research intent" });
  legacy.position.conversationKey = "chatgpt.com:c:alpha";

  const runtime = {
    windows: {
      "10": { windowId: 10, linkedTabs: { "101": { conversationKey: "chatgpt.com:c:alpha" } } },
      "20": { windowId: 20, linkedTabs: { "201": { conversationKey: "chatgpt.com:c:beta" } } }
    }
  };
  const first = initializeWindowContinuity(runtime.windows["10"], legacy, runtime, { windowId: 10 });
  const second = initializeWindowContinuity(runtime.windows["20"], legacy, runtime, { windowId: 20 });

  assert.equal(first.adoptedRoot, true);
  assert.equal(first.continuity.intent.text, "Legacy research intent");
  assert.equal(first.continuity.scope.windowId, 10);
  assert.equal(second.adoptedRoot, false);
  assert.equal(second.continuity.intent.text, "");
  assert.equal(second.continuity.scope.windowId, 20);

  second.continuity.intent.text = "Independent beta intent";
  assert.equal(first.continuity.intent.text, "Legacy research intent");
});

test("legacy continuity with a mismatched locator is never adopted by a sole window", () => {
  const legacy = createContinuity({ intent: "Foreign intent" });
  legacy.position.conversationKey = "chatgpt.com:c:foreign";
  const context = {
    windowId: 7,
    linkedTabs: { "71": { conversationKey: "chatgpt.com:c:current" } }
  };
  const decision = rootContinuityAdoptionDecision(legacy, context, { windows: { "7": context } });
  assert.equal(decision.adopt, false);
  assert.equal(decision.reason, "NO_EXACT_WINDOW_MATCH");
});

test("TAKEOVER_BOOTSTRAP cannot overwrite an established start-analysis intent", () => {
  const seeded = seedContinuityFromStartAnalysis(createContinuity(), {
    taskIntent: "RESEARCH_INTENT",
    firstWorkUnit: "Inspect one source read-only.",
    constraints: [],
    risks: [],
    requiredEvidence: []
  }, {
    conversationKey: "chatgpt.com:g:eic",
    taskFingerprint: "task-research",
    now: 1000
  });

  const next = applyNanoDecision(seeded, {
    analysisMode: "TAKEOVER_BOOTSTRAP",
    intent: "FOREIGN_RELEASE_INTENT",
    conversationKey: "chatgpt.com:c:research",
    taskFingerprint: "task-research",
    action: "CONTINUE",
    requestedAction: "Read one source."
  }, { turnIndex: 1, now: 2000 });

  assert.equal(next.intent.text, "RESEARCH_INTENT");
  assert.equal(next.intent.setBy, "nano-start-analysis");
  assert.ok(next.inferences.some((entry) =>
    entry.provenance === "local-intent-ownership-gate" &&
    /Takeover-intent avvisades/.test(entry.claim)
  ));
});

test("g-to-c locator promotion preserves intent and updates scoped position", () => {
  const source = bindContinuityScope(createContinuity({ intent: "Research" }), {
    windowId: 11,
    runId: "run-11",
    conversationKey: "chatgpt.com:g:eic"
  });
  source.position.conversationKey = "chatgpt.com:g:eic";
  const promoted = promoteContinuityConversation(source, {
    from: "chatgpt.com:g:eic",
    to: "chatgpt.com:c:conversation-11",
    taskFingerprint: "task-11"
  });
  assert.equal(promoted.changed, true);
  assert.equal(promoted.continuity.intent.text, "Research");
  assert.equal(promoted.continuity.position.conversationKey, "chatgpt.com:c:conversation-11");
  assert.equal(promoted.continuity.scope.conversationKey, "chatgpt.com:c:conversation-11");
});

test("specialized run mode is sticky only for the same tab and conversation", () => {
  const prior = {
    runId: "arch-1",
    mode: RUN_MODES.ARCHAEOLOGY_LONG,
    targetTabId: 42,
    conversationKey: "chatgpt.com:c:arch",
    archaeologyQuestion: "What does this code do?",
    archaeology: { phase: "SOURCE_INVENTORY" },
    destructivenessCeiling: 4
  };
  const sticky = resolveStickyRunMode(prior, {
    tabId: 42,
    conversationKey: "chatgpt.com:c:arch"
  });
  assert.equal(sticky.preserve, true);
  assert.equal(sticky.mode, RUN_MODES.ARCHAEOLOGY_LONG);

  const resumed = cloneSpecializedRunState({ runId: "arch-2" }, prior);
  assert.equal(resumed.mode, RUN_MODES.ARCHAEOLOGY_LONG);
  assert.equal(resumed.archaeologyQuestion, prior.archaeologyQuestion);
  assert.deepEqual(resumed.archaeology, prior.archaeology);

  const changed = resolveStickyRunMode(prior, {
    tabId: 43,
    conversationKey: "chatgpt.com:c:arch"
  });
  assert.equal(changed.blocked, true);
  assert.equal(changed.reason, "SPECIALIZED_TARGET_TAB_CHANGED");
});

test("specialized modes reject temporarily stable incomplete responses", () => {
  const specialized = { mode: RUN_MODES.ARCHAEOLOGY_LONG };
  assert.deepEqual(
    responseEligibleForNano(specialized, {
      latestAssistantComplete: false,
      foregroundSignals: { protocolCompletionOverride: false }
    }),
    { eligible: false, reason: "SPECIALIZED_MODE_REQUIRES_CONFIRMED_COMPLETION" }
  );
  assert.equal(responseEligibleForNano(specialized, {
    latestAssistantComplete: true
  }).eligible, true);
  assert.equal(responseEligibleForNano(specialized, {
    foregroundSignals: { protocolCompletionOverride: true }
  }).eligible, true);
  assert.equal(responseEligibleForNano({ mode: RUN_MODES.WAITING_CONTINUE }, {
    latestAssistantComplete: false
  }).eligible, true);
});

test("required evidence is not promoted to an executable recovery direction", () => {
  const seeded = seedContinuityFromStartAnalysis(createContinuity(), {
    taskIntent: "Research safely.",
    firstWorkUnit: "Inspect the source.",
    constraints: [],
    risks: [],
    requiredEvidence: ["Exact file and symbol locators."]
  }, { now: 1000 });
  const projection = projectContinuity(seeded);
  assert.equal(projection.nextDirections.length, 0);
  assert.equal(projection.evidenceRequirements[0].text, "Exact file and symbol locators.");
});

test("later assistant response reconciles an unconfirmed start receipt", () => {
  const receipts = [{
    receiptId: "receipt-1",
    status: "SUBMITTED_UNCONFIRMED",
    submittedAt: "2026-08-03T12:00:00.000Z",
    sessionIdentity: "chatgpt.com:g:eic",
    initialConversationKey: "chatgpt.com:g:eic",
    postConversationKey: "chatgpt.com:c:arch"
  }];
  const result = reconcileStartPromptReceipts(receipts, {
    conversationKey: "chatgpt.com:c:arch",
    latestAssistantHash: "sha256:assistant",
    latestMessageRole: "assistant",
    latestAssistantCandidate: true,
    latestAssistantComplete: true,
    foregroundSignals: { streamingAssistant: false },
    backgroundSignals: {}
  }, 42, { now: Date.parse("2026-08-03T12:05:00.000Z") });
  assert.equal(result.changed, true);
  assert.equal(result.receipts[0].status, "ACKED");
  assert.equal(result.receipts[0].reconciledFromAssistantHash, "sha256:assistant");
});


test("receipt reconciliation never ACKs a merely prepared or unchanged baseline response", () => {
  const page = {
    conversationKey: "chatgpt.com:c:arch",
    latestAssistantHash: "sha256:baseline",
    latestMessageRole: "assistant",
    latestAssistantCandidate: true,
    latestAssistantComplete: true,
    foregroundSignals: { streamingAssistant: false },
    backgroundSignals: {}
  };
  const prepared = reconcileStartPromptReceipts([{
    receiptId: "prepared",
    status: "PREPARED",
    sessionIdentity: "chatgpt.com:c:arch",
    baselineAssistantHash: "sha256:baseline"
  }], page, 42, { now: Date.parse("2026-08-03T12:05:00.000Z") });
  assert.equal(prepared.changed, false);
  assert.equal(prepared.receipts[0].status, "PREPARED");

  const unchanged = reconcileStartPromptReceipts([{
    receiptId: "unchanged",
    status: "SUBMITTED_UNCONFIRMED",
    submittedAt: "2026-08-03T12:00:00.000Z",
    sessionIdentity: "chatgpt.com:c:arch",
    baselineAssistantHash: "sha256:baseline"
  }], page, 42, { now: Date.parse("2026-08-03T12:05:00.000Z") });
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.receipts[0].status, "SUBMITTED_UNCONFIRMED");
});

test("source wiring enforces scoped continuity, sticky mode, completion and hard Nano timeout", () => {
  assert.equal(EXPORT_SCHEMA, "eic.autonom.export.v20");
  assert.equal(EXPORT_VERSION, 20);
  assert.match(background, /schema: "eic\.autonom\.window-context\.v7"/);
  assert.match(background, /initializeWindowContinuity/);
  assert.match(background, /resolveStickyRunMode/);
  assert.match(background, /promoteContinuityConversation/);
  assert.match(background, /responseEligibleForNano/);
  assert.match(background, /reconcileStartPromptReceipts/);
  assert.equal(NANO_WALL_TIMEOUT_MS, 1_800_000);
  assert.match(panel, /NANO_WALL_TIMEOUT_MS/);
  assert.match(panel, /AbortController/);
  assert.match(panel, /withNanoWallDeadline/);
  assert.match(panel, /version: EXPORT_VERSION/);
});
