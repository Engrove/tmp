import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deriveAttentionTarget } from "../lib/attention-router.mjs";

test("operator decision outranks Nano review", () => {
  const target = deriveAttentionTarget({
    windowContext: {
      run: { state: "AWAITING_OPERATOR_DECISION", operatorDecision: { decisionId: "d" } },
      coreSurfaceReview: {
        status: "PROPOSAL_READY",
        proposal: { reviewId: "r" }
      }
    }
  });
  assert.equal(target.id, "OPERATOR_DECISION");
  assert.equal(target.view, "RUN");
});

test("Nano review routes to Settings and exposes TTL", () => {
  const now = Date.parse("2026-08-06T08:00:00Z");
  const target = deriveAttentionTarget({
    now,
    config: { autoApplyCoreSurfaceReviewEnabled: true },
    windowContext: {
      coreSurfaceReview: {
        status: "PROPOSAL_READY",
        proposal: { reviewId: "r" },
        autoApplyEnabled: true,
        autoApplyAt: new Date(now + 65_000).toISOString()
      }
    }
  });
  assert.equal(target.id, "CORE_SURFACE_REVIEW");
  assert.equal(target.view, "SETTINGS");
  assert.equal(target.anchorId, "coreSurfaceReviewCard");
  assert.match(target.detail, /65 s/);
});

test("side-panel banner is clickable and routes to a concrete anchor", async () => {
  const html = await readFile(new URL("../sidepanel.html", import.meta.url), "utf8");
  const js = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");
  assert.match(html, /id="attentionBanner"/);
  assert.match(js, /routeToAttentionTarget/);
  assert.match(js, /scrollIntoView/);
});


test("v0.10.7 delivery wait is visible instead of no-action status", () => {
  const target = deriveAttentionTarget({
    windowContext: {
      run: {
        state: "WAITING_FOR_RESPONSE",
        deliveryWait: {
          status: "WAITING_OWNER_EVIDENCE",
          omissionFailure: "Route-native owner-locator saknas för nästa effekt."
        }
      }
    }
  });
  assert.equal(target.id, "DELIVERY_OWNER_WAIT");
  assert.equal(target.view, "RUN");
  assert.equal(target.anchorId, "statusHeading");
  assert.match(target.label, /extern owner\/locator/i);
  assert.match(target.detail, /owner-locator saknas/i);
});
