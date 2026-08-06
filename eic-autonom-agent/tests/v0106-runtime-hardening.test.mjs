import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  createContinuity,
  sealContinuity,
  verifyContinuity
} from "../lib/continuity.mjs";
import {
  continuitySemanticallyEqual,
  evaluateNanoDiscrimination,
  normalizeNanoHostTelemetry,
  projectRunIntoContinuity,
  shouldDeferSessionCapture
} from "../lib/runtime-hardening.mjs";
import {
  acknowledgeFullAuditBatch,
  appendFullAuditEntries,
  createFullAuditQueue,
  fullAuditBatch,
  fullAuditNdjson,
  fullAuditSinkStatus,
  projectedSegmentBytes,
  validateFullAuditDirectoryName
} from "../lib/full-audit-log.mjs";
import {
  buildSessionCapture,
  captureRefreshRequired,
  createDeltaCapture,
  inferTargetProjectBinding,
  reconcileMonotonicCapture,
  stableTurnIdentity
} from "../lib/session-capture.mjs";
import {
  M2_MANDATE_PROTOCOL,
  M2_OPERATOR_EQUIVALENT_LEVEL,
  MJOLNAR_VERDICTS,
  adjudicateMjolnarRequest,
  buildD2DelegationPrompt,
  buildMjolnarRequest,
  createM2Mandate,
  createMjolnarLedgerEntry
} from "../lib/mjolnar.mjs";
import {
  createMission,
  synchronizeMissionFromRun
} from "../lib/mission-state-machine.mjs";
import { MISSION_MODE_IDS } from "../lib/mission-contract.mjs";
import {
  evaluateDecisionClaimReceipts,
  inferStrongClaimTypes
} from "../lib/task-integrity.mjs";
import {
  createCaptureFingerprint
} from "../lib/auto-runtime-guards.mjs";
import {
  createDefaultConfig
} from "../lib/contracts.mjs";

function runtimeRun(overrides = {}) {
  return {
    runId: "run-1",
    windowId: 7,
    state: "ASSESSING",
    mode: "WAITING_CONTINUE",
    turnIndex: 4,
    conversationKey: "chatgpt.com:c:abc",
    taskFingerprint: "task-1",
    activeTaskBinding: {
      schema: "eic.autonom.active-task-binding.v1",
      projectId: 63,
      taskFingerprint: "task-1"
    },
    targetProjectId: 2,
    targetProjectBindingSource: "TRANSCRIPT_EXPLICIT_PROJECT_ID",
    currentTurn: {
      turnId: "turn-4",
      effectState: "ACKED"
    },
    pendingObservation: {
      targetResult: {
        next: "Verifiera nästa owner-route."
      }
    },
    programDeltaGate: {
      directProgramDelta: 1,
      focus: {
        primaryProgramGoal: "Slutför WP25.3",
        boundedCurrentUnit: "UNIT_C"
      }
    },
    destructiveness: {
      classified: true,
      level: 4,
      rationale: "EPHEMERAL_WORKBENCH",
      humanDecisionRequired: false
    },
    ...overrides
  };
}

test("run state projects into continuity without confusing control and target project", async () => {
  const projected = projectRunIntoContinuity(createContinuity(), runtimeRun());
  assert.equal(projected.activeTaskBinding.projectId, 63);
  assert.equal(projected.targetProject.projectId, 2);
  assert.equal(projected.targetProject.mismatch, true);
  assert.equal(projected.position.turnIndex, 4);
  assert.equal(projected.position.phase, "active");
  assert.equal(projected.transition.nextDirection, "Verifiera nästa owner-route.");
  assert.match(projected.verifiedFacts.at(-1).claim, /turn-4/);

  const sealed = await sealContinuity(projected);
  assert.equal((await verifyContinuity(sealed)).valid, true);
});

test("continuity semantic comparison ignores seal timestamps but not run delta", async () => {
  const first = await sealContinuity(projectRunIntoContinuity(createContinuity(), runtimeRun(), { now: 1_000 }));
  const same = await sealContinuity(projectRunIntoContinuity(first, runtimeRun(), { now: 2_000 }));
  assert.equal(continuitySemanticallyEqual(first, same), true);

  const changed = await sealContinuity(projectRunIntoContinuity(first, runtimeRun({ turnIndex: 5 }), { now: 3_000 }));
  assert.equal(continuitySemanticallyEqual(first, changed), false);
});



test("Nano discrimination records challenge evidence without claiming hidden independent planning", () => {
  const echo = evaluateNanoDiscrimination({
    targetNext: "Kör exakt owner-read.",
    nanoNext: "Kör exakt owner-read.",
    reason: "Owner-route och blockerare pekar på samma bounded read.",
    alternatives: ["Gör ingenting."]
  });
  assert.equal(echo.verdict, "TARGET_NEXT_ACCEPTED");
  assert.equal(echo.challengeDemonstrated, true);
  assert.equal(echo.independentPlanningClaimed, false);

  const unexaminedEcho = evaluateNanoDiscrimination({
    targetNext: "Kör exakt owner-read.",
    nanoNext: "Kör exakt owner-read.",
    reason: "OK",
    alternatives: []
  });
  assert.equal(unexaminedEcho.challengeDemonstrated, false);

  const changed = evaluateNanoDiscrimination({
    targetNext: "Publicera direkt.",
    nanoNext: "Läs owner-state och validera exakt target först.",
    reason: "Publicering saknar owner-readback.",
    alternatives: []
  });
  assert.equal(changed.verdict, "TARGET_NEXT_CHANGED");
  assert.equal(changed.challengeDemonstrated, true);
  assert.equal(changed.independentPlanningClaimed, false);
});

test("capture is deferred while mission Nano owns the model", () => {
  assert.deepEqual(
    shouldDeferSessionCapture({
      automatic: true,
      run: { pendingNanoRequest: { requestId: "nano-1" } },
      nanoHostTelemetry: { busy: true }
    }),
    { defer: true, reason: "MISSION_NANO_HAS_PRIORITY", retryable: true }
  );
  assert.equal(shouldDeferSessionCapture({ automatic: true, run: {}, nanoHostTelemetry: {} }).defer, false);
});

test("partial Nano telemetry preserves prior fields and cannot report cloneUsed without cloneSupported", () => {
  const next = normalizeNanoHostTelemetry({
    hostId: "panel-1",
    cloneSupported: false,
    providerContract: "contract-1",
    busy: true
  }, {
    cloneUsed: true,
    busy: false
  }, { now: 1_000 });
  assert.equal(next.hostId, "panel-1");
  assert.equal(next.providerContract, "contract-1");
  assert.equal(next.cloneUsed, true);
  assert.equal(next.cloneSupported, true);
  assert.equal(next.busy, false);
});

test("full audit queue is ordered, redacted, batch-acknowledged and bounded", () => {
  let queue = createFullAuditQueue();
  queue = appendFullAuditEntries(queue, [{
    event: "runtime.transition",
    message: "state changed",
    data: {
      token: "secret-value",
      safe: "retained"
    }
  }]);
  const batch = fullAuditBatch(queue);
  assert.equal(batch.entries.length, 1);
  assert.equal(batch.firstSequence, 1);
  assert.match(fullAuditNdjson(batch.entries), /runtime\.transition/);
  assert.doesNotMatch(fullAuditNdjson(batch.entries), /secret-value/);
  queue = acknowledgeFullAuditBatch(queue, batch.lastSequence);
  assert.equal(queue.entries.length, 0);
  assert.equal(validateFullAuditDirectoryName("temp"), true);
  assert.equal(validateFullAuditDirectoryName("other"), true);
  assert.equal(validateFullAuditDirectoryName("../temp"), false);
  assert.ok(projectedSegmentBytes(0, batch.entries) > 0);
  assert.equal(fullAuditSinkStatus().enabled, false);
});

test("stable turn ID does not change when virtualized ordinal changes", async () => {
  const a = await stableTurnIdentity({
    conversationKey: "c1",
    role: "assistant",
    sourceMessageId: "message-1",
    text: "Svar",
    ordinal: 5
  });
  const b = await stableTurnIdentity({
    conversationKey: "c1",
    role: "assistant",
    sourceMessageId: "message-1",
    text: "Svar med UI-kontroll",
    ordinal: 99
  });
  assert.equal(a, b);
});

test("delta capture is cumulative and cannot regress turn count", async () => {
  const prior = await buildSessionCapture({
    conversationKey: "c1",
    taskFingerprint: "t1",
    captureId: "capture-1",
    messages: [
      { role: "user", sourceMessageId: "m1", text: "A", ordinal: 0 },
      { role: "assistant", sourceMessageId: "m2", text: "B", ordinal: 1 }
    ]
  });
  const delta = await createDeltaCapture(prior, {
    conversationKey: "c1",
    taskFingerprint: "t1",
    captureId: "capture-2",
    messages: [
      { role: "assistant", sourceMessageId: "m3", text: "C", ordinal: 2 }
    ]
  });
  assert.equal(delta.turns.length, 3);
  assert.equal(delta.capture.turnIds.length, 3);
  assert.equal(delta.capture.deltaTurnIds.length, 1);

  const partial = await buildSessionCapture({
    conversationKey: "c1",
    taskFingerprint: "t1",
    captureId: "capture-3",
    messages: [
      { role: "assistant", sourceMessageId: "m3", text: "C", ordinal: 2 }
    ]
  });
  const reconciled = await reconcileMonotonicCapture(prior, partial);
  assert.equal(reconciled.turns.length, 3);
  assert.equal(reconciled.capture.monotonic, true);
});

test("known identical capture gap permits delta while changed gap forces full", () => {
  const memory = { conversationKey: "c1", branchKey: "b1", taskFingerprint: "t1" };
  const priorCapture = { gaps: [{ startOrdinal: 3, endOrdinal: 5, reason: "VIRTUALIZED_TURN_GAP" }] };
  const stable = captureRefreshRequired({
    memory,
    conversationKey: "c1",
    branchKey: "b1",
    taskFingerprint: "t1",
    gaps: priorCapture.gaps,
    priorCapture
  });
  assert.equal(stable.required, false);
  assert.equal(stable.reason, "DELTA_FROM_STABLE_GAPPED_BASELINE");

  const changed = captureRefreshRequired({
    memory,
    conversationKey: "c1",
    branchKey: "b1",
    taskFingerprint: "t1",
    gaps: [{ startOrdinal: 6, endOrdinal: 7, reason: "VIRTUALIZED_TURN_GAP" }],
    priorCapture
  });
  assert.equal(changed.required, true);
});

test("transcript project binding detects target/control mismatch", () => {
  const binding = inferTargetProjectBinding([
    { text: "Core project ID: 2\nProjekt: EIC backend" }
  ], 63);
  assert.equal(binding.projectId, 2);
  assert.equal(binding.controlProjectId, 63);
  assert.equal(binding.mismatch, true);
  assert.equal(binding.confidence, "HIGH");
});

test("capture fingerprint ignores virtualized assistant count", () => {
  const a = createCaptureFingerprint({
    conversationKey: "c1",
    latestMessageHash: "h1",
    assistantCount: 79
  });
  const b = createCaptureFingerprint({
    conversationKey: "c1",
    latestMessageHash: "h1",
    assistantCount: 18
  });
  assert.equal(a, b);
});

test("mission projection carries run step, next action and assessed risk", () => {
  const mission = createMission({
    modeId: MISSION_MODE_IDS.CHATGPT_CONTINUATION,
    state: "READY",
    windowId: 7
  });
  const synchronized = synchronizeMissionFromRun(mission, runtimeRun(), { selectedTabId: 42 });
  assert.equal(synchronized.currentStep, "UNIT_C");
  assert.equal(synchronized.nextAction, "Verifiera nästa owner-route.");
  assert.equal(synchronized.risk.status, "ASSESSED");
  assert.equal(synchronized.risk.level, 4);
  assert.equal(synchronized.stateRevision, 1);
  assert.equal(synchronized.execution.status, "BOUND");
});

test("claim gate distinguishes no strong claim from unverified strong claims", () => {
  const none = evaluateDecisionClaimReceipts({ completionEvidence: "MILESTONE_CONTINUE · analys fortsätter." });
  assert.equal(none.allowed, true);
  assert.equal(none.verified, false);
  assert.equal(none.status, "NO_STRONG_CLAIMS");

  const strongText = "Workspace ws-1 skapades och filen skrevs; owner-readback visar locks=[].";
  assert.ok(inferStrongClaimTypes(strongText).includes("WORKSPACE"));
  const strong = evaluateDecisionClaimReceipts({ completionEvidence: strongText });
  assert.equal(strong.allowed, false);
  assert.equal(strong.status, "OWNER_RECEIPT_REQUIRED");
});

async function d2Request() {
  return buildMjolnarRequest({
    sourceClass: "LOCAL_STATE_MACHINE",
    triggerType: "OPERATOR_PROXY_REQUIRED",
    actionCode: "MERGE_BRANCH",
    exactTarget: "repo:owner/repo|branch:main|revision:abc",
    proposedAction: "Merge exact bounded branch.",
    expectedEffect: "Owner route reports merged revision.",
    ownerSurface: "FORGEJO_OWNER_ROUTE",
    ownerEvidenceLocator: "forgejo:owner/repo:pr:1",
    reversibility: "YES",
    rollbackPath: "REVERT_EXACT_MERGE_COMMIT",
    readbackPlan: "READ_PR_AND_TARGET_BRANCH",
    humanAuthorityClass: "NOT_REQUIRED",
    materialAmbiguity: "NONE"
  }, {
    sessionId: "run-1",
    conversationLocator: "chatgpt.com:c:abc",
    stableGoal: "Finish exact merge",
    activeWorkUnit: "MERGE_BRANCH",
    verifiedState: ["Owner route and exact target are read."],
    governingAuthority: "USER_CONFIG_AND_EIC_STATE_MACHINE",
    hjalmarVerdict: "GO",
    hjalmarEvidenceLimit: "Bounded exact target",
    hjalmarProvenance: "UNTRUSTED_OR_ABSENT",
    snapshotHash: "snapshot-1"
  });
}

test("M2 produces explicit operator-equivalent mandate below level 10", async () => {
  const request = await d2Request();
  const response = adjudicateMjolnarRequest(request);
  assert.equal(response.verdict, MJOLNAR_VERDICTS.DELEGABLE);
  assert.equal(response.m2_mandate.protocol, M2_MANDATE_PROTOCOL);
  assert.equal(response.m2_mandate.authorityLevel, M2_OPERATOR_EQUIVALENT_LEVEL);
  assert.equal(response.m2_mandate.actualOperatorApproval, false);
  assert.equal(response.m2_mandate.level10Excluded, true);
  request.m2_mandate = response.m2_mandate;
  const prompt = buildD2DelegationPrompt(request);
  assert.match(prompt, /M2_MANDATE_JSON/);
  assert.match(prompt, /not an actual OPERATOR_APPROVAL/);
  const ledger = createMjolnarLedgerEntry(request, response);
  assert.equal(ledger.mandateKind, "M2_MANDATE");
  assert.equal(ledger.actualOperatorApproval, false);
});

test("M2 mandate constructor never converts level 10 into operator approval", async () => {
  const request = await d2Request();
  const mandate = createM2Mandate(request, { issuedAt: 1_000, validityMs: 5_000 });
  assert.equal(mandate.actualOperatorApproval, false);
  assert.equal(mandate.level10Excluded, true);
  assert.ok(mandate.limitations.includes("LEVEL_10_REQUIRES_ACTUAL_OPERATOR"));
});

test("source hardening owns watchdog period, heartbeat lease and opt-in audit UI", async () => {
  const [background, sidepanel, html, content] = await Promise.all([
    readFile(new URL("../background.js", import.meta.url), "utf8"),
    readFile(new URL("../sidepanel.js", import.meta.url), "utf8"),
    readFile(new URL("../sidepanel.html", import.meta.url), "utf8"),
    readFile(new URL("../content.js", import.meta.url), "utf8")
  ]);
  assert.match(background, /existing\?\.periodInMinutes/);
  assert.match(background, /lastLeaseUntil = request\.claimLeaseUntil/);
  assert.match(background, /MISSION_NANO_HAS_PRIORITY/);
  assert.match(background, /fullAuditBatch/);
  assert.match(sidepanel, /showDirectoryPicker/);
  assert.match(sidepanel, /validateFullAuditDirectoryName/);
  assert.match(html, /id="fullAuditLoggingEnabled"/);
  assert.match(html, /Välj C:\\temp/);
  assert.doesNotMatch(content, /latestAssistantHash,\s*String\(assistantMessages\.length\)/);
  assert.match(content, /visibilityStateAtStart/);
});

test("full audit remains disabled in default config", () => {
  assert.equal(createDefaultConfig().fullAuditLoggingEnabled, false);
});
