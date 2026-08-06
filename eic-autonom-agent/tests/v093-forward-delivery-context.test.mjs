import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  APP_VERSION,
  CONFIG_SCHEMA,
  RUNTIME_SCHEMA,
  EXPORT_SCHEMA,
  EXPORT_VERSION,
  createDefaultConfig,
  createDefaultRuntime
} from "../lib/contracts.mjs";
import {
  forwardOnlyPolicy,
  assertCurrentSchema,
  currentStateOrFresh,
  assertCurrentExport
} from "../lib/forward-only-policy.mjs";
import {
  ADMISSION_CAPABILITIES,
  COMPLETION_STATES,
  CONTEXT_ROUTER_SCHEMA,
  EVIDENCE_CLASSES,
  assertAdmissionChain,
  assertEvidenceClassForClaim,
  buildProgressiveContextRouter,
  classifyEvidence,
  createAdmissionChain,
  evaluateDirectProgramDelta,
  redactSensitiveTransport,
  resolveCompletionState
} from "../lib/delivery-kernel.mjs";
import {
  UI_COMMANDS,
  UI_COMMAND_SCHEMA,
  UI_SNAPSHOT_SCHEMA,
  createUiCommand,
  createUiSnapshot,
  parseUiCommand,
  readUiSnapshotModel
} from "../lib/ui-contract.mjs";
import {
  CURRENT_NANO_MANDATE,
  CURRENT_TARGET_MANDATE,
  NANO_CORE_PROFILES,
  TARGET_CORE_PROFILES
} from "../lib/core-profiles.mjs";
import { buildNanoDecisionPromptDetailed } from "../lib/nano-pipeline.mjs";
import { TURN_PROTOCOL, TURN_SCHEMA_VERSION } from "../lib/prompt-contract.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const exists = (relative) => fs.existsSync(path.join(root, relative));

test("v0.9.3 declares a forward-only current-version policy", () => {
  const policy = forwardOnlyPolicy();
  assert.equal(policy.since, "0.9.3");
  assert.equal(policy.mode, "CURRENT_VERSION_ONLY");
  assert.equal(policy.migrateOlderState, false);
  assert.equal(policy.acceptOlderExports, false);
  assert.equal(policy.acceptSchemaAliases, false);
  assert.equal(policy.regressionObligationForRemovedBehavior, false);
});

test("v0.9.3 current schemas are the only accepted state schemas", () => {
  assert.equal(APP_VERSION, "0.10.12");
  assert.equal(CONFIG_SCHEMA, "eic.autonom.config.v13");
  assert.equal(RUNTIME_SCHEMA, "eic.autonom.runtime.v13");
  assert.equal(EXPORT_SCHEMA, "eic.autonom.export.v20");
  assert.equal(EXPORT_VERSION, 20);
  assert.equal(assertCurrentSchema(createDefaultConfig(), { schema: CONFIG_SCHEMA, version: 13 }), true);
  assert.throws(
    () => assertCurrentSchema({ schema: "eic.autonom.config.v9", version: 9 }, { schema: CONFIG_SCHEMA, version: 13 }),
    /FORWARD_ONLY_SCHEMA_REQUIRED/
  );
});

test("v0.9.3 old local state is reset, never migrated", () => {
  const result = currentStateOrFresh(
    { schema: "eic.autonom.runtime.v9", version: 9, retained: "forbidden" },
    { schema: RUNTIME_SCHEMA, version: 10, factory: createDefaultRuntime, label: "RUNTIME", now: 1000 }
  );
  assert.equal(result.reset, true);
  assert.equal(result.reason, "FORWARD_ONLY_RESET");
  assert.equal(result.value.schema, RUNTIME_SCHEMA);
  assert.equal(result.value.retained, undefined);
  assert.equal(result.value.forwardOnlyReset.priorSchema, "eic.autonom.runtime.v9");
});

test("v0.9.3 import rejects every older export", () => {
  assert.equal(assertCurrentExport({ schema: EXPORT_SCHEMA, version: EXPORT_VERSION }, {
    schema: EXPORT_SCHEMA,
    version: EXPORT_VERSION
  }), true);
  assert.throws(
    () => assertCurrentExport({ schema: "eic.autonom.export.v12", version: 13 }, {
      schema: EXPORT_SCHEMA,
      version: EXPORT_VERSION
    }),
    /FORWARD_ONLY_SCHEMA_REQUIRED/
  );
});

test("v0.9.3 UI commands require the current schema and reject schema-less aliases", () => {
  const command = createUiCommand({
    command: UI_COMMANDS.PAUSE,
    windowId: 7,
    payload: {},
    requestId: "req-1"
  });
  assert.equal(command.schema, UI_COMMAND_SCHEMA);
  assert.equal(parseUiCommand(command).command, UI_COMMANDS.PAUSE);
  assert.throws(
    () => parseUiCommand({ type: "EIC_UI_COMMAND", command: UI_COMMANDS.PAUSE, windowId: 7, payload: {} }),
    /UI_COMMAND_SCHEMA_UNSUPPORTED/
  );
});

test("v0.9.3 UI snapshots accept only v3", () => {
  const snapshot = createUiSnapshot({
    appVersion: APP_VERSION,
    windowId: 7,
    snapshotId: "snap-1",
    capturedAt: new Date(0).toISOString()
  });
  assert.equal(snapshot.schema, UI_SNAPSHOT_SCHEMA);
  assert.equal(snapshot.snapshotVersion, 3);
  assert.ok(readUiSnapshotModel(snapshot));
  assert.throws(
    () => readUiSnapshotModel({ ...snapshot, schema: "eic.autonom.ui-snapshot.v2", snapshotVersion: 2 }),
    /UI_SNAPSHOT_SCHEMA_UNSUPPORTED/
  );
});

test("delivery regulator blocks zero-delta process work", () => {
  const verdict = evaluateDirectProgramDelta({
    primaryProgramGoal: "Deliver v0.9.3",
    activeMilestone: "Forward-only release",
    boundedCurrentUnit: "Remove compatibility paths",
    proposedAction: "Create another audit register",
    directProgramDelta: 0
  });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reason, "DIRECT_PROGRAM_DELTA_ZERO");
  assert.equal(verdict.disposition, "BOUNDED_STOP");
});

test("delivery regulator emits for material implementation progress", () => {
  const verdict = evaluateDirectProgramDelta({
    primaryProgramGoal: "Deliver v0.9.3",
    activeMilestone: "Forward-only release",
    boundedCurrentUnit: "Remove compatibility paths",
    proposedAction: "Delete old import adapters and verify current import",
    directProgramDelta: 2
  });
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.workClass, "CORE_DELIVERY");
});

test("delivery regulator permits one exact owner control that unlocks delivery", () => {
  const verdict = evaluateDirectProgramDelta({
    primaryProgramGoal: "Deliver v0.9.3",
    activeMilestone: "Forward-only release",
    boundedCurrentUnit: "Persist package",
    proposedAction: "Read package owner receipt",
    directProgramDelta: 0,
    requiredOwnerAction: true,
    omissionFailure: "Package persistence would otherwise be unverified.",
    unlocksNextAction: "Write the verified project handoff."
  });
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.workClass, "REQUIRED_OWNER_OR_SAFETY");
});

test("admission chain blocks an unavailable required capability", () => {
  const chain = createAdmissionChain({
    CAN_EDIT: { available: true, owner: "workspace", locator: "source:1" },
    CAN_TEST: { available: false, reason: "runner unavailable" }
  });
  assert.deepEqual(ADMISSION_CAPABILITIES.includes("CAN_READ_BACK"), true);
  const verdict = assertAdmissionChain(chain, ["CAN_EDIT", "CAN_TEST"]);
  assert.equal(verdict.allowed, false);
  assert.deepEqual(verdict.missing, ["CAN_TEST"]);
});

test("admission chain emits when all required capabilities are owner-bound", () => {
  const chain = createAdmissionChain({
    CAN_EDIT: { available: true, owner: "workspace", locator: "source:1" },
    CAN_TEST: { available: true, owner: "workspace", locator: "run:1" },
    CAN_READ_BACK: { available: true, owner: "workspace", locator: "receipt:1" }
  });
  assert.equal(assertAdmissionChain(chain, ["CAN_EDIT", "CAN_TEST", "CAN_READ_BACK"]).allowed, true);
});

test("evidence taxonomy separates live state, durable effects, derived and dry-run evidence", () => {
  assert.equal(classifyEvidence({
    ownerSurface: "project",
    locator: "project:63",
    readback: true,
    current: true
  }), EVIDENCE_CLASSES.OWNER_LIVE);
  assert.equal(classifyEvidence({
    ownerSurface: "artifact",
    locator: "artifact:1",
    readback: true,
    durableEffect: true
  }), EVIDENCE_CLASSES.OWNER_RECEIPT);
  assert.equal(classifyEvidence({ dryRun: true }), EVIDENCE_CLASSES.DRY_RUN);
  assert.equal(classifyEvidence({}), EVIDENCE_CLASSES.DERIVED_VIEW);
});

test("strong effect and current claims require matching evidence classes", () => {
  assert.equal(assertEvidenceClassForClaim(EVIDENCE_CLASSES.OWNER_RECEIPT, { effectClaim: true }), true);
  assert.equal(assertEvidenceClassForClaim(EVIDENCE_CLASSES.OWNER_LIVE, { currentClaim: true }), true);
  assert.throws(
    () => assertEvidenceClassForClaim(EVIDENCE_CLASSES.DERIVED_VIEW, { effectClaim: true }),
    /OWNER_RECEIPT_REQUIRED/
  );
  assert.throws(
    () => assertEvidenceClassForClaim(EVIDENCE_CLASSES.OWNER_HISTORICAL, { currentClaim: true }),
    /OWNER_LIVE_REQUIRED/
  );
});

test("sensitive transport values become opaque handles", () => {
  const result = redactSensitiveTransport({
    session_locator: "signed-secret-locator",
    nested: {
      lockToken: "lock-secret",
      ordinary: "visible"
    }
  });
  assert.equal(result.redactedCount, 2);
  assert.match(result.value.session_locator, /^\$EIC_SECRET_HANDLE_/);
  assert.match(result.value.nested.lockToken, /^\$EIC_SECRET_HANDLE_/);
  assert.equal(result.value.nested.ordinary, "visible");
  assert.doesNotMatch(JSON.stringify(result.value), /signed-secret-locator|lock-secret/);
});

test("completion separates unit, milestone, blocked program and terminal program", () => {
  const unit = resolveCompletionState({
    unitDone: true,
    nextAction: "Continue milestone."
  });
  assert.equal(unit.unitState, COMPLETION_STATES.UNIT_DONE);
  assert.equal(unit.programState, COMPLETION_STATES.MILESTONE_CONTINUE);
  assert.equal(unit.autonomy, "CONTINUE");

  const blocked = resolveCompletionState({
    blocked: true,
    nextAction: "Owner unlock required."
  });
  assert.equal(blocked.programState, COMPLETION_STATES.PROGRAM_BLOCKED);
  assert.equal(blocked.autonomy, "CONTINUE");

  const done = resolveCompletionState({
    unitDone: true,
    milestoneDone: true,
    programDone: true,
    completionEvidence: "Owner-read terminal receipt."
  });
  assert.equal(done.programState, COMPLETION_STATES.PROGRAM_DONE);
  assert.equal(done.autonomy, "DONE");
  assert.equal(done.terminal, true);
});

test("progressive context carries references and delta, not full conversation or assistant prose", async () => {
  const router = await buildProgressiveContextRouter({
    primaryProgramGoal: "Deliver v0.9.3",
    activeMilestone: "Forward-only release",
    boundedCurrentUnit: "Compact Nano context",
    mandate: { version: "target-core-v3", sha256: "a".repeat(64), ref: "mandate:target-core-v3" },
    ownerEvidence: ["project:63", "revision:167"],
    blockers: ["Desktop Chrome not executed"],
    nextDirection: "Run source regression",
    observationAnchors: ["OWNER_RECEIPT: revision:167"]
  });
  assert.equal(router.schema, CONTEXT_ROUTER_SCHEMA);
  assert.match(router.digest, /^[a-f0-9]{64}$/);
  assert.equal(router.progressiveDisclosure.default, "REFERENCE_PLUS_DELTA");
  assert.equal(router.progressiveDisclosure.fullAssistantProseIncluded, false);
  assert.equal(router.progressiveDisclosure.fullConversationIncluded, false);
});

test("Nano prompt is compact reference-plus-delta and excludes supplied transcript bodies", () => {
  const built = buildNanoDecisionPromptDetailed({
    run: {
      runId: "run-1",
      state: "ASSESSING",
      activeMissionId: "milestone-1",
      currentWorkUnit: "Implement current-only import"
    },
    request: { requestId: "req-1", mode: "CONTINUATION_ANALYSIS" },
    observation: {
      responseText: "SHOULD_NOT_BE_COPIED_" + "X".repeat(4000),
      conversationExcerpt: "FULL_CONVERSATION_FORBIDDEN_" + "Y".repeat(4000),
      targetResult: { valid: true, status: "CONTINUE", next: "Verify current schema." }
    },
    config: {
      targetMandate: "FULL_MANDATE_FORBIDDEN_" + "M".repeat(4000),
      targetMandateVersion: "target-core-v3"
    },
    continuityProjection: {
      intent: "Deliver v0.9.3",
      position: { phase: "FORWARD_ONLY", workUnit: "Implement current-only import" },
      verifiedFacts: [{ locator: "project:63" }],
      blockers: []
    },
    maxPromptChars: 12000
  });
  assert.equal(built.budget.withinBudget, true);
  assert.match(built.prompt, /NANO DECISION REQUEST v12/);
  assert.match(built.prompt, /REFERENCE_PLUS_DELTA/);
  assert.doesNotMatch(built.prompt, /SHOULD_NOT_BE_COPIED_|FULL_CONVERSATION_FORBIDDEN_|FULL_MANDATE_FORBIDDEN_/);
  assert.equal(built.budget.allocation.priorAssistantProseChars, 0);
  assert.equal(built.budget.allocation.fullConversationChars, 0);
  assert.equal(built.budget.allocation.fullMandateChars, 0);
});

test("current mandates are delivery-first and contain no compatibility profile", () => {
  assert.match(CURRENT_NANO_MANDATE, /DELIVERY FIRST/);
  assert.match(CURRENT_NANO_MANDATE, /progressive disclosure/i);
  assert.match(CURRENT_TARGET_MANDATE, /LEVERANS FÖRST/);
  assert.deepEqual(NANO_CORE_PROFILES.map((item) => item.id), [
    "STANDARD_DELIVERY", "WORKSPACE_AWARE_GENERAL", "ARCHAEOLOGY_LONG", "APP_AUDIT_LONG", "CUSTOM"
  ]);
  assert.equal(TARGET_CORE_PROFILES.some((item) => /LEGACY|V0[0-9]/.test(item.id)), false);
});

test("current turn protocol is EIC-AA/5", () => {
  assert.equal(TURN_PROTOCOL, "EIC-AA/5");
  assert.equal(TURN_SCHEMA_VERSION, 5);
});

test("bundle contains no executable migration modules or imports", () => {
  for (const name of [
    "lib/migration-v2-v3.mjs",
    "lib/migration-v3-v4.mjs",
    "lib/migration-v4-v5.mjs",
    "lib/migration-v5-v6.mjs",
    "lib/migration-v6-v7.mjs",
    "lib/migration-v7-v8.mjs",
    "lib/migration-v8-v9.mjs"
  ]) {
    assert.equal(exists(name), false, name);
  }
  for (const name of ["background.js", "scripts/package.mjs", "scripts/validate.mjs"]) {
    assert.doesNotMatch(read(name), /(?:from|import\()\s*["'][^"']*migration-v[0-9]+-v[0-9]+/);
  }
});

test("bundle and repository-local policy codify forward-only v0.9.3+", () => {
  for (const name of [
    "EIC.md",
    "README.md",
    "docs/V0_9_3_FORWARD_ONLY_POLICY.md",
    "docs/V0_9_3_DELIVERY_CONTEXT_ARCHITECTURE.md"
  ]) {
    const text = read(name);
    assert.match(text, /0\.9\.3/);
    assert.match(text, /backward compat|bakåtkompat/i);
  }
});

test("package script produces only source, standard and browser artifacts", () => {
  const script = read("scripts/package.mjs");
  assert.match(script, /standard\.zip/);
  assert.match(script, /browser\.zip/);
  assert.match(script, /source\.zip/);
  assert.doesNotMatch(script, /legacy|aliasZip|unversioned/i);
});
