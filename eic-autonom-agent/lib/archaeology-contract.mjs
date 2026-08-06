/**
 * ARCHAEOLOGY_LONG — isolated analysis/reverse-engineering/research contract.
 *
 * The addon owns only structural checks and durable sequencing. Database, repository,
 * Workspace, runtime and artifact facts remain target-session claims until their actual
 * owner routes are read.
 */
export const ARCHAEOLOGY_REQUEST_PROTOCOL = "EIC_ARCHAEOLOGY_REQUEST/1";
export const ARCHAEOLOGY_EVENT_PROTOCOL = "EIC_ARCHAEOLOGY_EVENT/1";
export const ARCHAEOLOGY_EVENT_MARKER = "EIC_ARCHAEOLOGY_EVENT";

export const ARCHAEOLOGY_SCENARIOS = Object.freeze([
  Object.freeze({ id: "GENERAL_RESEARCH", label: "Generell teknisk forskning", focus: "Kartlägg fenomenet med falsifierbara hypoteser och owner-evidens." }),
  Object.freeze({ id: "SOFTWARE_REVERSE_ENGINEERING", label: "Mjukvaru-reverse engineering", focus: "Kartlägg komponenter, kontrollflöden, dataflöden, protokoll och beroenden." }),
  Object.freeze({ id: "DATABASE_REVERSE_ENGINEERING", label: "Databas-reverse engineering", focus: "Kartlägg schema, relationer, constraints, triggers, vyer, statusmaskiner och datagenerationer." }),
  Object.freeze({ id: "ERP_REVERSE_ENGINEERING", label: "ERP reverse engineering", focus: "Kartlägg ERP-domänmodell, dokumentflöden, masterdata, transaktioner, statuslogik och generationsskillnader." }),
  Object.freeze({ id: "PROTOCOL_REVERSE_ENGINEERING", label: "Protokoll-reverse engineering", focus: "Kartlägg meddelanden, tillstånd, framing, ordning, felvägar och kompatibilitet." }),
  Object.freeze({ id: "BEHAVIORAL_FORENSICS", label: "Beteende- och incidentforensik", focus: "Rekonstruera händelseförlopp, invariants, avvikelser och alternativa orsaksförklaringar." })
]);

export const ARCHAEOLOGY_PHASES = Object.freeze([
  "INTAKE", "OWNER_BOOTSTRAP", "WORKSPACE_DISCOVERY", "SOURCE_INVENTORY",
  "BASELINE", "HYPOTHESIS", "EXPERIMENT", "OBSERVATION", "FALSIFICATION",
  "SYNTHESIS", "CHECKPOINT", "EXPORT", "DONE", "USER_PAUSE", "BLOCKED"
]);

export const ARCHAEOLOGY_RESULTS = Object.freeze([
  "OBSERVED", "SUPPORTED", "CONTRADICTED", "REPRODUCED",
  "INCONCLUSIVE", "BLOCKED", "DONE"
]);

export const ARCHAEOLOGY_HYPOTHESIS_STATUSES = Object.freeze([
  "OPEN", "SUPPORTED", "CONTRADICTED", "REPRODUCED", "INCONCLUSIVE", "CLOSED"
]);

export const ARCHAEOLOGY_GATES = Object.freeze({
  EVENT_MISSING: "EVENT_MISSING",
  EVENT_MALFORMED: "EVENT_MALFORMED",
  EVENT_DUPLICATE_MARKER: "EVENT_DUPLICATE_MARKER",
  EVENT_AFTER_TRAILER: "EVENT_AFTER_TRAILER",
  PROTOCOL_MISMATCH: "PROTOCOL_MISMATCH",
  RUN_ID_MISMATCH: "RUN_ID_MISMATCH",
  TURN_ID_MISMATCH: "TURN_ID_MISMATCH",
  SCENARIO_MISMATCH: "SCENARIO_MISMATCH",
  STEP_INVALID: "STEP_INVALID",
  STEP_NOT_MONOTONIC: "STEP_NOT_MONOTONIC",
  PHASE_UNKNOWN: "PHASE_UNKNOWN",
  RESULT_UNKNOWN: "RESULT_UNKNOWN",
  HYPOTHESIS_INCOMPLETE: "HYPOTHESIS_INCOMPLETE",
  HYPOTHESIS_STATUS_UNKNOWN: "HYPOTHESIS_STATUS_UNKNOWN",
  EVIDENCE_REQUIRED: "EVIDENCE_REQUIRED",
  NEXT_STEP_MISSING: "NEXT_STEP_MISSING",
  FORBIDDEN_EFFECT: "FORBIDDEN_EFFECT",
  EFFECT_UNKNOWN: "EFFECT_UNKNOWN",
  WORKSPACE_PROBE_INVALID: "WORKSPACE_PROBE_INVALID",
  SECRET_SHAPED_VALUE: "SECRET_SHAPED_VALUE"
});

export const ARCHAEOLOGY_EFFECT_CEILING = Object.freeze({
  level: 4,
  maxLevel: 4,
  name: "ANALYSIS_ONLY_WITH_EPHEMERAL_WORKSPACE",
  allowedEffects: Object.freeze([
    "OWNER_READ", "READ_ONLY_QUERY", "SOURCE_INSPECTION", "SOURCE_COMPARE",
    "CODE_GRAPH", "READ_ONLY_COMMAND", "EPHEMERAL_WORKSPACE_EVIDENCE",
    "HASH", "CHECKPOINT", "REPORT_EXPORT"
  ]),
  forbiddenEffects: Object.freeze([
    "SOURCE_MUTATION", "PATCH_APPLY", "COMMIT", "MERGE_BRANCH", "CREATE_RELEASE",
    "DEPLOY_PRODUCTION", "CHANGE_PERMISSION", "AUTH_OWNER_ROUTE", "SCHEMA_MIGRATION",
    "PRODUCTION_DATA_WRITE", "TARGET_MUTATION", "SECRET_ACCESS"
  ])
});

export function scenarioById(value) {
  const id = String(value || "").toUpperCase();
  return ARCHAEOLOGY_SCENARIOS.find((item) => item.id === id) || ARCHAEOLOGY_SCENARIOS[0];
}

export function createArchaeologyRunState(runId, {
  scenario = "GENERAL_RESEARCH",
  question = "",
  context = ""
} = {}) {
  return {
    protocol: ARCHAEOLOGY_EVENT_PROTOCOL,
    archaeologyRunId: String(runId || ""),
    scenario: scenarioById(scenario).id,
    question: String(question || ""),
    context: String(context || ""),
    phase: "INTAKE",
    lastStepNo: 0,
    stepCount: 0,
    coverageUnits: [],
    hypotheses: {},
    evidenceLocators: [],
    workspaceRecommendations: [],
    gateFailures: [],
    updatedAt: null
  };
}
