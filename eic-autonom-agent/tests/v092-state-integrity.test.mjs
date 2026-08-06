import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  ACTIVE_TASK_BINDING_SCHEMA,
  DECISION_OWNERS,
  assertDistinctClaimsAndInferences,
  assertTargetActionAllowed,
  assertTaskBindingTransition,
  buildContinuityTransition,
  buildProtocolRepairDecision,
  createActiveTaskBinding,
  deriveExecutableWorkUnit,
  evaluateClaimReceipt,
  evaluateDecisionClaimReceipts,
  inferStrongClaimTypes,
  recordDecisionTrace,
  registerMandateVersion,
  validateExecutableWorkUnit,
  validateStopCriteria
} from "../lib/task-integrity.mjs";
import { buildTurnObject } from "../lib/prompt-contract.mjs";
import { createContinuity, applyNanoDecision, projectContinuity } from "../lib/continuity.mjs";
import { NANO_WALL_TIMEOUT_MS } from "../lib/contracts.mjs";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

async function binding(overrides = {}) {
  return createActiveTaskBinding({
    projectId: 63,
    workstreamId: "v0.9.2-state-integrity",
    taskFingerprint: "task:state-integrity",
    auditRunId: "audit:v092",
    mandateVersion: "target-workspace-v3",
    mandateSha256: SHA_A,
    sourceTurnId: "turn-1",
    ...overrides
  });
}

test("v0.9.2 active_task_binding är komplett och deterministiskt hashbunden", async () => {
  const first = await binding();
  const second = await binding();
  assert.equal(first.schema, ACTIVE_TASK_BINDING_SCHEMA);
  assert.equal(first.bindingSha256, second.bindingSha256);
});

test("v0.9.2 projektbyte avvisas utan explicit TASK_SWITCH", async () => {
  const current = await binding();
  const candidate = await binding({ projectId: 2, sourceTurnId: "turn-2" });
  assert.throws(
    () => assertTaskBindingTransition(current, candidate),
    /PROJECT_BINDING_CONFLICT/
  );
});

test("v0.9.2 explicit TASK_SWITCH tillåter projektbyte", async () => {
  const current = await binding();
  const candidate = await binding({ projectId: 2, sourceTurnId: "turn-2" });
  const result = assertTaskBindingTransition(current, candidate, { operation: "TASK_SWITCH" });
  assert.equal(result.switched, true);
  assert.deepEqual(result.changedFields, ["projectId"]);
});

test("v0.9.2 samma mandatversion med annan hash avvisas", async () => {
  const current = await binding();
  const candidate = await binding({ mandateSha256: SHA_B, sourceTurnId: "turn-2" });
  assert.throws(
    () => assertTaskBindingTransition(current, candidate),
    /MANDATE_VERSION_HASH_CONFLICT/
  );
});

test("v0.9.2 mandatregister återanvänder identisk version och hash", async () => {
  const first = await registerMandateVersion(null, {
    surface: "TARGET",
    version: "target-workspace-v3",
    text: "Mandat A"
  });
  const second = await registerMandateVersion(first.registry, {
    surface: "TARGET",
    version: "target-workspace-v3",
    text: "Mandat A"
  });
  assert.equal(second.reused, true);
  assert.equal(second.entry.sha256, first.entry.sha256);
});

test("v0.9.2 mandatregister avvisar muterad semantik under samma version", async () => {
  const first = await registerMandateVersion(null, {
    surface: "TARGET",
    version: "target-workspace-v3",
    text: "Mandat A"
  });
  await assert.rejects(
    registerMandateVersion(first.registry, {
      surface: "TARGET",
      version: "target-workspace-v3",
      text: "Mandat B"
    }),
    /MANDATE_VERSION_HASH_CONFLICT/
  );
});

test("v0.9.2 självrefererande Nano-instruktion avvisas", () => {
  assert.throws(
    () => assertTargetActionAllowed("Aktivera Nano och återköa observationen."),
    /SELF_REFERENTIAL_NANO_ACTION/
  );
  assert.equal(
    assertTargetActionAllowed("Verifiera timeoutkonstanten genom source owner."),
    "Verifiera timeoutkonstanten genom source owner."
  );
});

test("v0.9.2 targetClaims och inferences måste vara separata", () => {
  assert.throws(
    () => assertDistinctClaimsAndInferences(
      ["Artifact 1136 är sparad."],
      ["artifact 1136 är sparad"]
    ),
    /CLAIM_INFERENCE_COLLISION/
  );
  assert.equal(
    assertDistinctClaimsAndInferences(
      ["Artifact 1136 påstås vara sparad."],
      ["Påståendet saknar owner-readback."]
    ),
    true
  );
});

test("v0.9.2 arbetsenhet har verb, exakt objekt, owner och observerbart resultat", () => {
  const workUnit = deriveExecutableWorkUnit({
    statement: "Nano-wall-timeoutens ägande konstant och konsumenter.",
    requestedAction: "Verifiera konstanten och uppdatera dess konsumenter.",
    ownerSurface: "SOURCE_TREE",
    observableResult: "Fokuserat test visar 1 800 000 ms."
  });
  validateExecutableWorkUnit(workUnit);
  assert.equal(workUnit.verb, "Verifiera");
  assert.equal(workUnit.ownerSurface, "SOURCE_TREE");
});

test("v0.9.2 stopvillkor får inte vara en åtgärd", () => {
  assert.throws(
    () => validateStopCriteria(["Aktivera Nano och fortsätt."]),
    /STOP_CRITERION_IS_ACTION/
  );
  assert.equal(
    validateStopCriteria(["Artifact checksum mismatch har verifierats."]),
    true
  );
});

test("v0.9.2 ogiltigt targetresultat ger repair-only-beslut", () => {
  const repair = buildProtocolRepairDecision({
    reason: "PROTOCOL_COMPLETION_EVIDENCE_INVALID",
    expectedTurnId: "turn-7"
  });
  assert.equal(repair.protocolRepairOnly, true);
  assert.equal(repair.progressDelta, 0);
  assert.deepEqual(repair.targetClaims, []);
  assert.deepEqual(repair.inferences, []);
  assert.doesNotMatch(repair.requestedAction, /turn-7/);
  assert.match(repair.requestedAction, /aktuella repair-turnens EIC_TURN/);
});

test("v0.9.2 deterministic recovery separeras från Nano trace", () => {
  const recorded = recordDecisionTrace(
    { lastNanoAttemptTrace: { decisionOwner: "NANO_HOST", resultSummary: "real nano" } },
    { status: "COMPLETED", attempts: 0, outputChars: 0 },
    { source: "DETERMINISTIC_RECOVERY", now: 1 }
  );
  assert.equal(recorded.run.decisionOwner, DECISION_OWNERS.LOCAL_DETERMINISTIC_RECOVERY);
  assert.equal(recorded.run.runtimeDecisionStatus, "DEGRADED_RECOVERY");
  assert.equal(recorded.run.lastNanoAttemptTrace.resultSummary, "real nano");
  assert.equal(recorded.run.lastDeterministicRecoveryTrace.attempts, 0);
});

test("v0.9.2 verklig Nano-körning äger Nano attempt trace", () => {
  const recorded = recordDecisionTrace(
    {},
    { status: "COMPLETED", attempts: 1, outputChars: 250 },
    { source: "NANO", now: 1 }
  );
  assert.equal(recorded.run.decisionOwner, DECISION_OWNERS.NANO_HOST);
  assert.equal(recorded.run.lastNanoAttemptTrace.outputChars, 250);
  assert.equal(recorded.run.lastNanoAttemptTrace.outputChars, 250);
});

test("v0.9.2 claim–receipt-gate blockerar fabricerad artifactframgång", () => {
  const result = evaluateClaimReceipt({
    claimType: "ARTIFACT",
    claim: "Artifact 1136 sparades."
  });
  assert.equal(result.allowed, false);
  assert.equal(result.band, "LOCAL_ONLY");
  assert.equal(result.reason, "OWNER_RECEIPT_REQUIRED");
});

test("v0.9.2 claim–receipt-gate emitterar efter owner-readback", () => {
  const result = evaluateClaimReceipt({
    claimType: "ARTIFACT",
    claim: "Artifact 1200 sparades.",
    sameTurn: true,
    receipt: {
      ownerSurface: "artifact/get",
      locator: "artifact:1200",
      readback: true
    }
  });
  assert.equal(result.allowed, true);
  assert.equal(result.band, "VERIFIED");
  assert.equal(result.receiptLocator, "artifact:1200");
});

test("v0.9.2 continuity transition binder progress, blockerfingerprint och nästa riktning", async () => {
  const transition = await buildContinuityTransition({
    progressDelta: 1,
    blockers: ["Repo binding PENDING."],
    nextDirection: "Läs exakt sourcekonstant."
  });
  assert.equal(transition.lastProgressDelta, 1);
  assert.match(transition.blockerFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(transition.nextDirection, "Läs exakt sourcekonstant.");
});

test("v0.9.2 turnkontraktet komprimerar oförändrat mandat till ref/hash", async () => {
  const turn = await buildTurnObject({
    turnId: "turn-2",
    priorTurnId: "turn-1",
    targetMandate: "Stabilt mandat.",
    targetMandateVersion: "target-v2",
    mandateDelivery: "REFERENCE",
    mandateSha256: SHA_A,
    taskIntent: "Fortsätt projekt 63.",
    workUnit: "Verifiera Nano-wall-timeoutens sourcekonstant.",
    workUnitOwnerSurface: "SOURCE_TREE",
    workUnitObservableResult: "Konstant och konsumenter använder 1 800 000 ms.",
    verifiedState: ["Project 63 är aktivt."],
    targetClaims: ["Målresponsen anger att timeouten är tre minuter."],
    inferences: ["En dold wall-timeout kan äga aborten."],
    requestedAction: "Verifiera timeoutkonstanten och dess direkta konsumenter.",
    stopCriteria: ["Konstanten och alla direkta konsumenter är verifierade."]
  });
  assert.equal(turn.mandate.delivery, "REFERENCE");
  assert.equal(turn.mandate.text, null);
  assert.equal(turn.mandate.sha256, SHA_A);
  validateExecutableWorkUnit(turn.workUnit);
});

test("v0.9.2 continuity bär active task binding och atomisk transition", async () => {
  const activeBinding = await binding();
  let continuity = createContinuity({
    intent: "Leverera v0.9.2.",
    workUnit: "Reparera project binding."
  });
  continuity.activeTaskBinding = activeBinding;
  continuity = applyNanoDecision(continuity, {
    action: "CONTINUE",
    progressDelta: 1,
    workUnit: "Reparera project binding.",
    requestedAction: "Verifiera bindingtesterna.",
    blockers: [{ statement: "Repo PENDING." }],
    alternatives: ["Kör fokustest."],
    activeTaskBinding: activeBinding
  }, { turnIndex: 1 });
  const projection = projectContinuity(continuity);
  assert.equal(projection.activeTaskBinding.projectId, 63);
  assert.equal(projection.transition.lastProgressDelta, 1);
  assert.match(projection.transition.blockerFingerprint, /^[a-f0-9]{64}$/);
});

test("v0.9.2 Nano wall timeout har en explicit 1 800 000 ms-ägare", () => {
  assert.equal(NANO_WALL_TIMEOUT_MS, 1_800_000);
  const panel = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  assert.match(panel, /NANO_WALL_TIMEOUT_MS/);
  assert.doesNotMatch(panel, /const NANO_WALL_TIMEOUT_MS = 180_000/);
});


test("v0.9.2 strong claim detector identifierar artifact/test/runtime utan receipt", () => {
  assert.deepEqual(
    inferStrongClaimTypes("Artifact 1136 sparades, 620/620 tests PASS och runtime verified.").sort(),
    ["ARTIFACT", "RUNTIME", "TEST"]
  );
  const gate = evaluateDecisionClaimReceipts({
    completionConfirmed: true,
    completionEvidence: "Artifact 1136 sparades och 620/620 tests PASS."
  });
  assert.equal(gate.allowed, false);
  assert.deepEqual(gate.claimTypes.sort(), ["ARTIFACT", "TEST"]);
});

test("v0.9.2 background wirear semantisk fail-closed och claim–receipt före continuity", () => {
  const source = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  const semanticAt = source.indexOf("const semanticErrors = []");
  const receiptAt = source.indexOf("const claimReceiptGate = evaluateDecisionClaimReceipts");
  const continuityAt = source.indexOf("let continuity = protocolRepairOnly");
  assert.ok(semanticAt > 0);
  assert.ok(receiptAt > semanticAt);
  assert.ok(continuityAt > receiptAt);
  assert.match(source, /lastStatus = source === NANO_DECISION_SOURCE\.NANO\s*\?\s*"COMPLETED"\s*:\s*"DEGRADED_RECOVERY"/s);
});


test("v0.9.2 aktivt task-project är operator/config-bundet och inte hårdkodat i binding", () => {
  const contracts = fs.readFileSync(new URL("../lib/contracts.mjs", import.meta.url), "utf8");
  const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  const panel = fs.readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");
  assert.match(contracts, /activeTaskProjectId:\s*63/);
  assert.match(background, /config\?\.activeTaskProjectId/);
  assert.match(panel, /id="activeTaskProjectId"/);
});


test("v0.9.2 negativa claim-boundaryfraser räknas inte som verifierad release/runtime", () => {
  assert.deepEqual(
    inferStrongClaimTypes("Ingen release publicerades och runtime är not verified."),
    []
  );
});
