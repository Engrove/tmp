/**
 * APP_AUDIT_LONG — contract surface for the long systematic application audit mode.
 *
 * The addon has ChatGPT host permissions only. It has no channel to the EIC backend, to
 * the Workbench, to `scripts/eic_app_audit.py` or to Forgejo. Every database receipt,
 * owner receipt and readback locator reaching the addon is therefore *text the target
 * session wrote*, and belongs in `targetClaims` — never in `verifiedFacts`.
 *
 * What this module encodes is consequently narrow on purpose: the subset of the audit
 * protocol the addon can check without believing anything the target says about the
 * world. Everything here is either structural (shape, enums, uniqueness) or relational
 * (monotonicity, ordering across turns, state-graph legality). None of it asserts that a
 * row was written, that a test ran, or that Forgejo was updated.
 */

export const APP_AUDIT_EVENT_PROTOCOL = "EIC_APP_AUDIT_EVENT/1";
export const APP_AUDIT_CLI_PROTOCOL = "EIC_APP_AUDIT_CLI/1";
export const APP_AUDIT_DB_SCHEMA = "schema_version:1";
export const APP_AUDIT_REQUEST_PROTOCOL = "EIC_APP_AUDIT_REQUEST/1";
export const APP_AUDIT_DATABASE_ROW_TYPES = Object.freeze([
  "step", "finding", "review", "sink_receipt", "checkpoint"
]);
export const APP_AUDIT_EVENT_MARKER = "EIC_APP_AUDIT_EVENT";

/**
 * The ledger is a Python CLI that lives in the EIC live code surface, not in this addon
 * and not in the model. It is a mechanical ledger, not a second agent: it stores,
 * validates, checkpoints and exports. It never decides that something is a bug.
 */
export const APP_AUDIT_LEDGER = Object.freeze({
  path: "scripts/eic_app_audit.py",
  owner: "EIC session, Workbench command surface",
  protocol: APP_AUDIT_CLI_PROTOCOL,
  commands: Object.freeze([
    "init", "log-step", "log-finding", "review-major",
    "record-sink-receipt", "checkpoint", "status", "resume", "export"
  ]),
  invocation: "python3 scripts/eic_app_audit.py <command> [options]"
});

export const APP_AUDIT_PHASES = Object.freeze([
  "INTAKE", "OWNER_BOOTSTRAP", "WORKBENCH_READY", "DATABASE_READY",
  "TARGET_INVENTORY", "TEST_MODEL", "MICRO_TEST", "OBSERVATION",
  "CLASSIFICATION", "REPRODUCTION", "MAJOR_REVIEW", "PERSISTENCE",
  "CHECKPOINT", "EXPORT", "DONE", "PAUSED", "BLOCKED"
]);

export const APP_AUDIT_OUTCOMES = Object.freeze([
  "PASS", "ANOMALY", "FINDING_CANDIDATE", "INCONCLUSIVE", "BLOCKED", "DONE"
]);

export const APP_AUDIT_FINDING_STATUSES = Object.freeze([
  "OBSERVED", "REPRODUCTION_REQUIRED", "ACCEPTED_FINDING",
  "PERSISTED", "DUPLICATE", "INCONCLUSIVE", "REJECTED"
]);

/**
 * Legal transitions. The central rule the addon can enforce without any backend access:
 * a model proposal may not walk straight from observation to accepted or persisted.
 */
export const APP_AUDIT_STATUS_TRANSITIONS = Object.freeze({
  "": ["OBSERVED", "REPRODUCTION_REQUIRED", "DUPLICATE", "INCONCLUSIVE", "REJECTED"],
  OBSERVED: ["REPRODUCTION_REQUIRED", "DUPLICATE", "INCONCLUSIVE", "REJECTED"],
  REPRODUCTION_REQUIRED: ["ACCEPTED_FINDING", "DUPLICATE", "INCONCLUSIVE", "REJECTED"],
  ACCEPTED_FINDING: ["PERSISTED", "DUPLICATE", "REJECTED"],
  PERSISTED: ["DUPLICATE"],
  DUPLICATE: [],
  INCONCLUSIVE: ["REPRODUCTION_REQUIRED", "REJECTED"],
  REJECTED: []
});

/** Sink states that may accompany a PERSISTED claim. Anything weaker is refused. */
export const APP_AUDIT_READBACK_STATES = Object.freeze(["READBACK_VERIFIED"]);
export const APP_AUDIT_WEAK_SINK_STATES = Object.freeze([
  "REQUEST_SENT", "WRITE_ATTEMPTED", "SUBMITTED", "QUEUED", "PENDING", "UNKNOWN"
]);

/**
 * Gate codes. Each one is decidable from the addon's own durable state plus the parsed
 * event — no gate here requires trusting a claim about the outside world.
 */
export const APP_AUDIT_GATES = Object.freeze({
  EVENT_MISSING: "EVENT_MISSING",
  EVENT_MALFORMED: "EVENT_MALFORMED",
  EVENT_DUPLICATE_MARKER: "EVENT_DUPLICATE_MARKER",
  EVENT_AFTER_TRAILER: "EVENT_AFTER_TRAILER",
  PROTOCOL_MISMATCH: "PROTOCOL_MISMATCH",
  RUN_ID_MISSING: "RUN_ID_MISSING",
  TURN_ID_MISSING: "TURN_ID_MISSING",
  RUN_ID_MISMATCH: "RUN_ID_MISMATCH",
  TURN_ID_MISMATCH: "TURN_ID_MISMATCH",
  STEP_INVALID: "STEP_INVALID",
  STEP_NOT_MONOTONIC: "STEP_NOT_MONOTONIC",
  PHASE_UNKNOWN: "PHASE_UNKNOWN",
  OUTCOME_UNKNOWN: "OUTCOME_UNKNOWN",
  FINDING_STATUS_UNKNOWN: "FINDING_STATUS_UNKNOWN",
  FINDING_FIELDS_INCOMPLETE: "FINDING_FIELDS_INCOMPLETE",
  FINGERPRINT_INVALID: "FINGERPRINT_INVALID",
  FINDING_STATUS_ILLEGAL_TRANSITION: "FINDING_STATUS_ILLEGAL_TRANSITION",
  FINDING_ID_FINGERPRINT_CONFLICT: "FINDING_ID_FINGERPRINT_CONFLICT",
  REPRODUCTION_EVIDENCE_INVALID: "REPRODUCTION_EVIDENCE_INVALID",
  MAJOR_WITHOUT_REVIEW: "MAJOR_WITHOUT_REVIEW",
  PERSISTED_WITHOUT_RECEIPT: "PERSISTED_WITHOUT_RECEIPT",
  RECEIPT_WEAK_STATE: "RECEIPT_WEAK_STATE",
  READBACK_SAME_TURN: "READBACK_SAME_TURN",
  DATABASE_RECEIPT_MISSING: "DATABASE_RECEIPT_MISSING",
  DATABASE_PATH_ESCAPE: "DATABASE_PATH_ESCAPE",
  DATABASE_PATH_MISMATCH: "DATABASE_PATH_MISMATCH",
  DATABASE_ROW_TYPE_INVALID: "DATABASE_ROW_TYPE_INVALID",
  DATABASE_ROW_TYPE_MISMATCH: "DATABASE_ROW_TYPE_MISMATCH",
  ZIP_BUNDLE_HASH_MISSING: "ZIP_BUNDLE_HASH_MISSING",
  SECRET_SHAPED_VALUE: "SECRET_SHAPED_VALUE",
  DONE_WITHOUT_EXPORT_OR_SINK: "DONE_WITHOUT_EXPORT_OR_SINK",
  NEXT_STEP_MISSING: "NEXT_STEP_MISSING"
});

/** Blocking gates stop the audit turn. Advisory gates are recorded and continue. */
export const APP_AUDIT_ADVISORY_GATES = Object.freeze([
  APP_AUDIT_GATES.PHASE_UNKNOWN
]);

export const APP_AUDIT_DEFAULTS = Object.freeze({
  testNeed: "",
  context: "",
  targetReadOnly: true,
  allowWorkbenchAuditFiles: true,
  allowForgejoFindingSink: true
});

/**
 * v0.7.1 classifies destructiveness from effect-describing fields only. An audit turn
 * that reads and writes its own ledger is bounded engineering work, and the ladder's
 * Workbench cap already lands it at 5. The mode declares that ceiling explicitly rather
 * than relying on a regex happening to match, and refuses to be used as a route to the
 * privileged operations D2 exists for.
 */
export const APP_AUDIT_EFFECT_CEILING = Object.freeze({
  level: 5,
  name: "BOUNDED_ENGINEERING_CHANGE",
  forbiddenEffects: Object.freeze([
    "MERGE_BRANCH", "CREATE_RELEASE", "DEPLOY_PRODUCTION",
    "CHANGE_PERMISSION", "AUTH_OWNER_ROUTE", "SCHEMA_MIGRATION",
    "PRODUCTION_DATA_WRITE", "SECRET_ACCESS"
  ])
});

export function isKnownPhase(value) {
  return APP_AUDIT_PHASES.includes(String(value || "").toUpperCase());
}

export function isKnownOutcome(value) {
  return APP_AUDIT_OUTCOMES.includes(String(value || "").toUpperCase());
}

export function isKnownFindingStatus(value) {
  return APP_AUDIT_FINDING_STATUSES.includes(String(value || "").toUpperCase());
}

export function statusTransitionAllowed(fromValue, toValue) {
  const from = String(fromValue || "").toUpperCase();
  const to = String(toValue || "").toUpperCase();
  if (!to) return true;
  if (from === to) return true;
  const allowed = APP_AUDIT_STATUS_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

export function createAuditRunState(runId, { testNeed = "", context = "" } = {}) {
  return {
    schema: "eic.app.audit.state.v1",
    auditRunId: String(runId || ""),
    testNeed: String(testNeed || ""),
    context: String(context || ""),
    phase: "INTAKE",
    lastStepNo: 0,
    stepCount: 0,
    coverageCells: [],
    findings: {},
    sinkReceipts: [],
    gateFailures: [],
    lastEventAt: "",
    lastEventDigest: "",
    exportClaimed: false,
    ledger: { path: APP_AUDIT_LEDGER.path, protocol: APP_AUDIT_CLI_PROTOCOL }
  };
}
