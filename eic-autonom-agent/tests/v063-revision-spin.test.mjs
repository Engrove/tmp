import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isMetaOnlyAction,
  validateDecisionGrounding
} from "../lib/decision-grounding.mjs";
import {
  buildDeterministicDecision,
  repairDeterministicDecision
} from "../lib/fallback-planner.mjs";
import {
  markDeterministicPending
} from "../lib/protocol-fast-path.mjs";
import {
  DETERMINISTIC_GATE_ACTIONS,
  deterministicSourceExhausted,
  evaluateDeterministicDispatch,
  prepareDeterministicDispatch
} from "../lib/deterministic-dispatch-gate.mjs";
import {
  NANO_ANALYSIS_MODES,
  NANO_DECISION_SOURCE,
  createNanoRequest
} from "../lib/nano-pipeline.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");

const INCIDENT_NEXT =
  "Reconcile or recreate the exact immutable v6 candidate through the canonical Workspace/Forgejo publication route, then verify a new descendant branch commit, exact 111-path digest/hash parity and stable publish status with verify_remote=true before creating the WP25.2.4 PR.";

function projection() {
  return {
    intent: "Slutför EIC backend WP25.2.",
    position: {
      workUnit: "Reconcile immutable v6 publication candidate",
      workUnitId: "wu-v063"
    },
    verifiedFacts: [],
    targetClaims: [
      { claim: "Målsessionen returnerade ett turn-bundet CONTINUE." }
    ],
    inferences: [],
    constraints: []
  };
}

test("exakt v0.6.2 desktopincident är en konkret engineering action", () => {
  assert.equal(isMetaOnlyAction(INCIDENT_NEXT), false);

  const result = validateDecisionGrounding({
    action: "CONTINUE",
    taskIntent: projection().intent,
    workUnit: projection().position.workUnit,
    requestedAction: INCIDENT_NEXT,
    targetClaims: ["Målsessionen returnerade ett turn-bundet CONTINUE."],
    contextEvidence: ["EIC_TURN: turn-df609fac-ddb9-4a26-88f9-d67d49e781c7"],
    requiredEvidence: [
      "New descendant branch commit",
      "111-path digest/hash parity",
      "workspace.forgejo.publish.status verify_remote=true"
    ]
  }, projection());

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("generisk verify utan target eller output förblir meta-only", () => {
  assert.equal(isMetaOnlyAction("Verify the plan"), true);
  assert.equal(isMetaOnlyAction("Review target claims"), true);
});

test("owner-read med exact route och observerbar output är konkret", () => {
  assert.equal(
    isMetaOnlyAction(
      "Read workspace.forgejo.publish.status for request cwp_wp2524_publication_recovery and return status, commit hash and delta with verify_remote=true."
    ),
    false
  );
});

test("deterministic repair är bounded och lägger till exact target/output", () => {
  const original = {
    action: "CONTINUE",
    taskIntent: projection().intent,
    workUnit: projection().position.workUnit,
    requestedAction: "Verify the plan",
    targetClaims: ["Målsessionen föreslog fortsatt arbete."],
    contextEvidence: ["Turn-bundet målprotokoll"],
    requiredEvidence: []
  };
  const repaired = repairDeterministicDecision(original, {
    run: {
      targetTabId: 1974093336,
      conversationKey: "chatgpt.com:c:6a6d9e55-5aa8-83eb-a3d7-773d1bab5d0a"
    },
    observation: {
      targetResult: {
        valid: true,
        status: "CONTINUE",
        turnId: "turn-v063",
        next: "Verify the plan"
      }
    },
    continuityProjection: projection(),
    validationErrors: ["META_ONLY_ACTION"]
  });

  assert.equal(repaired.repaired, true);
  assert.equal(repaired.reason, "META_ONLY_TO_OWNER_READ");
  assert.match(repaired.decision.requestedAction, /tab:1974093336/);
  assert.match(repaired.decision.requestedAction, /locator/);
  assert.match(repaired.decision.requestedAction, /förändringsdelta/);
  assert.equal(isMetaOnlyAction(repaired.decision.requestedAction), false);

  const grounding = validateDecisionGrounding(repaired.decision, projection());
  assert.equal(grounding.valid, true, grounding.errors.join(", "));
});

test("deterministic pending initieras med at-most-once guard", () => {
  const request = createNanoRequest({
    requestId: "nano-request-v063",
    observationId: "observation-v063",
    mode: NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS,
    now: 1000
  });
  const pending = markDeterministicPending(
    request,
    NANO_DECISION_SOURCE.DETERMINISTIC_RECOVERY
  );
  assert.equal(pending.status, "DETERMINISTIC_PENDING");
  assert.equal(pending.deterministicDispatchState, "ARMED");
  assert.equal(pending.deterministicDispatchAttempts, 0);
  assert.equal(pending.deterministicFailureCount, 0);
});

test("deterministic callback-lease tillåter en schedule och därefter rena WAIT-snapshots", () => {
  const request = {
    requestId: "nano-request-spin",
    deterministicDispatchState: "ARMED",
    deterministicDispatchAttempts: 0,
    deterministicScheduledAt: null
  };
  const firstGate = evaluateDeterministicDispatch(request, { now: 1_000 });
  assert.equal(firstGate.action, DETERMINISTIC_GATE_ACTIONS.SCHEDULE);

  const dispatched = prepareDeterministicDispatch(request, {
    decisionDigest: "digest-1",
    now: 1_000
  });
  assert.equal(dispatched.deterministicDispatchAttempts, 1);

  for (let tick = 1_001; tick < 16_000; tick += 137) {
    const gate = evaluateDeterministicDispatch(dispatched, { now: tick });
    assert.equal(gate.action, DETERMINISTIC_GATE_ACTIONS.WAIT);
  }
});

test("callback attempt ceiling går till bounded reconciliation efter två utgångna leases", () => {
  const first = prepareDeterministicDispatch({
    deterministicDispatchState: "ARMED",
    deterministicDispatchAttempts: 0
  }, { decisionDigest: "one", now: 1_000 });

  const retryGate = evaluateDeterministicDispatch(first, { now: 16_001 });
  assert.equal(retryGate.action, DETERMINISTIC_GATE_ACTIONS.SCHEDULE);

  const second = prepareDeterministicDispatch(first, {
    decisionDigest: "two",
    now: 16_001
  });
  assert.equal(second.deterministicDispatchAttempts, 2);

  assert.equal(
    evaluateDeterministicDispatch(second, { now: 20_000 }).action,
    DETERMINISTIC_GATE_ACTIONS.WAIT
  );
  assert.equal(
    evaluateDeterministicDispatch(second, { now: 31_002 }).action,
    DETERMINISTIC_GATE_ACTIONS.RECOVER
  );

  assert.match(background, /Deterministic callback-spin avbruten/);
  assert.match(background, /DETERMINISTIC_CALLBACK_RECONCILE/);
});

test("source exhaustion binds till exakt source och observation", () => {
  const run = {
    deterministicGroundingFailure: {
      digest: "deadbeef",
      source: NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL,
      observationId: "observation-1"
    }
  };
  assert.equal(deterministicSourceExhausted(run, {
    source: NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL,
    observationId: "observation-1"
  }), true);
  assert.equal(deterministicSourceExhausted(run, {
    source: NANO_DECISION_SOURCE.DETERMINISTIC_RECOVERY,
    observationId: "observation-1"
  }), false);
  assert.equal(deterministicSourceExhausted(run, {
    source: NANO_DECISION_SOURCE.DETERMINISTIC_PROTOCOL,
    observationId: "observation-2"
  }), false);
});

test("deterministic grounding kan inte återarma identisk deterministic source", () => {
  const deterministicFailureBlock = background.match(
    /if \(source !== NANO_DECISION_SOURCE\.NANO\) \{[\s\S]*?Deterministic grounding-spin avbruten[\s\S]*?return snapshotForWindow\(windowId\);\s*\}/
  )?.[0] || "";
  assert.ok(deterministicFailureBlock);
  assert.doesNotMatch(deterministicFailureBlock, /markDeterministicPending/);
  assert.match(deterministicFailureBlock, /run\.pendingNanoRequest = null/);
  assert.match(deterministicFailureBlock, /STATES\.RECOVERING/);
  assert.match(background, /Deterministic source exhausted — väntar på ny evidens/);
  assert.match(background, /deterministicSourceExhausted/);
});

test("audit coalescing finns och behåller repeat count", () => {
  assert.match(background, /age <= 5_000/);
  assert.match(background, /repeatCount:/);
  assert.match(background, /items\.slice\(0, 12\)/);
});

test("semantisk Mjölnar-bedömning får inte påstå VERIFIED_EFFECT", () => {
  const marker = "Klassificering före målprompt. Ingen Mjölnar-dispatch, readback eller VERIFIED_EFFECT påstås.";
  assert.ok(background.includes(marker));
  const semanticBlock = background.match(
    /const semanticReadRequired[\s\S]*?evidence_limit: "Klassificering före målprompt\. Ingen Mjölnar-dispatch, readback eller VERIFIED_EFFECT påstås\."/
  )?.[0] || "";
  assert.ok(semanticBlock);
  assert.doesNotMatch(semanticBlock, /run\.mjolnar\.state = MJOLNAR_STATES\.VERIFIED_EFFECT/);
});

test("giltig incidentaction behålls oförändrad av deterministic planner", () => {
  const decision = buildDeterministicDecision({
    run: {
      targetTabId: 1974093336,
      conversationKey: "chatgpt.com:c:incident",
      maxAutonomousMode: true
    },
    observation: {
      targetResult: {
        valid: true,
        status: "CONTINUE",
        next: INCIDENT_NEXT,
        completionEvidence: "",
        turnId: "turn-df609fac-ddb9-4a26-88f9-d67d49e781c7"
      }
    },
    continuityProjection: projection(),
    maxAutonomousMode: true,
    requestMode: NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS
  });
  assert.equal(decision.action, "CONTINUE");
  assert.equal(decision.requestedAction, INCIDENT_NEXT);
  assert.match(decision.reason, /v0\.6\.4-policy/);
});
