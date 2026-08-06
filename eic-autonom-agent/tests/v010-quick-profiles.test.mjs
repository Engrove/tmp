import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_QUICK_PROFILE_ID,
  QUICK_PROFILES,
  QUICK_PROFILE_IDS,
  assertQuickProfileBinding,
  bindQuickProfile,
  materialProfileDifference,
  recommendQuickProfile
} from "../lib/quick-profiles.mjs";

test("v0.10 exposes exactly four materially different whole-app profiles", () => {
  assert.equal(QUICK_PROFILES.length, 4);
  assert.deepEqual(QUICK_PROFILES.map((item) => item.id), [
    "VERIFIED_ANALYSIS",
    "BOUNDED_DELIVERY",
    "STRICT_OPERATIONS_RECOVERY",
    "EXPLORATION_DESIGN"
  ]);
  for (let i = 0; i < QUICK_PROFILES.length; i += 1) {
    for (let j = i + 1; j < QUICK_PROFILES.length; j += 1) {
      assert.ok(materialProfileDifference(QUICK_PROFILES[i].id, QUICK_PROFILES[j].id).count >= 2);
    }
  }
});

test("v0.10 default is VERIFIED_ANALYSIS", () => {
  assert.equal(DEFAULT_QUICK_PROFILE_ID, QUICK_PROFILE_IDS.VERIFIED_ANALYSIS);
});

test("v0.10 recommendation reports signals and does not silently bind", () => {
  const recommendation = recommendQuickProfile("Implementera patch, kör test och bygg paket.");
  assert.equal(recommendation.recommendedProfileId, QUICK_PROFILE_IDS.BOUNDED_DELIVERY);
  assert.equal(recommendation.materialChangeRequiresConfirmation, true);
  assert.ok(recommendation.signals.includes("implementera"));
});

test("v0.10 strict operations requires stronger settings than exploration", () => {
  const diff = materialProfileDifference(
    QUICK_PROFILE_IDS.STRICT_OPERATIONS_RECOVERY,
    QUICK_PROFILE_IDS.EXPLORATION_DESIGN
  );
  assert.ok(diff.keys.includes("evidence"));
  assert.ok(diff.keys.includes("sessionCapture"));
  assert.ok(diff.keys.includes("retry"));
});

test("v0.10 profile binding survives refresh but not another mission", () => {
  const binding = bindQuickProfile({
    profileId: QUICK_PROFILE_IDS.BOUNDED_DELIVERY,
    missionId: "mission-1",
    taskFingerprint: "task-1",
    mandateVersion: "m1",
    mandateSha256: "sha"
  });
  assert.equal(assertQuickProfileBinding(binding, {
    missionId: "mission-1",
    taskFingerprint: "task-1"
  }).valid, true);
  assert.equal(assertQuickProfileBinding(binding, {
    missionId: "mission-2",
    taskFingerprint: "task-1"
  }).reason, "QUICK_PROFILE_MISSION_MISMATCH");
});
