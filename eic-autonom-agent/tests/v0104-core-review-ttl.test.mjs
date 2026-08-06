import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CORE_SURFACE_AUTO_APPLY_TTL_MS,
  CORE_SURFACE_REVIEW_STATUS,
  coreSurfaceAutoApplyDue,
  coreSurfaceProposalAutoApplyEligibility,
  createPendingCoreSurfaceReview,
  normalizeCoreSurfaceProposal,
  scheduleCoreSurfaceAutoApply
} from "../lib/core-surface-review.mjs";

test("no-op proposals close without a false change", async () => {
  const proposal = await normalizeCoreSurfaceProposal({
    verdict: "PROPOSE_CHANGES",
    summary: "same",
    configPatch: { autoSessionCaptureEnabled: true },
    nanoMandate: { change: true, replacement: "nano", reason: "same" },
    targetMandate: { change: false, replacement: "", reason: "" },
    continuity: { change: false, replacement: "", reason: "" },
    settingsFindings: []
  }, {
    currentConfig: { autoSessionCaptureEnabled: true, nanoMandate: "nano" }
  });
  assert.equal(proposal.verdict, "NO_CHANGE");
  assert.deepEqual(proposal.configPatch, {});
  assert.equal(proposal.surfaces.nanoMandate.change, false);
});

test("material proposal auto-applies only after five-minute TTL", () => {
  const now = Date.parse("2026-08-06T08:00:00Z");
  const review = createPendingCoreSurfaceReview({
    appSessionId: "app",
    captureId: "cap",
    memoryId: "mem",
    now
  });
  review.status = CORE_SURFACE_REVIEW_STATUS.PROPOSAL_READY;
  review.proposal = {
    verdict: "PROPOSE_CHANGES",
    configPatch: { maxTurns: 40 },
    surfaces: {}
  };
  const scheduled = scheduleCoreSurfaceAutoApply(review, { enabled: true, now });
  assert.equal(
    Date.parse(scheduled.autoApplyAt) - now,
    CORE_SURFACE_AUTO_APPLY_TTL_MS
  );
  assert.equal(coreSurfaceAutoApplyDue(scheduled, {
    enabled: true,
    now: now + CORE_SURFACE_AUTO_APPLY_TTL_MS - 1
  }).due, false);
  assert.equal(coreSurfaceAutoApplyDue(scheduled, {
    enabled: true,
    now: now + CORE_SURFACE_AUTO_APPLY_TTL_MS
  }).due, true);
  assert.equal(coreSurfaceAutoApplyDue(scheduled, {
    enabled: false,
    now: now + CORE_SURFACE_AUTO_APPLY_TTL_MS
  }).due, false);
});

test("background owns TTL application and explicit operator application", async () => {
  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  assert.match(source, /processExpiredCoreSurfaceReviews/);
  assert.match(source, /automatic: true/);
  assert.match(source, /TTL_AUTO_APPLY/);
  assert.match(source, /autoApplyCoreSurfaceReviewEnabled/);
  assert.match(source, /await saveConfig\(nextConfig\)/);
});


test("TTL auto-apply excludes mandate and autonomy/profile rewrites", () => {
  assert.deepEqual(
    coreSurfaceProposalAutoApplyEligibility({
      verdict: "PROPOSE_CHANGES",
      configPatch: {},
      surfaces: {
        nanoMandate: { change: true, replacement: "changed" }
      }
    }),
    { allowed: false, reason: "MANDATE_REWRITE_REQUIRES_OPERATOR" }
  );
  assert.deepEqual(
    coreSurfaceProposalAutoApplyEligibility({
      verdict: "PROPOSE_CHANGES",
      configPatch: { quickProfileId: "BOUNDED_DELIVERY", scenarioPreset: "BOUNDED_DELIVERY" },
      surfaces: {}
    }),
    { allowed: false, reason: "SETTING_REQUIRES_OPERATOR:quickProfileId" }
  );
});
