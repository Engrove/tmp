import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ACTION_REGISTRY,
  DELEGATION_CLASSES,
  MJOLNAR_ROLLOUT_MODES,
  MJOLNAR_VERDICTS,
  adjudicateMjolnarRequest,
  buildD2DelegationPrompt,
  buildMjolnarRequest,
  canDispatchForRollout
} from "../lib/mjolnar.mjs";

const privilegedCodes = [
  "AUTH_OWNER_ROUTE",
  "CHANGE_PERMISSION",
  "MERGE_BRANCH",
  "CREATE_RELEASE",
  "DEPLOY_PRODUCTION"
];

async function buildPrivilegedRequest(actionCode = "MERGE_BRANCH", overrides = {}) {
  return buildMjolnarRequest({
    sourceClass: "LOCAL_STATE_MACHINE",
    triggerType: "OPERATOR_PROXY_REQUIRED",
    actionCode,
    exactTarget: "repo:elho/eic|base:main|head:release-candidate",
    proposedAction: `${actionCode} through the exact owner route`,
    expectedEffect: "The exact owner object reflects the requested bounded effect.",
    ownerSurface: "APIG_GIT_BROKER",
    ownerEvidenceLocator: "forgejo:elho/eic:pr:42",
    reversibility: "YES",
    rollbackPath: "Revert the exact merge/release/deploy/permission/auth change through the same owner route.",
    humanAuthorityClass: "NOT_REQUIRED",
    materialAmbiguity: "NONE",
    destructivenessLevel: 9,
    destructivenessRationale: "Registered D2 privileged reversible owner-route action.",
    readbackPlan: "Re-read the exact owner object and immutable resulting locator.",
    ...overrides
  }, {
    sessionId: "run-d2",
    conversationLocator: "chatgpt.com:d2",
    stableGoal: "Execute one exact privileged owner-route action.",
    activeWorkUnit: "D2 privileged handoff",
    verifiedState: ["D2 rollout was explicitly selected by the operator."],
    governingAuthority: "EXPLICIT_OPERATOR_D2_CONFIG_AND_OWNER_ROUTE_MANDATE",
    hjalmarVerdict: "UNKNOWN",
    hjalmarEvidenceLimit: "Local deterministic second control only.",
    hjalmarProvenance: "UNTRUSTED_OR_ABSENT",
    snapshotHash: "snapshot-before-d2"
  });
}

test("v0.6.8 registers D2 live and five privileged action codes", () => {
  assert.equal(MJOLNAR_ROLLOUT_MODES.D2_LIVE, "D2_LIVE");
  for (const code of privilegedCodes) {
    assert.equal(ACTION_REGISTRY[code].delegationClass, DELEGATION_CLASSES.D2_PRIVILEGED);
    assert.equal(ACTION_REGISTRY[code].executor, "TARGET_SESSION_OWNER_ROUTE_HANDOFF");
    assert.equal(ACTION_REGISTRY[code].destructivenessLevel, 9);
  }
});

test("v0.6.8 D2 action is delegable only with complete privileged controls", async () => {
  const response = adjudicateMjolnarRequest(await buildPrivilegedRequest());
  assert.equal(response.verdict, MJOLNAR_VERDICTS.DELEGABLE);
  assert.equal(response.delegation_class, DELEGATION_CLASSES.D2_PRIVILEGED);
  assert.equal(response.destructiveness_level, 9);
  assert.equal(response.hjalmar_mental_control, "PASS");
  assert.equal(response.reason, "REGISTERED_D2_PRIVILEGED_ALL_CONTROLS_PRESENT");
});

test("v0.6.8 D2 dispatch is opt-in and D2 rollout is a strict superset", async () => {
  const d2 = adjudicateMjolnarRequest(await buildPrivilegedRequest());
  assert.equal(canDispatchForRollout(d2, MJOLNAR_ROLLOUT_MODES.SHADOW), false);
  assert.equal(canDispatchForRollout(d2, MJOLNAR_ROLLOUT_MODES.D0_LIVE), false);
  assert.equal(canDispatchForRollout(d2, MJOLNAR_ROLLOUT_MODES.D1_LIVE), false);
  assert.equal(canDispatchForRollout(d2, MJOLNAR_ROLLOUT_MODES.D2_LIVE), true);

  const d0 = adjudicateMjolnarRequest(await buildMjolnarRequest({
    sourceClass: "LOCAL_STATE_MACHINE",
    triggerType: "OPERATOR_PROXY_REQUIRED",
    actionCode: "REFRESH_TAB_STATUS",
    exactTarget: "tab:1|conversation:x",
    proposedAction: "Read tab status",
    expectedEffect: "Fresh snapshot",
    ownerSurface: "CHROME_TABS",
    ownerEvidenceLocator: "tab:1",
    reversibility: "YES",
    rollbackPath: "NOT_REQUIRED_READ_ONLY",
    humanAuthorityClass: "NOT_REQUIRED",
    materialAmbiguity: "NONE"
  }, {
    sessionId: "r",
    conversationLocator: "x",
    stableGoal: "read",
    activeWorkUnit: "read",
    governingAuthority: "operator",
    snapshotHash: "s"
  }));
  assert.equal(canDispatchForRollout(d0, MJOLNAR_ROLLOUT_MODES.D2_LIVE), true);
});

for (const [field, override] of [
  ["owner evidence", { ownerEvidenceLocator: "" }],
  ["rollback", { rollbackPath: "" }],
  ["readback", { readbackPlan: "" }],
  ["reversibility", { reversibility: "UNKNOWN" }],
  ["human authority", { humanAuthorityClass: "UNKNOWN" }],
  ["material ambiguity", { materialAmbiguity: "PRESENT" }]
]) {
  test(`v0.6.8 D2 requests owner facts when ${field} is incomplete`, async () => {
    const response = adjudicateMjolnarRequest(await buildPrivilegedRequest("MERGE_BRANCH", override));
    assert.equal(response.verdict, MJOLNAR_VERDICTS.READ_REQUIRED);
    assert.notEqual(canDispatchForRollout(response, MJOLNAR_ROLLOUT_MODES.D2_LIVE), true);
  });
}

test("v0.6.8 auth uses existing owner authorization but login/CAPTCHA/secrets remain human-required", async () => {
  const boundedAuth = adjudicateMjolnarRequest(await buildPrivilegedRequest("AUTH_OWNER_ROUTE", {
    exactTarget: "service:eic|authorization-grant:deploy",
    ownerSurface: "AUTHORIZATION_OWNER_ROUTE",
    ownerEvidenceLocator: "authorization:grant:deploy:current",
    proposedAction: "Refresh the existing authorized owner-route grant without credentials.",
    expectedEffect: "The existing grant is refreshed and owner-read back.",
    rollbackPath: "Restore the previous grant revision.",
    readbackPlan: "Read the exact grant revision and expiry from the authorization owner route."
  }));
  assert.equal(boundedAuth.verdict, MJOLNAR_VERDICTS.DELEGABLE);
  assert.equal(boundedAuth.destructiveness_level, 9);

  for (const proposedAction of [
    "Enter login password through AUTH_OWNER_ROUTE",
    "Solve CAPTCHA before AUTH_OWNER_ROUTE",
    "Read access token secret for AUTH_OWNER_ROUTE"
  ]) {
    const response = adjudicateMjolnarRequest(await buildPrivilegedRequest("AUTH_OWNER_ROUTE", {
      proposedAction,
      expectedEffect: proposedAction
    }));
    assert.equal(response.verdict, MJOLNAR_VERDICTS.HUMAN_REQUIRED);
    assert.equal(response.delegation_class, DELEGATION_CLASSES.HUMAN_AUTHORITY_REQUIRED);
    assert.equal(canDispatchForRollout(response, MJOLNAR_ROLLOUT_MODES.D2_LIVE), false);
  }
});

test("v0.6.8 D2 handoff prompt is exact, owner-routed and never self-verifies effect", async () => {
  const request = await buildPrivilegedRequest("DEPLOY_PRODUCTION", {
    exactTarget: "environment:prod|revision:sha256:abc123",
    ownerSurface: "DEPLOYMENT_OWNER_ROUTE",
    ownerEvidenceLocator: "deploy:prod:revision:abc123",
    rollbackPath: "Redeploy immutable revision sha256:previous",
    readbackPlan: "Read deployment instance revision and health from the deployment owner route."
  });
  const prompt = buildD2DelegationPrompt(request);
  assert.match(prompt, /EIC_MJOLNAR_D2\/1/);
  assert.match(prompt, /ACTION_CODE: DEPLOY_PRODUCTION/);
  assert.match(prompt, /environment:prod\|revision:sha256:abc123/);
  assert.match(prompt, /DEPLOYMENT_OWNER_ROUTE/);
  assert.match(prompt, /Prompt acknowledgement or assistant text is not effect verification/);
  assert.match(prompt, /Do not request, reveal, infer, synthesize or enter credentials/);
  assert.match(prompt, /return BLOCKER and do not claim success/);
});

test("v0.6.8 browser wiring sends D2 through target owner-route handoff without new Chrome permissions", () => {
  const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  const panel = fs.readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");
  const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

  assert.match(panel, /value="D2_LIVE"/);
  assert.match(background, /buildD2DelegationPrompt/);
  assert.match(background, /TARGET_SESSION_OWNER_ROUTE_HANDOFF|MJOLNAR_D2_TARGET_BUSY/);
  assert.match(background, /effectVerification=NOT_ESTABLISHED/);
  assert.match(background, /ingen effekt verifierad/);
  assert.deepEqual(manifest.permissions, ["sidePanel", "storage", "tabs", "scripting", "alarms"]);
});
