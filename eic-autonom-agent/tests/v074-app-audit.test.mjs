import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  APP_AUDIT_EFFECT_CEILING,
  APP_AUDIT_EVENT_PROTOCOL,
  APP_AUDIT_GATES,
  APP_AUDIT_LEDGER,
  createAuditRunState,
  statusTransitionAllowed
} from "../lib/app-audit-contract.mjs";
import {
  applyAuditEvent,
  auditEventPlacement,
  computeAuditProgress,
  evaluateAuditEvent,
  parseAuditEvent,
  stripAuditEventFromText
} from "../lib/app-audit-parser.mjs";
import {
  buildAppAuditStartAnalysis,
  buildAppAuditStartPrompt
} from "../lib/app-audit-prompt.mjs";
import { RUN_MODES } from "../lib/contracts.mjs";
import { parseTargetResult } from "../lib/prompt-contract.mjs";

const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
const sidepanel = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");
const sidepanelHtml = await readFile(new URL("../sidepanel.html", import.meta.url), "utf8");

const TRAILER = [
  "EIC_TURN: turn-abc",
  "EIC_NEXT: Kor mikrotest 8",
  "EIC_COMPLETION_EVIDENCE: UNIT_DONE · Mikrotest 7 är klart.",
  "EIC_NEXT_ACTOR: AGENT",
  "EIC_AUTONOMY: CONTINUE"
];
const FP_A = "a".repeat(64);
const FP_B = "b".repeat(64);

function auditBlock(overrides = {}) {
  const event = {
    protocol: APP_AUDIT_EVENT_PROTOCOL,
    run_id: "audit-20260803-001",
    turn_id: "turn-abc",
    step_no: 7,
    phase: "MICRO_TEST",
    outcome: "PASS",
    coverage_cell: "session-expiry",
    finding_id: null,
    finding_status: null,
    fingerprint: null,
    severity: null,
    major_candidate: false,
    reproduction_recorded: false,
    database_receipt: {
      relative_path: "analysis/eic-app-audit/audit-20260803-001/findings.sqlite3",
      row_type: "step",
      row_id: "STEP-0007"
    },
    owner_receipt: null,
    next_micro_step: "Kor mikrotest 8",
    ...overrides
  };
  return ["EIC_APP_AUDIT_EVENT", JSON.stringify(event, null, 2)].join("\n");
}

function response(blockText, { after = false } = {}) {
  const body = ["Mikrotest 7 kordes.", ""];
  return after
    ? body.concat(TRAILER, blockText).join("\n")
    : body.concat(blockText, "", TRAILER).join("\n");
}

// ---------------------------------------------------------------------------
// Mode wiring
// ---------------------------------------------------------------------------

test("v0.7.4 registers APP_AUDIT_LONG without disturbing the existing modes", () => {
  assert.equal(RUN_MODES.APP_AUDIT_LONG, "APP_AUDIT_LONG");
  assert.equal(RUN_MODES.WAITING_CONTINUE, "WAITING_CONTINUE");
  assert.equal(RUN_MODES.NEW_SESSION, "NEW_SESSION");
});

test("v0.7.4 keeps the audit mode orthogonal to the Mjölnar rollout", () => {
  assert.equal(APP_AUDIT_EFFECT_CEILING.level, 5);
  for (const forbidden of ["MERGE_BRANCH", "CREATE_RELEASE", "DEPLOY_PRODUCTION", "CHANGE_PERMISSION"]) {
    assert.ok(APP_AUDIT_EFFECT_CEILING.forbiddenEffects.includes(forbidden), `saknar ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// Trailer placement — measured, not assumed
// ---------------------------------------------------------------------------

test("v0.7.4 audit block before the trailer leaves the trailer readable", () => {
  const text = response(auditBlock());
  assert.equal(auditEventPlacement(text), "BEFORE_TRAILER");
  const result = parseTargetResult(text, "turn-abc");
  assert.equal(result.valid, true, `trailer bruten: ${result.reason}`);
  assert.equal(result.status, "CONTINUE");
});

test("v0.7.4 refuses an audit block placed after the trailer", () => {
  // Measured, not assumed: a block after the trailer is only *sometimes* fatal to
  // `parseTargetResult`. The scanner reads the last 24 non-empty lines and
  // `stripCodeAndQuotes` drops 4-space-indented lines, so a 22-line event with 2-space
  // JSON indent collapses to 19 and the trailer survives with one line to spare. One more
  // field flips it. The addon therefore gates on placement instead of on that margin.
  const text = response(auditBlock(), { after: true });
  assert.equal(auditEventPlacement(text), "AFTER_TRAILER");
  const parsed = parseAuditEvent(text);
  const gate = evaluateAuditEvent(parsed.event, {
    auditState: createAuditRunState("audit-20260803-001"),
    expectedRunId: "audit-20260803-001",
    expectedTurnId: "turn-abc",
    placement: auditEventPlacement(text),
    markerCount: parsed.block.markerCount
  });
  assert.equal(gate.valid, false);
  assert.ok(gate.errors.includes(APP_AUDIT_GATES.EVENT_AFTER_TRAILER));

  // A long enough block does break the trailer outright, which is why the margin is not
  // something to rely on.
  const longBlock = ["EIC_APP_AUDIT_EVENT"].concat(
    Array.from({ length: 40 }, (_, index) => `note ${index}`)
  ).join("\n");
  const broken = ["Klar."].concat(TRAILER, [longBlock]).join("\n");
  assert.equal(parseTargetResult(broken, "turn-abc").valid, false);
});

test("v0.7.4 the audit block does not consume the trailer's DOM-noise margin", () => {
  // The trailer scanner reads the last 24 non-empty lines from the end, so a block placed
  // before the trailer costs nothing. The margin is 20 trailing lines with or without it.
  const noise = Array.from({ length: 20 }, () => "Kopiera");
  const withBlock = response(auditBlock()).split("\n").concat(noise).join("\n");
  const withoutBlock = ["Mikrotest 7 kordes."].concat(TRAILER, noise).join("\n");
  assert.equal(parseTargetResult(withBlock, "turn-abc").valid, true);
  assert.equal(parseTargetResult(withoutBlock, "turn-abc").valid, true);
});

// ---------------------------------------------------------------------------
// Parsing from innerText
// ---------------------------------------------------------------------------

test("v0.7.4 parses the event from fence-free innerText", () => {
  const parsed = parseAuditEvent(response(auditBlock()));
  assert.equal(parsed.valid, true);
  assert.equal(parsed.event.stepNo, 7);
  assert.equal(parsed.event.coverageCell, "session-expiry");
  assert.equal(parsed.event.databaseReceipt.rowId, "STEP-0007");
});

test("v0.7.4 reports a missing or malformed event distinctly", () => {
  assert.equal(parseAuditEvent("Inget event alls.").reason, APP_AUDIT_GATES.EVENT_MISSING);
  assert.equal(
    parseAuditEvent("EIC_APP_AUDIT_EVENT\n{ \"protocol\": }").reason,
    APP_AUDIT_GATES.EVENT_MALFORMED
  );
});

// ---------------------------------------------------------------------------
// The gates the addon can actually decide
// ---------------------------------------------------------------------------

const baseState = () => createAuditRunState("audit-20260803-001", { testNeed: "x" });

function gateFor(overrides = {}, state = baseState(), turnId = "turn-abc") {
  const parsed = parseAuditEvent(response(auditBlock({ turn_id: turnId, ...overrides })));
  return evaluateAuditEvent(parsed.event, {
    auditState: state,
    expectedRunId: "audit-20260803-001",
    expectedTurnId: turnId,
    markerCount: parsed.block.markerCount
  });
}

test("v0.7.4 accepts a well-formed step", () => {
  const gate = gateFor();
  assert.equal(gate.valid, true, gate.errors.join(", "));
});

test("v0.7.4 rejects a non-monotonic step number", () => {
  const state = { ...baseState(), lastStepNo: 9 };
  assert.ok(gateFor({ step_no: 7 }, state).errors.includes(APP_AUDIT_GATES.STEP_NOT_MONOTONIC));
  assert.ok(gateFor({ step_no: 9 }, state).errors.includes(APP_AUDIT_GATES.STEP_NOT_MONOTONIC));
  assert.equal(gateFor({ step_no: 10 }, state).valid, true);
});

test("v0.7.4 binds the event to the addon's own run and turn identity", () => {
  assert.ok(gateFor({ run_id: "annan-run" }).errors.includes(APP_AUDIT_GATES.RUN_ID_MISMATCH));
  assert.ok(gateFor({ turn_id: "turn-fel" }).errors.includes(APP_AUDIT_GATES.TURN_ID_MISMATCH));
});

test("v0.7.4 refuses a jump from observation straight to accepted", () => {
  const gate = gateFor({
    outcome: "FINDING_CANDIDATE",
    finding_id: "F-0003",
    finding_status: "ACCEPTED_FINDING",
    major_candidate: true
  });
  assert.ok(gate.errors.includes(APP_AUDIT_GATES.MAJOR_WITHOUT_REVIEW));
  assert.equal(statusTransitionAllowed("OBSERVED", "ACCEPTED_FINDING"), false);
  assert.equal(statusTransitionAllowed("REPRODUCTION_REQUIRED", "ACCEPTED_FINDING"), true);
});

test("v0.7.4 enforces the two-turn readback rule", () => {
  let state = baseState();
  const reproduction = parseAuditEvent(response(auditBlock({
    step_no: 8, phase: "REPRODUCTION", outcome: "ANOMALY", finding_id: "F-0003",
    finding_status: "REPRODUCTION_REQUIRED", fingerprint: FP_A,
    reproduction_recorded: true,
    database_receipt: {
      relative_path: "analysis/eic-app-audit/audit-20260803-001/findings.sqlite3",
      row_type: "step", row_id: "STEP-000008"
    }
  })));
  state = applyAuditEvent(state, reproduction.event, { turnId: "turn-1", at: "2026-08-03T00:00:00Z" });
  const acceptEvent = parseAuditEvent(response(auditBlock({
    step_no: 9, phase: "MAJOR_REVIEW", outcome: "ANOMALY", finding_id: "F-0003",
    finding_status: "ACCEPTED_FINDING", fingerprint: FP_A,
    database_receipt: {
      relative_path: "analysis/eic-app-audit/audit-20260803-001/findings.sqlite3",
      row_type: "review", row_id: "REV-F-0003-001"
    }
  })));
  state = applyAuditEvent(state, acceptEvent.event, { turnId: "turn-2", at: "2026-08-03T00:01:00Z" });

  // Same turn as the acceptance → refused.
  const sameTurn = gateFor({
    step_no: 10, outcome: "ANOMALY", finding_id: "F-0003",
    finding_status: "PERSISTED", fingerprint: FP_A,
    database_receipt: {
      relative_path: "analysis/eic-app-audit/audit-20260803-001/findings.sqlite3",
      row_type: "sink_receipt", row_id: "SINK-AAAAAAAAAAAAAAAA"
    },
    owner_receipt: {
      sink_type: "FORGEJO_ISSUE_COMMENT", target: "o/r#42", operation: "issue.comment",
      result_state: "READBACK_VERIFIED",
      owner_readback_locator: "forgejo://o/r/issues/42/comments/517"
    }
  }, state, "turn-2");
  assert.ok(sameTurn.errors.includes(APP_AUDIT_GATES.READBACK_SAME_TURN));

  // A later turn → accepted.
  const laterTurn = gateFor({
    step_no: 10, outcome: "ANOMALY", finding_id: "F-0003",
    finding_status: "PERSISTED", fingerprint: FP_A,
    database_receipt: {
      relative_path: "analysis/eic-app-audit/audit-20260803-001/findings.sqlite3",
      row_type: "sink_receipt", row_id: "SINK-AAAAAAAAAAAAAAAA"
    },
    owner_receipt: {
      sink_type: "FORGEJO_ISSUE_COMMENT", target: "o/r#42", operation: "issue.comment",
      result_state: "READBACK_VERIFIED",
      owner_readback_locator: "forgejo://o/r/issues/42/comments/517"
    }
  }, state, "turn-3");
  assert.equal(laterTurn.valid, true, laterTurn.errors.join(", "));
});

test("v0.7.4 refuses a weak sink state as persistence", () => {
  const state = {
    ...baseState(),
    findings: { "F-0003": { findingId: "F-0003", status: "ACCEPTED_FINDING", reviewedAtTurn: "turn-1", acceptedAtTurn: "turn-1" } }
  };
  for (const resultState of ["REQUEST_SENT", "WRITE_ATTEMPTED", "PENDING"]) {
    const gate = gateFor({
      step_no: 11, finding_id: "F-0003", finding_status: "PERSISTED",
      fingerprint: FP_A,
      database_receipt: {
        relative_path: "analysis/eic-app-audit/audit-20260803-001/findings.sqlite3",
        row_type: "sink_receipt", row_id: "SINK-AAAAAAAAAAAAAAAA"
      },
      owner_receipt: {
        sink_type: "FORGEJO_ISSUE_COMMENT", target: "o/r#42", operation: "issue.comment",
        result_state: resultState, owner_readback_locator: "forgejo://o/r/issues/42/comments/517"
      }
    }, state, "turn-9");
    assert.ok(gate.errors.includes(APP_AUDIT_GATES.RECEIPT_WEAK_STATE), `accepterade ${resultState}`);
  }
});

test("v0.7.4 refuses persistence without any receipt", () => {
  const state = {
    ...baseState(),
    findings: { "F-0003": { findingId: "F-0003", status: "ACCEPTED_FINDING", reviewedAtTurn: "turn-1", acceptedAtTurn: "turn-1" } }
  };
  const gate = gateFor({
    step_no: 12, finding_id: "F-0003", finding_status: "PERSISTED", fingerprint: FP_A,
    database_receipt: {
      relative_path: "analysis/eic-app-audit/audit-20260803-001/findings.sqlite3",
      row_type: "sink_receipt", row_id: "SINK-BBBBBBBBBBBBBBBB"
    }
  }, state, "turn-9");
  assert.ok(gate.errors.includes(APP_AUDIT_GATES.PERSISTED_WITHOUT_RECEIPT));
});

test("v0.7.4 detects a fingerprint conflict on a reused finding id", () => {
  const state = {
    ...baseState(),
    findings: { "F-0003": { findingId: "F-0003", fingerprint: FP_A, status: "OBSERVED" } }
  };
  const gate = gateFor({
    step_no: 13, finding_id: "F-0003", finding_status: "REPRODUCTION_REQUIRED", reproduction_recorded: true, phase: "REPRODUCTION", fingerprint: FP_B
  }, state);
  assert.ok(gate.errors.includes(APP_AUDIT_GATES.FINDING_ID_FINGERPRINT_CONFLICT));
});

test("v0.7.4 refuses a database path that escapes the run directory", () => {
  const gate = gateFor({
    database_receipt: { relative_path: "../../etc/passwd", row_type: "step", row_id: "STEP-0007" }
  });
  assert.ok(gate.errors.includes(APP_AUDIT_GATES.DATABASE_PATH_ESCAPE));
});

test("v0.7.4 requires a row id for any turn that claims to have written one", () => {
  const gate = gateFor({ database_receipt: { relative_path: "analysis/x.sqlite3", row_type: "step", row_id: "" } });
  assert.ok(gate.errors.includes(APP_AUDIT_GATES.DATABASE_RECEIPT_MISSING));
});

test("v0.7.4 blocks secret-shaped values before durable addon storage", () => {
  const gate = gateFor({ next_micro_step: "Anvand token ghp_abcdefghijklmnopqrstuvwxyz012345" });
  assert.ok(gate.errors.includes(APP_AUDIT_GATES.SECRET_SHAPED_VALUE));
  assert.equal(gate.valid, false);
});

test("v0.7.4 refuses DONE before any export or sink was claimed", () => {
  const gate = gateFor({ step_no: 40, outcome: "DONE", next_micro_step: "NONE" });
  assert.ok(gate.errors.includes(APP_AUDIT_GATES.DONE_WITHOUT_EXPORT_OR_SINK));
});

// ---------------------------------------------------------------------------
// Progress — the anti-loop collision this mode exists to avoid
// ---------------------------------------------------------------------------

test("v0.7.4 derives progress from step number and coverage, not from the model", () => {
  const state = { ...baseState(), lastStepNo: 7, coverageCells: ["session-expiry"] };
  const parsed = parseAuditEvent(response(auditBlock({ step_no: 8, coverage_cell: "retry-idempotens" })));
  const progress = computeAuditProgress(parsed.event, state);
  assert.equal(progress.stepAdvanced, true);
  assert.equal(progress.newCoverage, true);
  assert.ok(progress.delta >= 2);
  assert.equal(progress.productive, true);
});

test("v0.7.4 reports no progress when a step repeats a covered cell without advancing", () => {
  const state = { ...baseState(), lastStepNo: 8, coverageCells: ["session-expiry"] };
  const parsed = parseAuditEvent(response(auditBlock({ step_no: 8, coverage_cell: "session-expiry" })));
  const progress = computeAuditProgress(parsed.event, state);
  assert.equal(progress.productive, false);
  assert.equal(progress.delta, 0);
});

test("v0.7.4 substitutes audit progress into the anti-loop path", () => {
  assert.match(background, /function auditProgressDelta\(run, fallbackDelta\)/);
  assert.match(background, /run\.auditLastGate\?\.progress\?\.delta/);
  assert.match(background, /if \(!run\.auditLastGate\?\.valid\) return 0/);
  assert.match(background, /decision\.progressDelta = auditProgressDelta\(run, deterministicProgress\.value\);/);
  assert.match(background, /run\.recovery\.consecutiveNoProgress = decision\.progressDelta > 0/);
});

// ---------------------------------------------------------------------------
// Nano input budget
// ---------------------------------------------------------------------------

test("v0.7.4 strips the event block out of the text budgeted for Nano", () => {
  const text = response(auditBlock());
  const stripped = stripAuditEventFromText(text);
  assert.ok(stripped.removedChars > 200, `bara ${stripped.removedChars} tecken togs bort`);
  assert.equal(stripped.text.includes("EIC_APP_AUDIT_EVENT"), false);
  assert.equal(stripped.text.includes("EIC_AUTONOMY: CONTINUE"), true);
});

test("v0.7.4 leaves a non-audit response untouched", () => {
  const text = ["Vanligt svar."].concat(TRAILER).join("\n");
  assert.equal(stripAuditEventFromText(text).removedChars, 0);
});

// ---------------------------------------------------------------------------
// Provenance — nothing here is a verified fact
// ---------------------------------------------------------------------------

test("v0.7.4 records every audit claim as target-session provenance", () => {
  let state = baseState();
  const parsed = parseAuditEvent(response(auditBlock({
    step_no: 8, finding_id: "F-0001", finding_status: "OBSERVED", fingerprint: FP_A
  })));
  state = applyAuditEvent(state, parsed.event, { turnId: "turn-1", at: "2026-08-03T00:00:00Z" });
  assert.equal(state.findings["F-0001"].provenance, "target-session-claim");
  assert.equal(state.lastStepNo, 8);
  assert.ok(state.coverageCells.includes("session-expiry"));
});

test("v0.7.4 never promotes an audit claim into verifiedFacts", () => {
  const ingest = background.slice(
    background.indexOf("function ingestAuditEvent"),
    background.indexOf("function auditProgressDelta")
  );
  assert.equal(ingest.includes("verifiedFacts"), false);
  assert.match(background, /provenance: "target-session-claim"/);
});

// ---------------------------------------------------------------------------
// The start prompt must explain the ledger
// ---------------------------------------------------------------------------

test("v0.7.4 start prompt explains scripts/eic_app_audit.py as EIC's ledger", () => {
  const prompt = buildAppAuditStartPrompt({ testNeed: "Testa sessionshantering" });
  assert.match(prompt, /scripts\/eic_app_audit\.py/);
  assert.match(prompt, /mekanisk ledger/);
  assert.match(prompt, /inte en del av\s*\n?Chrome-addonen/);
  assert.match(prompt, /EIC_APP_AUDIT_CLI\/1/);
  assert.match(prompt, /schema_version:1/);
  for (const command of APP_AUDIT_LEDGER.commands) {
    assert.ok(prompt.includes(command), `saknar kommandot ${command}`);
  }
});

test("v0.7.4 start prompt forbids simulating ledger output", () => {
  const prompt = buildAppAuditStartPrompt({ testNeed: "x" });
  assert.match(prompt, /Simulera inte dess utdata/);
  assert.match(prompt, /Hitta inte på\s*\n?database- eller owner-receipts/);
  assert.match(prompt, /FÖRE addonens ordinarie/);
  assert.match(prompt, /får inte hävdas i samma tur/);
});

test("v0.7.4 start prompt respects the operator's sink switch and blocks ledgerless mode", () => {
  const locked = buildAppAuditStartPrompt({
    testNeed: "x", allowForgejoFindingSink: false, allowWorkbenchAuditFiles: false
  });
  assert.match(locked, /INGEN Forgejo-skrivning/);
  assert.match(locked, /BLOCKER: APP_AUDIT_LONG kräver SQLite-ledgern/);
});

test("v0.7.4 start prompt refuses an empty test need", () => {
  assert.throws(() => buildAppAuditStartPrompt({ testNeed: "   " }), /Testbehov krävs/);
});

test("v0.7.4 seeds a deterministic start analysis instead of asking Nano to infer one", () => {
  const analysis = buildAppAuditStartAnalysis({ testNeed: "Testa felåterhämtning" });
  assert.match(analysis.taskIntent, /Testa felåterhämtning/);
  assert.ok(analysis.firstWorkUnit.length > 0);
  assert.ok(analysis.constraints.some((item) => item.includes("eic_app_audit.py")));
  assert.ok(analysis.requiredEvidence.some((item) => item.includes("owner_readback_locator")));
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

test("v0.7.4 exposes the mode through a dedicated command and panel surface", () => {
  assert.match(background, /UI_COMMANDS\.START_APP_AUDIT/);
  assert.match(background, /async function startAppAudit\(windowId, message = \{\}\)/);
  assert.match(background, /runMode: RUN_MODES\.APP_AUDIT_LONG/);
  assert.match(background, /initializeRun\(run, \{ audit \}\)/);
  assert.match(sidepanel, /command\("START_MISSION"/);
  assert.match(sidepanel, /MISSION_MODE_IDS\.APP_AUDIT_LONG/);
  assert.match(sidepanel, /function renderAppAudit\(run\)/);
});

test("v0.7.4 only ingests audit events in audit mode", () => {
  assert.match(background, /if \(run\.mode === RUN_MODES\.APP_AUDIT_LONG\) \{/);
});


test("v0.7.4 uses the verified Workbench python3 invocation", () => {
  assert.match(APP_AUDIT_LEDGER.invocation, /^python3 /);
  const prompt = buildAppAuditStartPrompt({ testNeed: "x" });
  assert.match(prompt, /python3 scripts\/eic_app_audit\.py/);
});

test("v0.7.4 rejects missing identities and non-integer step numbers", () => {
  assert.ok(gateFor({ run_id: "" }).errors.includes(APP_AUDIT_GATES.RUN_ID_MISSING));
  assert.ok(gateFor({ turn_id: "" }).errors.includes(APP_AUDIT_GATES.TURN_ID_MISSING));
  assert.ok(gateFor({ step_no: 7.9 }).errors.includes(APP_AUDIT_GATES.STEP_INVALID));
  assert.ok(gateFor({ step_no: "8" }).errors.includes(APP_AUDIT_GATES.STEP_INVALID));
});

test("v0.7.4 requires ledger-compatible fingerprints", () => {
  assert.ok(gateFor({
    finding_id: "F-1", finding_status: "OBSERVED", fingerprint: "abc123"
  }).errors.includes(APP_AUDIT_GATES.FINGERPRINT_INVALID));
});

test("v0.7.4 treats reproduction as evidence, not a ledger status", () => {
  const observedState = {
    ...baseState(),
    findings: {
      "F-1": { findingId: "F-1", status: "REPRODUCTION_REQUIRED", fingerprint: FP_A, firstSeenAtTurn: "turn-0" }
    }
  };
  const valid = gateFor({
    step_no: 8,
    phase: "REPRODUCTION",
    outcome: "ANOMALY",
    finding_id: "F-1",
    finding_status: "REPRODUCTION_REQUIRED",
    fingerprint: FP_A,
    reproduction_recorded: true,
    database_receipt: {
      relative_path: "analysis/eic-app-audit/audit-20260803-001/findings.sqlite3",
      row_type: "step",
      row_id: "STEP-000008"
    }
  }, observedState);
  assert.equal(valid.valid, true, valid.errors.join(", "));
  const invalid = gateFor({
    step_no: 8,
    phase: "REPRODUCTION",
    finding_id: "F-1",
    finding_status: "REPRODUCTION_REQUIRED",
    fingerprint: FP_A,
    reproduction_recorded: true,
    database_receipt: {
      relative_path: "analysis/eic-app-audit/audit-20260803-001/findings.sqlite3",
      row_type: "review",
      row_id: "REV-1"
    }
  }, observedState);
  assert.ok(invalid.errors.includes(APP_AUDIT_GATES.REPRODUCTION_EVIDENCE_INVALID));
  const sameTurnDiscovery = gateFor({
    step_no: 8, phase: "REPRODUCTION", outcome: "ANOMALY",
    finding_id: "F-new", finding_status: "REPRODUCTION_REQUIRED",
    fingerprint: FP_B, reproduction_recorded: true,
    database_receipt: {
      relative_path: "analysis/eic-app-audit/audit-20260803-001/findings.sqlite3",
      row_type: "step", row_id: "STEP-000008"
    }
  });
  assert.ok(sameTurnDiscovery.errors.includes(APP_AUDIT_GATES.REPRODUCTION_EVIDENCE_INVALID));
});

test("v0.7.4 accepts ZIP persistence only with a real bundle SHA-256 claim", () => {
  const state = {
    ...baseState(),
    findings: {
      "F-0003": {
        findingId: "F-0003",
        status: "ACCEPTED_FINDING",
        reproducedAtTurn: "turn-1",
        acceptedAtTurn: "turn-2"
      }
    }
  };
  const missing = gateFor({
    step_no: 10, finding_id: "F-0003", finding_status: "PERSISTED",
    fingerprint: FP_A,
    database_receipt: {
      relative_path: "analysis/eic-app-audit/audit-20260803-001/findings.sqlite3",
      row_type: "sink_receipt", row_id: "SINK-AAAAAAAAAAAAAAAA"
    },
    owner_receipt: {
      sink_type: "ZIP_BUNDLE", target: "bundle.zip", operation: "export",
      result_state: "READBACK_VERIFIED", bundle_sha256: null
    }
  }, state, "turn-3");
  assert.ok(missing.errors.includes(APP_AUDIT_GATES.ZIP_BUNDLE_HASH_MISSING));

  const accepted = gateFor({
    step_no: 10, finding_id: "F-0003", finding_status: "PERSISTED",
    fingerprint: FP_A,
    database_receipt: {
      relative_path: "analysis/eic-app-audit/audit-20260803-001/findings.sqlite3",
      row_type: "sink_receipt", row_id: "SINK-AAAAAAAAAAAAAAAA"
    },
    owner_receipt: {
      sink_type: "ZIP_BUNDLE", target: "bundle.zip", operation: "export",
      result_state: "READBACK_VERIFIED", bundle_sha256: FP_B
    }
  }, state, "turn-3");
  assert.equal(accepted.valid, true, accepted.errors.join(", "));
});

test("v0.7.4 binds database receipts to the exact run path and known row types", () => {
  const wrongPath = gateFor({
    database_receipt: {
      relative_path: "analysis/eic-app-audit/other/findings.sqlite3",
      row_type: "step", row_id: "STEP-000007"
    }
  });
  assert.ok(wrongPath.errors.includes(APP_AUDIT_GATES.DATABASE_PATH_MISMATCH));
  const wrongType = gateFor({
    database_receipt: {
      relative_path: "analysis/eic-app-audit/audit-20260803-001/findings.sqlite3",
      row_type: "run", row_id: "audit-20260803-001"
    }
  });
  assert.ok(wrongType.errors.includes(APP_AUDIT_GATES.DATABASE_ROW_TYPE_INVALID));
});

test("v0.7.4 initializes audit mode before the first prompt is dispatched", () => {
  const start = background.slice(
    background.indexOf("async function startAppAudit"),
    background.indexOf("async function authorizeBoundary")
  );
  assert.match(start, /return enqueue\(\(\) => preparePreparedSessionRunUnlocked/);
  assert.match(start, /runMode: RUN_MODES\.APP_AUDIT_LONG/);
  assert.match(start, /startPromptFactory: \(\{ runId, turnId \}\)/);
  assert.match(start, /auditRunId: runId/);
  assert.match(start, /auditTurnId: turnId/);
  assert.doesNotMatch(start, /const snapshot = await preparePreparedSessionRunUnlocked/);
});

test("v0.7.4 binds the first audit prompt to exact addon run and turn ids", () => {
  const prompt = buildAppAuditStartPrompt({
    testNeed: "x",
    auditRunId: "run-owner-bound",
    auditTurnId: "turn-owner-bound"
  });
  assert.match(prompt, /AUDIT_RUN_ID: run-owner-bound/);
  assert.match(prompt, /INITIAL_TURN_ID: turn-owner-bound/);
  assert.match(prompt, /"run_id": "run-owner-bound"/);
});

test("v0.7.4 locks the Workbench ledger prerequisite in the operator UI", () => {
  const workbenchControl = sidepanelHtml.match(/<input[^>]*id="appAuditAllowWorkbenchFiles"[^>]*>/)?.[0] || "";
  assert.match(workbenchControl, /checked/);
  assert.match(workbenchControl, /disabled/);
  assert.match(sidepanel, /appAuditAllowWorkbenchFiles\.checked = true/);
  const start = background.slice(
    background.indexOf("async function startAppAudit"),
    background.indexOf("async function authorizeBoundary")
  );
  assert.match(start, /APP_AUDIT_LONG kräver Workbench-auditfiler/);
});
