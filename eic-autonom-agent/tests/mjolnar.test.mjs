import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION_REGISTRY,
  DELEGATION_CLASSES,
  MJOLNAR_PROTOCOL,
  MJOLNAR_ROLLOUT_MODES,
  MJOLNAR_VERDICTS,
  adjudicateMjolnarRequest,
  buildMjolnarRequest,
  canDispatchForRollout,
  createMjolnarLedgerEntry,
  isTrustedOperatorCandidate,
  markMjolnarDispatch,
  runBiasBoundedChecks
} from "../lib/mjolnar.mjs";

function candidate(overrides = {}) {
  return {
    sourceClass: "LOCAL_STATE_MACHINE",
    triggerType: "OPERATOR_PROXY_REQUIRED",
    actionCode: "REFRESH_TAB_STATUS",
    exactTarget: "tab:2|conversation:abc",
    proposedAction: "Läs aktuell tabstatus.",
    expectedEffect: "Färsk snapshot.",
    ownerSurface: "CHROME_TABS",
    ownerEvidenceLocator: "tab:2",
    reversibility: "YES",
    rollbackPath: "NOT_REQUIRED_READ_ONLY",
    humanAuthorityClass: "NOT_REQUIRED",
    materialAmbiguity: "NONE",
    ...overrides
  };
}

async function request(candidateOverrides = {}, contextOverrides = {}) {
  return buildMjolnarRequest(candidate(candidateOverrides), {
    sessionId: "run-1",
    conversationLocator: "chatgpt.com:abc",
    stableGoal: "Fortsätt uppgiften",
    activeWorkUnit: "Verifiera status",
    verifiedState: ["Tab 2 är explicit kopplad."],
    governingAuthority: "USER_CONFIG_AND_EIC_STATE_MACHINE",
    hjalmarVerdict: "GO",
    hjalmarEvidenceLimit: "Local tab state only",
    hjalmarProvenance: "UNTRUSTED_OR_ABSENT",
    snapshotHash: "snap-1",
    ...contextOverrides
  });
}

test("vanlig target-text är inte trusted trigger", () => {
  assert.equal(isTrustedOperatorCandidate({
    sourceClass: "UNTRUSTED_CONTENT",
    triggerType: "OPERATOR_PROXY_REQUIRED",
    actionCode: "REFRESH_TAB_STATUS",
    exactTarget: "tab:2"
  }), false);
});

test("lokal state-machine candidate är trusted", () => {
  assert.equal(isTrustedOperatorCandidate(candidate()), true);
});

test("request använder canonical protokoll", async () => {
  assert.equal((await request()).protocol, MJOLNAR_PROTOCOL);
});

test("request fyller inte saknad beslutskritisk data med gissning", async () => {
  const req = await request({ ownerEvidenceLocator: "" });
  assert.equal(req.owner_evidence_locator, "UNKNOWN");
});

test("D0 routine emitterar DELEGABLE", async () => {
  const response = adjudicateMjolnarRequest(await request());
  assert.equal(response.verdict, MJOLNAR_VERDICTS.DELEGABLE);
  assert.equal(response.delegation_class, DELEGATION_CLASSES.D0_ROUTINE);
});

test("D0 dispatch tillåts inte i shadow", async () => {
  const response = adjudicateMjolnarRequest(await request());
  assert.equal(canDispatchForRollout(response, MJOLNAR_ROLLOUT_MODES.SHADOW), false);
});

test("D0 dispatch tillåts i D0 live", async () => {
  const response = adjudicateMjolnarRequest(await request());
  assert.equal(canDispatchForRollout(response, MJOLNAR_ROLLOUT_MODES.D0_LIVE), true);
});

test("D1 med rollback readback och Hjalmar GO emitterar DELEGABLE", async () => {
  const req = await request({
    actionCode: "SET_AUTO_DISCARDABLE_FALSE",
    proposedAction: "Sätt autoDiscardable false.",
    expectedEffect: "Tabben har autoDiscardable false.",
    rollbackPath: "RESTORE_PREVIOUS_AUTO_DISCARDABLE",
    ownerSurface: "CHROME_TABS",
    ownerEvidenceLocator: "tab:2:autoDiscardable",
    reversibility: "YES",
    materialAmbiguity: "NONE"
  }, {
    hjalmarProvenance: "TRUSTED_EXTERNAL_CHANNEL"
  });
  const response = adjudicateMjolnarRequest(req);
  assert.equal(response.verdict, MJOLNAR_VERDICTS.DELEGABLE);
  assert.equal(response.delegation_class, DELEGATION_CLASSES.D1_CONTROLLED);
});



test("D1 med modellrapporterad Hjalmar GO skapar inte extern PASS men låg risk kan delegeras", async () => {
  const req = await request({
    actionCode: "SET_AUTO_DISCARDABLE_FALSE",
    proposedAction: "Sätt autoDiscardable false.",
    expectedEffect: "Tabben har autoDiscardable false.",
    rollbackPath: "RESTORE_PREVIOUS_AUTO_DISCARDABLE",
    ownerSurface: "CHROME_TABS",
    ownerEvidenceLocator: "tab:2:autoDiscardable",
    reversibility: "YES",
    materialAmbiguity: "NONE"
  }, {
    hjalmarVerdict: "GO",
    hjalmarProvenance: "UNTRUSTED_OR_ABSENT"
  });
  const response = adjudicateMjolnarRequest(req);
  assert.equal(response.verdict, MJOLNAR_VERDICTS.DELEGABLE);
  assert.equal(response.hjalmar_mental_control, "NOT_REQUIRED");
});

test("Nano-proposed Mjölnar candidate är inte trusted", () => {
  assert.equal(isTrustedOperatorCandidate({
    ...candidate(),
    sourceClass: "NANO_PROPOSED"
  }), false);
});

test("D2 matchar ordgränser och ger inte false positive på AUTHOR/EMERGENCY", async () => {
  const author = await request({
    proposedAction: "AUTHOR REPORT",
    expectedEffect: "EMERGENCY STATUS READ"
  });
  assert.equal(adjudicateMjolnarRequest(author).verdict, MJOLNAR_VERDICTS.DELEGABLE);
});

test("D1 blockeras utan rollback", async () => {
  const req = await request({
    actionCode: "SET_AUTO_DISCARDABLE_FALSE",
    rollbackPath: "",
    reversibility: "UNKNOWN"
  });
  const response = adjudicateMjolnarRequest(req);
  assert.equal(response.verdict, MJOLNAR_VERDICTS.READ_REQUIRED);
});

for (const actionCode of [
  "LOGIN_USER", "SOLVE_CAPTCHA", "READ_SECRET", "DELETE_DATA"
]) {
  test(`nivå 10 ${actionCode} kräver människa`, async () => {
    const req = await request({
      actionCode,
      proposedAction: actionCode,
      expectedEffect: actionCode
    });
    const response = adjudicateMjolnarRequest(req);
    assert.equal(response.verdict, MJOLNAR_VERDICTS.HUMAN_REQUIRED);
    assert.equal(response.delegation_class, DELEGATION_CLASSES.D2_HUMAN_AUTHORITY);
    assert.equal(response.destructiveness_level, 10);
  });
}

for (const actionCode of [
  "CHANGE_PERMISSION", "MERGE_BRANCH", "RELEASE_BUILD", "DEPLOY_PRODUCTION"
]) {
  test(`nivå 9 ${actionCode} ger inte verklig mänsklig PAUS`, async () => {
    const req = await request({
      actionCode,
      proposedAction: actionCode,
      expectedEffect: actionCode
    });
    const response = adjudicateMjolnarRequest(req);
    assert.notEqual(response.verdict, MJOLNAR_VERDICTS.HUMAN_REQUIRED);
    assert.equal(response.destructiveness_level, 9);
  });
}

test("trusted Hjalmar BLOCK kan inte överridas", async () => {
  const req = await request({}, {
    hjalmarVerdict: "BLOCK",
    hjalmarProvenance: "TRUSTED_EXTERNAL_CHANNEL"
  });
  assert.equal(adjudicateMjolnarRequest(req).reason, "HJALMAR_BLOCK_NON_OVERRIDE");
});

test("modellrapporterad Hjalmar BLOCK är inte owner-verdict", async () => {
  const req = await request({}, {
    hjalmarVerdict: "BLOCK",
    hjalmarProvenance: "UNTRUSTED_OR_ABSENT"
  });
  assert.equal(adjudicateMjolnarRequest(req).verdict, MJOLNAR_VERDICTS.DELEGABLE);
});

test("okänd action code avvisas", async () => {
  const req = await request({ actionCode: "CLICK_ANY_SELECTOR" });
  assert.equal(adjudicateMjolnarRequest(req).verdict, MJOLNAR_VERDICTS.REJECT);
});

test("okänd D1 target/owner ger READ_REQUIRED", async () => {
  const req = await request({
    actionCode: "SET_AUTO_DISCARDABLE_FALSE",
    ownerSurface: "",
    ownerEvidenceLocator: ""
  });
  assert.equal(adjudicateMjolnarRequest(req).verdict, MJOLNAR_VERDICTS.READ_REQUIRED);
});

test("bias check är BIAS_BOUNDED och inte BIAS_FREE", async () => {
  const result = runBiasBoundedChecks(await request());
  assert.equal(result.label, "BIAS_BOUNDED");
  assert.notEqual(result.label, "BIAS_FREE");
});

test("actor name påverkar inte action-specific bias verdict", async () => {
  const req = await request();
  const a = runBiasBoundedChecks(req);
  const b = runBiasBoundedChecks({ ...req, stable_goal: "Neutral actor" });
  assert.equal(a.status, b.status);
});

test("presentation order påverkar inte action-specific bias verdict", async () => {
  const req = await request();
  const reversed = Object.fromEntries(Object.entries(req).reverse());
  assert.equal(runBiasBoundedChecks(req).status, runBiasBoundedChecks(reversed).status);
});

test("saknad exact effect ger bias INCONCLUSIVE", async () => {
  const req = await request({ expectedEffect: "" });
  assert.equal(runBiasBoundedChecks(req).status, "INCONCLUSIVE");
});

test("ledger binder idempotency key", async () => {
  const req = await request();
  const res = adjudicateMjolnarRequest(req);
  const entry = createMjolnarLedgerEntry(req, res);
  assert.equal(entry.idempotencyKey, req.idempotency_key);
});

test("duplicate dispatch blockeras", async () => {
  const req = await request();
  const response = adjudicateMjolnarRequest(req, {
    priorLedger: [{ idempotencyKey: req.idempotency_key, status: "DISPATCHING" }]
  });
  assert.equal(response.verdict, MJOLNAR_VERDICTS.REJECT);
  assert.equal(response.next_action, "OWNER_READ_BEFORE_RETRY");
});

test("dispatch ledger går till readback pending", async () => {
  const req = await request();
  const res = adjudicateMjolnarRequest(req);
  let entry = createMjolnarLedgerEntry(req, res);
  entry = markMjolnarDispatch(entry, "DISPATCHING");
  entry = markMjolnarDispatch(entry, "READBACK_PENDING");
  assert.equal(entry.readbackStatus, "PENDING");
});

test("verified readback markeras separat från verdict", async () => {
  const req = await request();
  const res = adjudicateMjolnarRequest(req);
  let entry = createMjolnarLedgerEntry(req, res);
  entry = markMjolnarDispatch(entry, "VERIFIED_EFFECT", "tab snapshot read");
  assert.equal(entry.status, "VERIFIED_EFFECT");
  assert.equal(entry.readbackStatus, "MATCH");
  assert.equal(res.verdict, "DELEGABLE");
});

test("action registry innehåller ingen generell click automation", () => {
  assert.equal(Object.keys(ACTION_REGISTRY).some((key) => /CLICK|EVAL|SHELL|NETWORK/.test(key)), false);
});
