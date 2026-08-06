import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  applyNanoDecision,
  buildNoProgressRecoveryPivot,
  createContinuity,
  detectLoopCorrection
} from "../lib/continuity.mjs";
import { buildDeterministicDecision } from "../lib/fallback-planner.mjs";
import { NANO_ANALYSIS_MODES } from "../lib/nano-pipeline.mjs";

const incidentActions = [
  "WP25.3.2|hämta och tillämpa eic_initial_session_menu",
  "WP25.3.2|Owner-läs kandidatens package-id och manifest-SHA.",
  "WP25.3.2|Exponera och smoke-verifiera owner-opkod och gör statusread.",
  "WP25.3.2|Bind artifact 1110 till work-package och owner-läs kvittot.",
  "WP25.3.2|Utför workspace.work_package.session.handoff för revision 1.",
  "WP25.3.2|Bind artifact via workspace.work_package.evidence.bind.",
  "WP25.3.2|Kör Hjalmar CONTROL/STRICT_AUDIT och owner-läs kvittot.",
  "WP25.3.2|Kör focused, near-regression och Full Core genom workspace.test.run."
];

function applyStagnantActions(actions = incidentActions) {
  let continuity = createContinuity({ intent: "Fortsätt", workUnit: "WP25.3.2" });
  actions.forEach((actionKey, index) => {
    continuity = applyNanoDecision(continuity, {
      action: "CONTINUE",
      progressDelta: 0,
      requestedAction: actionKey.split("|").at(-1),
      reason: "fixture"
    }, {
      turnIndex: index + 1,
      actionKey
    });
  });
  return continuity;
}

test("v0.6.9 eight no-progress cycles create an autonomous checkpoint, not human handoff", () => {
  const continuity = applyStagnantActions();
  const correction = detectLoopCorrection(continuity);
  assert.equal(continuity.antiLoop.stagnationCycles, 8);
  assert.equal(correction.code, "NO_PROGRESS_CHECKPOINT");
  assert.doesNotMatch(correction.text, /lämna över|human handoff/i);
  assert.match(correction.text, /subsystem-pivot/i);
});

test("v0.6.9 incident replay excludes the recurring Workspace subsystem", () => {
  const continuity = applyStagnantActions(incidentActions.slice(0, 7));
  const pivot = buildNoProgressRecoveryPivot(continuity, {
    currentAction: incidentActions.at(-1),
    existingExclusions: []
  });
  assert.equal(pivot.available, true);
  assert.equal(pivot.subsystem, "WORKSPACE");
  assert.equal(pivot.exclusion, "SUBSYSTEM:WORKSPACE");
  assert.match(pivot.instruction, /Exkludera Workspace/i);
  assert.match(pivot.instruction, /patch\/diff|testlogg|blockerarkvitto/i);
});

test("v0.6.9 subsystem pivot resets the retry budget without fabricating progress", () => {
  let continuity = applyStagnantActions();
  const productiveBefore = continuity.antiLoop.productiveActionCount;
  continuity = applyNanoDecision(continuity, {
    action: "CONTINUE",
    progressDelta: 0,
    requestedAction: "Producera lokal patch och fokustest utanför Workspace.",
    reason: "Deterministisk subsystem-pivot.",
    recoveryPivot: true,
    recoverySubsystem: "WORKSPACE"
  }, {
    turnIndex: 9,
    actionKey: "WP25.3.2|Producera lokal patch och fokustest utanför Workspace."
  });
  assert.equal(continuity.antiLoop.progressDeltas.at(-1), 0);
  assert.equal(continuity.antiLoop.productiveActionCount, productiveBefore);
  assert.equal(continuity.antiLoop.stagnationCycles, 0);
  assert.equal(continuity.antiLoop.lastCorrection.code, "SUBSYSTEM_PIVOT");
  assert.equal(continuity.antiLoop.lastCorrection.subsystem, "WORKSPACE");
});

test("v0.6.9 exhausted subsystem set returns bounded RECOVERING input instead of guessing", () => {
  const continuity = applyStagnantActions();
  const pivot = buildNoProgressRecoveryPivot(continuity, {
    existingExclusions: [
      "SUBSYSTEM:WORKSPACE", "SUBSYSTEM:HJALMAR", "SUBSYSTEM:ARTIFACT",
      "SUBSYSTEM:TEST", "SUBSYSTEM:OWNER_READ", "SUBSYSTEM:META",
      "SUBSYSTEM:OTHER", "SUBSYSTEM:NANO", "SUBSYSTEM:RUNTIME",
      "SUBSYSTEM:REPOSITORY"
    ]
  });
  assert.equal(pivot.available, false);
  assert.equal(pivot.instruction, "");
});

test("v0.6.9 deterministic recovery preserves the actual Nano parse error", () => {
  const decision = buildDeterministicDecision({
    run: {
      maxAutonomousMode: true,
      targetTabId: 1,
      conversationKey: "chatgpt.com:c:test",
      pendingNanoRequest: {
        recoveryReason: "Nano returnerade inte ett komplett JSON-objekt."
      }
    },
    observation: {
      targetResult: {
        valid: true,
        status: "CONTINUE",
        next: "Skapa en lokal patch och kör fokustest."
      }
    },
    continuityProjection: {
      intent: "Reparera incidenten",
      position: { workUnit: "WP25.3.2" },
      nextDirections: [],
      blockers: []
    },
    maxAutonomousMode: true,
    requestMode: NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS
  });
  assert.equal(decision.action, "CONTINUE");
  assert.match(decision.reason, /Nano returnerade inte ett komplett JSON-objekt/i);
  assert.doesNotMatch(decision.reason, /modellhostet svarade inte/i);
});

test("current browser wiring prevents sticky pause and accepts only v13 export", () => {
  const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(background, /buildNoProgressRecoveryPivot/);
  assert.match(background, /NO_PROGRESS_SUBSYSTEM_PIVOT/);
  assert.match(background, /!run\.maxAutonomousMode/);
  assert.match(background, /run\.recovery\.consecutiveNoProgress = 0/);
  assert.match(background, /continuity\.antiLoop\.stagnationCycles = 0/);
  assert.match(background, /assertCurrentExport/);
  assert.match(background, /EXPORT_SCHEMA/);
  assert.match(background, /EXPORT_VERSION/);
  assert.doesNotMatch(background, /eic\.autonom\.export\.v(?:3|4|5|6|7|8|9|10|11|12)/);
  assert.match(background, /if \(!replanGrounding\.valid\)[\s\S]*?\} else \{/);
});

test("v0.6.9 Nano output gets balanced extraction and one schema-bound format repair", () => {
  const panel = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  assert.match(panel, /function extractFirstJsonObject/);
  assert.match(panel, /JSON FORMAT REPAIR ONLY/);
  assert.match(panel, /formatRepairUsed/);
  assert.match(panel, /disableFreshTaskRetry: true/);
});


test("v0.6.9 balanced Nano JSON parser handles prose, nested braces and rejects incomplete output", () => {
  const panel = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  const start = panel.indexOf("function extractFirstJsonObject");
  const end = panel.indexOf("function normalizeDecision", start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  vm.runInNewContext(
    `${panel.slice(start, end)}\nthis.parseJsonModelOutputForTest = parseJsonModelOutput;`,
    context
  );
  const parsed = context.parseJsonModelOutputForTest(
    'prefix {"action":"CONTINUE","reason":"brace } inside string","nested":{"ok":true}} suffix {"ignored":true}'
  );
  assert.equal(parsed.action, "CONTINUE");
  assert.equal(parsed.nested.ok, true);
  assert.throws(
    () => context.parseJsonModelOutputForTest('prefix {"action":"CONTINUE"'),
    /komplett JSON-objekt/
  );
});
