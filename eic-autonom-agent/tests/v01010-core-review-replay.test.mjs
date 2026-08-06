import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  CORE_SURFACE_REVIEW_DEFERRAL_REASON,
  CORE_SURFACE_REVIEW_STATUS,
  CORE_SURFACE_REVIEW_TRIGGER,
  createCoreSurfaceReviewDeferral,
  replayDeferredCoreSurfaceReview
} from "../lib/core-surface-review.mjs";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");

test("v0.10.10 deferral binds the exact app-session capture and memory sources", () => {
  const deferral = createCoreSurfaceReviewDeferral({
    reason: CORE_SURFACE_REVIEW_DEFERRAL_REASON.SESSION_CONTEXT_INITIALIZING,
    appSessionId: "app-session-1",
    captureId: "capture-1",
    memoryId: "memory-1",
    missionId: "mission-1",
    runId: "run-1",
    now: Date.parse("2026-08-06T17:30:00.000Z")
  });
  assert.equal(deferral.schema, "eic.autonom.core-review-deferral.v2");
  assert.equal(deferral.reason, "SESSION_CONTEXT_INITIALIZING");
  assert.equal(deferral.appSessionId, "app-session-1");
  assert.equal(deferral.captureId, "capture-1");
  assert.equal(deferral.memoryId, "memory-1");
  assert.equal(deferral.requestedAt, "2026-08-06T17:30:00.000Z");
});

test("v0.10.10 deferred review cannot replay before session-context READY", () => {
  const deferral = createCoreSurfaceReviewDeferral({
    appSessionId: "app-session-1",
    captureId: "capture-1",
    memoryId: "memory-1"
  });
  const result = replayDeferredCoreSurfaceReview({
    deferral,
    sessionContextReady: false
  });
  assert.equal(result.action, "DEFER");
  assert.equal(result.reason, "SESSION_CONTEXT_NOT_READY");
  assert.equal(result.deferral, deferral);
});

test("v0.10.10 deferred review waits while mission Nano still owns the model", () => {
  const deferral = createCoreSurfaceReviewDeferral({
    appSessionId: "app-session-1",
    captureId: "capture-1",
    memoryId: "memory-1"
  });
  assert.equal(replayDeferredCoreSurfaceReview({
    deferral,
    sessionContextReady: true,
    pendingNanoRequest: { requestId: "nano-1" }
  }).reason, "MISSION_NANO_PENDING");
  assert.equal(replayDeferredCoreSurfaceReview({
    deferral,
    sessionContextReady: true,
    nanoHostBusy: true
  }).reason, "NANO_HOST_BUSY");
});

test("v0.10.10 READY replays exactly one source-bound automatic review", () => {
  const deferral = createCoreSurfaceReviewDeferral({
    appSessionId: "app-session-1",
    captureId: "capture-1",
    memoryId: "memory-1"
  });
  const scheduled = replayDeferredCoreSurfaceReview({
    deferral,
    sessionContextReady: true,
    now: Date.parse("2026-08-06T17:31:00.000Z")
  });
  assert.equal(scheduled.action, "SCHEDULE");
  assert.equal(scheduled.deferral, null);
  assert.equal(scheduled.review.status, CORE_SURFACE_REVIEW_STATUS.PENDING_ANALYSIS);
  assert.equal(scheduled.review.trigger, CORE_SURFACE_REVIEW_TRIGGER.AUTO_INITIAL_CAPTURE);
  assert.equal(scheduled.review.appSessionId, "app-session-1");
  assert.equal(scheduled.review.captureId, "capture-1");
  assert.equal(scheduled.review.memoryId, "memory-1");

  const replay = replayDeferredCoreSurfaceReview({
    deferral,
    review: scheduled.review,
    sessionContextReady: true
  });
  assert.equal(replay.action, "CONSUME_NOOP");
  assert.equal(replay.reason, "APP_SESSION_ALREADY_REVIEWED");
  assert.equal(replay.deferral, null);
  assert.equal(replay.review, scheduled.review);
});

test("v0.10.10 background defers on session init and replays after Nano/host release", () => {
  const background = read("../background.js");
  assert.match(background, /createCoreSurfaceReviewDeferral\(\{/u);
  assert.match(background, /SESSION_CONTEXT_INITIALIZING/u);
  assert.match(background, /maybeReplayDeferredCoreSurfaceReview\(\{/u);
  assert.match(background, /reason: completesSessionContextInit\s*\?\s*"session-context-ready"/u);
  assert.match(background, /reason: `nano-host-\$\{event\}`/u);
  assert.doesNotMatch(
    background,
    /const missionNanoActive = Boolean\(\s*context\.activeMissionId \|\|/u
  );
});

test("v0.10.10 automatic review gets one model turn before ordinary mission Nano", () => {
  const panel = read("../sidepanel.js");
  assert.match(panel, /function automaticCoreSurfaceReviewHasPriority/u);
  assert.match(panel, /review\?\.trigger === CORE_SURFACE_REVIEW_TRIGGER\.AUTO_INITIAL_CAPTURE/u);
  assert.match(panel, /run\?\.sessionContextInit\?\.state === "READY"/u);
  assert.match(panel, /if \(coreReviewPriority\) \{\s*processPendingCoreSurfaceReview/su);
  assert.match(panel, /if \(!automaticPriority &&\s*windowContext\.run\?\.state === STATES\.ASSESSING/su);
});

test("v0.10.10 pending review UI states the real panel/model execution dependency", () => {
  const panel = read("../sidepanel.js");
  assert.match(panel, /panelen och den lokala modellen är tillgängliga/u);
  assert.match(panel, /prioriteras den före vanlig mission-Nano/u);
});
