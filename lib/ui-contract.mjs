import { nullableInteger } from "./common.mjs";
import {
  BASELINE_ANALYSIS_SCHEMA_ID
} from "./nano-baseline-analysis.mjs";
import {
  NANO_FORENSIC_MAX_SEGMENTS
} from "./nano-forensics.mjs";

const COMMAND_TYPE = "EIC_UI_COMMAND";

export const UI_COMMAND_SCHEMA = "eic.autonom.ui-command.v2";
export const UI_COMMAND_RESULT_SCHEMA = "eic.autonom.ui-command-result.v2";
export const UI_SNAPSHOT_SCHEMA = "eic.autonom.ui-snapshot.v3";

export const UI_RESPONSE_KINDS = Object.freeze({
  SNAPSHOT: "SNAPSHOT",
  ACK: "ACK"
});

export const UI_COMMANDS = Object.freeze({
  ADD_AUDIT: "ADD_AUDIT",
  APPROVE_BROWSER_ACTION: "APPROVE_BROWSER_ACTION",
  AUTHORIZE_BOUNDARY: "AUTHORIZE_BOUNDARY",
  SUBMIT_OPERATOR_ACTION_RECEIPT: "SUBMIT_OPERATOR_ACTION_RECEIPT",
  CAPTURE_SESSION: "CAPTURE_SESSION",
  REQUEST_CORE_SURFACE_REVIEW: "REQUEST_CORE_SURFACE_REVIEW",
  MARK_CORE_SURFACE_REVIEW_ANALYZING: "MARK_CORE_SURFACE_REVIEW_ANALYZING",
  STORE_CORE_SURFACE_REVIEW_PROPOSAL: "STORE_CORE_SURFACE_REVIEW_PROPOSAL",
  FAIL_CORE_SURFACE_REVIEW: "FAIL_CORE_SURFACE_REVIEW",
  APPLY_CORE_SURFACE_REVIEW: "APPLY_CORE_SURFACE_REVIEW",
  DECLINE_CORE_SURFACE_REVIEW: "DECLINE_CORE_SURFACE_REVIEW",
  PURGE_SESSION_CONTEXT: "PURGE_SESSION_CONTEXT",
  RETRY_SESSION_CONTEXT_INIT: "RETRY_SESSION_CONTEXT_INIT",
  ATTACH_WEB_TARGET_DEBUGGER: "ATTACH_WEB_TARGET_DEBUGGER",
  CAPTURE_EVIDENCE_SNAPSHOT: "CAPTURE_EVIDENCE_SNAPSHOT",
  BIND_ACTIVE_WEB_TARGET: "BIND_ACTIVE_WEB_TARGET",
  CLEAR_AUDIT: "CLEAR_AUDIT",
  CLEAR_BROWSER_EVIDENCE: "CLEAR_BROWSER_EVIDENCE",
  DENY_BROWSER_ACTION: "DENY_BROWSER_ACTION",
  DETACH_SELECTED_TAB: "DETACH_SELECTED_TAB",
  DETACH_WEB_TARGET: "DETACH_WEB_TARGET",
  DETACH_WEB_TARGET_DEBUGGER: "DETACH_WEB_TARGET_DEBUGGER",
  EXECUTE_BROWSER_RESPONSE_ACTION: "EXECUTE_BROWSER_RESPONSE_ACTION",
  GET_SNAPSHOT: "GET_SNAPSHOT",
  GET_APPLICATION_LOG: "GET_APPLICATION_LOG",
  GET_FULL_AUDIT_BATCH: "GET_FULL_AUDIT_BATCH",
  ACK_FULL_AUDIT_BATCH: "ACK_FULL_AUDIT_BATCH",
  IMPORT: "IMPORT",
  LINK_ACTIVE_TAB: "LINK_ACTIVE_TAB",
  NANO_CLAIM: "NANO_CLAIM",
  NANO_DECISION: "NANO_DECISION",
  NANO_FAILURE: "NANO_FAILURE",
  NANO_HEARTBEAT: "NANO_HEARTBEAT",
  NANO_HOST_STATE: "NANO_HOST_STATE",
  NANO_TASK_CLAIM: "NANO_TASK_CLAIM",
  NANO_TASK_COMPLETE: "NANO_TASK_COMPLETE",
  NANO_TASK_FAILURE: "NANO_TASK_FAILURE",
  PAUSE: "PAUSE",
  PROCESS_BROWSER_CONTROLLER_STEP: "PROCESS_BROWSER_CONTROLLER_STEP",
  REFRESH: "REFRESH",
  REQUEST_WEB_TARGET_PERMISSION: "REQUEST_WEB_TARGET_PERMISSION",
  RESET_WINDOW: "RESET_WINDOW",
  RESUME_BROWSER_RECOVERY: "RESUME_BROWSER_RECOVERY",
  ROLLBACK_IMPORTED_STATE: "ROLLBACK_IMPORTED_STATE",
  REVOKE_WEB_TARGET_PERMISSION: "REVOKE_WEB_TARGET_PERMISSION",
  RESUME: "RESUME",
  SAVE_CONFIG: "SAVE_CONFIG",
  SELECT_TAB: "SELECT_TAB",
  SET_TARGET_MODE: "SET_TARGET_MODE",
  START_APP_AUDIT: "START_APP_AUDIT",
  START_EVIDENCE_OBSERVATION: "START_EVIDENCE_OBSERVATION",
  START_MISSION: "START_MISSION",
  START_ARCHAEOLOGY: "START_ARCHAEOLOGY",
  START_NEW_SESSION: "START_NEW_SESSION",
  START_WAITING: "START_WAITING",
  STOP: "STOP",
  STOP_EVIDENCE_OBSERVATION: "STOP_EVIDENCE_OBSERVATION"
});

function spec(responseKind, allowedPayloadKeys = [], requiredPayloadKeys = []) {
  return Object.freeze({
    responseKind,
    allowedPayloadKeys: Object.freeze([...allowedPayloadKeys]),
    requiredPayloadKeys: Object.freeze([...requiredPayloadKeys])
  });
}

export const UI_COMMAND_SPECS = Object.freeze({
  [UI_COMMANDS.ADD_AUDIT]: spec(UI_RESPONSE_KINDS.SNAPSHOT, ["auditEntry"], ["auditEntry"]),
  [UI_COMMANDS.APPROVE_BROWSER_ACTION]: spec(
    UI_RESPONSE_KINDS.SNAPSHOT,
    ["actionId", "justification"],
    ["actionId", "justification"]
  ),
  [UI_COMMANDS.AUTHORIZE_BOUNDARY]: spec(
    UI_RESPONSE_KINDS.SNAPSHOT,
    ["boundaryKey", "decisionId", "missionId", "runId", "acknowledgement"],
    ["boundaryKey", "decisionId", "missionId", "runId", "acknowledgement"]
  ),
  [UI_COMMANDS.SUBMIT_OPERATOR_ACTION_RECEIPT]: spec(
    UI_RESPONSE_KINDS.SNAPSHOT,
    ["actionId", "missionId", "runId", "evidence"],
    ["actionId", "missionId", "runId", "evidence"]
  ),
  [UI_COMMANDS.CAPTURE_SESSION]: spec(
    UI_RESPONSE_KINDS.SNAPSHOT,
    ["forceFull"],
    []
  ),
  [UI_COMMANDS.REQUEST_CORE_SURFACE_REVIEW]: spec(
    UI_RESPONSE_KINDS.SNAPSHOT,
    ["trigger"],
    []
  ),
  [UI_COMMANDS.MARK_CORE_SURFACE_REVIEW_ANALYZING]: spec(
    UI_RESPONSE_KINDS.SNAPSHOT,
    ["captureId", "memoryId"],
    []
  ),
  [UI_COMMANDS.STORE_CORE_SURFACE_REVIEW_PROPOSAL]: spec(
    UI_RESPONSE_KINDS.SNAPSHOT,
    ["proposal"],
    ["proposal"]
  ),
  [UI_COMMANDS.FAIL_CORE_SURFACE_REVIEW]: spec(
    UI_RESPONSE_KINDS.SNAPSHOT,
    ["error"],
    ["error"]
  ),
  [UI_COMMANDS.APPLY_CORE_SURFACE_REVIEW]: spec(
    UI_RESPONSE_KINDS.SNAPSHOT,
    ["reviewId"],
    ["reviewId"]
  ),
  [UI_COMMANDS.DECLINE_CORE_SURFACE_REVIEW]: spec(
    UI_RESPONSE_KINDS.SNAPSHOT,
    ["reviewId"],
    ["reviewId"]
  ),
  [UI_COMMANDS.PURGE_SESSION_CONTEXT]: spec(
    UI_RESPONSE_KINDS.SNAPSHOT,
    ["conversationKey"],
    []
  ),
  [UI_COMMANDS.RETRY_SESSION_CONTEXT_INIT]: spec(UI_RESPONSE_KINDS.SNAPSHOT),
  [UI_COMMANDS.ATTACH_WEB_TARGET_DEBUGGER]: spec(UI_RESPONSE_KINDS.SNAPSHOT),
  [UI_COMMANDS.CAPTURE_EVIDENCE_SNAPSHOT]: spec(UI_RESPONSE_KINDS.SNAPSHOT),
  [UI_COMMANDS.BIND_ACTIVE_WEB_TARGET]: spec(UI_RESPONSE_KINDS.SNAPSHOT),
  [UI_COMMANDS.CLEAR_AUDIT]: spec(UI_RESPONSE_KINDS.SNAPSHOT),
  [UI_COMMANDS.CLEAR_BROWSER_EVIDENCE]: spec(UI_RESPONSE_KINDS.SNAPSHOT),
  [UI_COMMANDS.DENY_BROWSER_ACTION]: spec(
    UI_RESPONSE_KINDS.SNAPSHOT,
    ["actionId", "justification"],
    ["actionId"]
  ),
  [UI_COMMANDS.DETACH_SELECTED_TAB]: spec(UI_RESPONSE_KINDS.SNAPSHOT),
  [UI_COMMANDS.DETACH_WEB_TARGET]: spec(UI_RESPONSE_KINDS.SNAPSHOT),
  [UI_COMMANDS.DETACH_WEB_TARGET_DEBUGGER]: spec(UI_RESPONSE_KINDS.SNAPSHOT),
  [UI_COMMANDS.EXECUTE_BROWSER_RESPONSE_ACTION]: spec(
    UI_RESPONSE_KINDS.SNAPSHOT,
    ["responseText"],
    ["responseText"]
  ),
  [UI_COMMANDS.GET_SNAPSHOT]: spec(UI_RESPONSE_KINDS.SNAPSHOT),
  [UI_COMMANDS.GET_APPLICATION_LOG]: spec(UI_RESPONSE_KINDS.ACK),
  [UI_COMMANDS.GET_FULL_AUDIT_BATCH]: spec(UI_RESPONSE_KINDS.ACK, ["limit"]),
  [UI_COMMANDS.ACK_FULL_AUDIT_BATCH]: spec(
    UI_RESPONSE_KINDS.ACK,
    ["lastSequence"],
    ["lastSequence"]
  ),
  [UI_COMMANDS.IMPORT]: spec(UI_RESPONSE_KINDS.SNAPSHOT, ["payload"], ["payload"]),
  [UI_COMMANDS.LINK_ACTIVE_TAB]: spec(UI_RESPONSE_KINDS.SNAPSHOT),
  [UI_COMMANDS.NANO_CLAIM]: spec(
    UI_RESPONSE_KINDS.SNAPSHOT,
    [
      "requestId", "analysisMode", "modelKind", "inputDigest", "inputChars",
      "inputBudget", "hostState"
    ],
    ["requestId", "analysisMode", "inputDigest"]
  ),
  [UI_COMMANDS.NANO_DECISION]: spec(
    UI_RESPONSE_KINDS.SNAPSHOT,
    [
      "requestId", "claimId", "analysisMode", "source", "inputDigest", "inputChars", "durationMs",
      "outputChars", "chunkCount", "firstTokenAt", "transport",
      "contextUsage", "contextWindow", "cloneUsed", "staleReason",
      "repairUsed", "baselineAnalysis", "forensics", "decision"
    ],
    ["requestId", "analysisMode", "source", "inputDigest", "decision"]
  ),
  [UI_COMMANDS.NANO_FAILURE]: spec(
    UI_RESPONSE_KINDS.SNAPSHOT,
    [
      "requestId", "claimId", "inputDigest", "inputChars", "durationMs", "errorCode", "errorDetail",
      "repairUsed", "forensics"
    ],
    ["requestId", "claimId", "inputDigest", "errorCode"]
  ),
  [UI_COMMANDS.NANO_HEARTBEAT]: spec(
    UI_RESPONSE_KINDS.ACK,
    ["requestId", "claimId", "outputChars", "chunkCount", "inputDigest", "inputChars", "inputBudget"],
    ["requestId", "claimId", "inputDigest"]
  ),
  [UI_COMMANDS.NANO_HOST_STATE]: spec(UI_RESPONSE_KINDS.SNAPSHOT, ["hostState"], ["hostState"]),
  [UI_COMMANDS.NANO_TASK_CLAIM]: spec(
    UI_RESPONSE_KINDS.SNAPSHOT,
    ["requestId", "modelKind"],
    ["requestId"]
  ),
  [UI_COMMANDS.NANO_TASK_COMPLETE]: spec(
    UI_RESPONSE_KINDS.SNAPSHOT,
    ["requestId", "claimId", "result", "isolation", "promptCalls", "durationMs"],
    ["requestId", "claimId", "result", "isolation", "promptCalls"]
  ),
  [UI_COMMANDS.NANO_TASK_FAILURE]: spec(
    UI_RESPONSE_KINDS.SNAPSHOT,
    ["requestId", "claimId", "error"],
    ["requestId", "error"]
  ),
  [UI_COMMANDS.PAUSE]: spec(UI_RESPONSE_KINDS.SNAPSHOT),
  [UI_COMMANDS.PROCESS_BROWSER_CONTROLLER_STEP]: spec(UI_RESPONSE_KINDS.SNAPSHOT),
  [UI_COMMANDS.REFRESH]: spec(UI_RESPONSE_KINDS.SNAPSHOT),
  [UI_COMMANDS.REQUEST_WEB_TARGET_PERMISSION]: spec(UI_RESPONSE_KINDS.SNAPSHOT),
  [UI_COMMANDS.RESET_WINDOW]: spec(UI_RESPONSE_KINDS.SNAPSHOT),
  [UI_COMMANDS.RESUME_BROWSER_RECOVERY]: spec(UI_RESPONSE_KINDS.SNAPSHOT),
  [UI_COMMANDS.ROLLBACK_IMPORTED_STATE]: spec(UI_RESPONSE_KINDS.SNAPSHOT),
  [UI_COMMANDS.REVOKE_WEB_TARGET_PERMISSION]: spec(UI_RESPONSE_KINDS.SNAPSHOT),
  [UI_COMMANDS.RESUME]: spec(UI_RESPONSE_KINDS.SNAPSHOT),
  [UI_COMMANDS.SAVE_CONFIG]: spec(UI_RESPONSE_KINDS.SNAPSHOT, ["config"], ["config"]),
  [UI_COMMANDS.SELECT_TAB]: spec(UI_RESPONSE_KINDS.SNAPSHOT, ["tabId"], ["tabId"]),
  [UI_COMMANDS.SET_TARGET_MODE]: spec(UI_RESPONSE_KINDS.SNAPSHOT, ["mode"], ["mode"]),
  [UI_COMMANDS.START_MISSION]: spec(
    UI_RESPONSE_KINDS.SNAPSHOT,
    ["modeId", "input"],
    ["modeId", "input"]
  ),
  [UI_COMMANDS.START_EVIDENCE_OBSERVATION]: spec(UI_RESPONSE_KINDS.SNAPSHOT),
  [UI_COMMANDS.START_APP_AUDIT]: spec(
    UI_RESPONSE_KINDS.SNAPSHOT,
    [
      "testNeed", "context", "targetReadOnly",
      "allowWorkbenchAuditFiles", "allowForgejoFindingSink"
    ],
    ["testNeed"]
  ),
  [UI_COMMANDS.START_ARCHAEOLOGY]: spec(
    UI_RESPONSE_KINDS.SNAPSHOT,
    ["scenario", "question", "context", "allowWorkspaceEvidence", "allowExport"],
    ["question"]
  ),
  [UI_COMMANDS.START_NEW_SESSION]: spec(
    UI_RESPONSE_KINDS.SNAPSHOT,
    ["startPrompt", "analysis"],
    ["startPrompt", "analysis"]
  ),
  [UI_COMMANDS.START_WAITING]: spec(UI_RESPONSE_KINDS.SNAPSHOT),
  [UI_COMMANDS.STOP]: spec(UI_RESPONSE_KINDS.SNAPSHOT),
  [UI_COMMANDS.STOP_EVIDENCE_OBSERVATION]: spec(UI_RESPONSE_KINDS.SNAPSHOT)
});

const RESERVED_MESSAGE_KEYS = new Set([
  "type", "schema", "requestId", "command", "windowId", "payload"
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function newRequestId() {
  if (globalThis.crypto?.randomUUID) return `ui-command-${globalThis.crypto.randomUUID()}`;
  return `ui-command-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}


const BASELINE_ANALYSIS_ALLOWED_KEYS = Object.freeze([
  "schema", "verdict", "reason", "violations",
  "correctionPrompt", "normalizedBaselineAccepted", "normalizedBaseline",
  // Transitional receive-only tolerance for v0.10.16 Nano output. v0.10.17 never requests these fields.
  "eightyTwentyVerdict", "skillGroundingVerdict", "detourVerdict"
]);

const NANO_FORENSICS_ALLOWED_KEYS = Object.freeze([
  "schema", "requestId", "claimId", "analysisMode", "responseSchemaId",
  "inputDigest", "outputSha256", "outputChars", "chunkCount", "durationMs",
  "taskAttempt", "transport", "firstTokenAt", "overrunRecovered",
  "earlyJsonCompleted", "parseStage", "parseError", "validationErrors",
  "baselineCandidatePresent", "baselineResponseIdentity",
  "sessionContextInitState", "errorCode", "errorDetail",
  "nanoOutputSegments", "nanoOutputCapturedChars", "nanoOutputOmittedChars",
  "nanoOutputTruncated"
]);

function assertOnlyKeys(value, allowedKeys, code) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${code}:KEY_NOT_ALLOWED:${key}`);
  }
}

function validateBoundedString(value, maxLength, code, { optional = false } = {}) {
  if (value === undefined && optional) return;
  if (value !== null && typeof value !== "string") throw new Error(`${code}:TYPE`);
  if (typeof value === "string" && value.length > maxLength) throw new Error(`${code}:TOO_LONG`);
}

function validateNonNegativeNumber(value, code, { optional = false } = {}) {
  if (value === undefined && optional) return;
  if (!Number.isFinite(Number(value)) || Number(value) < 0) throw new Error(`${code}:NUMBER`);
}

function validateBaselineAnalysisTransport(value) {
  if (!isRecord(value)) throw new Error("UI_COMMAND_BASELINE_ANALYSIS_INVALID");
  assertOnlyKeys(value, BASELINE_ANALYSIS_ALLOWED_KEYS, "UI_COMMAND_BASELINE_ANALYSIS_INVALID");
  if (value.schema !== BASELINE_ANALYSIS_SCHEMA_ID) throw new Error("UI_COMMAND_BASELINE_ANALYSIS_SCHEMA_INVALID");
  if (!["ACCEPT", "DRIFT", "INSUFFICIENT_CONTEXT"].includes(value.verdict)) {
    throw new Error("UI_COMMAND_BASELINE_ANALYSIS_VERDICT_INVALID");
  }
  validateBoundedString(value.reason, 900, "UI_COMMAND_BASELINE_ANALYSIS_REASON");
  if (!Array.isArray(value.violations) || value.violations.length > 8 ||
      value.violations.some((item) => typeof item !== "string" || item.length > 260)) {
    throw new Error("UI_COMMAND_BASELINE_ANALYSIS_VIOLATIONS_INVALID");
  }
  validateBoundedString(value.correctionPrompt, 2400, "UI_COMMAND_BASELINE_ANALYSIS_CORRECTION");
  if (typeof value.normalizedBaselineAccepted !== "boolean") {
    throw new Error("UI_COMMAND_BASELINE_ANALYSIS_ACCEPT_FLAG_INVALID");
  }
  if (value.normalizedBaseline !== undefined && value.normalizedBaseline !== null) {
    if (!isRecord(value.normalizedBaseline)) {
      throw new Error("UI_COMMAND_BASELINE_ANALYSIS_NORMALIZED_BASELINE_INVALID");
    }
    const serialized = JSON.stringify(value.normalizedBaseline);
    if (serialized.length > 16_000) {
      throw new Error("UI_COMMAND_BASELINE_ANALYSIS_NORMALIZED_BASELINE_TOO_LONG");
    }
  }
  return value;
}

function validateNanoForensicsTransport(value) {
  if (!isRecord(value)) throw new Error("UI_COMMAND_NANO_FORENSICS_INVALID");
  assertOnlyKeys(value, NANO_FORENSICS_ALLOWED_KEYS, "UI_COMMAND_NANO_FORENSICS_INVALID");
  if (value.schema !== "eic.autonom.nano-forensics.v1") {
    throw new Error("UI_COMMAND_NANO_FORENSICS_SCHEMA_INVALID");
  }
  validateBoundedString(value.requestId, 160, "UI_COMMAND_NANO_FORENSICS_REQUEST");
  validateBoundedString(value.claimId, 160, "UI_COMMAND_NANO_FORENSICS_CLAIM");
  validateBoundedString(value.analysisMode, 80, "UI_COMMAND_NANO_FORENSICS_MODE");
  validateBoundedString(value.responseSchemaId, 120, "UI_COMMAND_NANO_FORENSICS_SCHEMA_ID");
  validateBoundedString(value.inputDigest, 128, "UI_COMMAND_NANO_FORENSICS_INPUT_DIGEST");
  validateBoundedString(value.outputSha256, 128, "UI_COMMAND_NANO_FORENSICS_OUTPUT_DIGEST");
  validateBoundedString(value.transport, 120, "UI_COMMAND_NANO_FORENSICS_TRANSPORT");
  validateBoundedString(value.overrunRecovered, 800, "UI_COMMAND_NANO_FORENSICS_OVERRUN");
  validateBoundedString(value.parseStage, 80, "UI_COMMAND_NANO_FORENSICS_PARSE_STAGE");
  validateBoundedString(value.parseError, 800, "UI_COMMAND_NANO_FORENSICS_PARSE_ERROR");
  validateBoundedString(value.baselineResponseIdentity, 180, "UI_COMMAND_NANO_FORENSICS_BASELINE_ID");
  validateBoundedString(value.sessionContextInitState, 80, "UI_COMMAND_NANO_FORENSICS_INIT_STATE");
  validateBoundedString(value.errorCode, 120, "UI_COMMAND_NANO_FORENSICS_ERROR_CODE");
  validateBoundedString(value.errorDetail, 800, "UI_COMMAND_NANO_FORENSICS_ERROR_DETAIL");
  validateNonNegativeNumber(value.outputChars, "UI_COMMAND_NANO_FORENSICS_OUTPUT_CHARS");
  validateNonNegativeNumber(value.chunkCount, "UI_COMMAND_NANO_FORENSICS_CHUNK_COUNT");
  validateNonNegativeNumber(value.durationMs, "UI_COMMAND_NANO_FORENSICS_DURATION");
  validateNonNegativeNumber(value.taskAttempt, "UI_COMMAND_NANO_FORENSICS_ATTEMPT");
  validateNonNegativeNumber(value.nanoOutputCapturedChars, "UI_COMMAND_NANO_FORENSICS_CAPTURED");
  validateNonNegativeNumber(value.nanoOutputOmittedChars, "UI_COMMAND_NANO_FORENSICS_OMITTED");
  if (value.firstTokenAt !== null && value.firstTokenAt !== undefined &&
      typeof value.firstTokenAt !== "string" && !Number.isFinite(Number(value.firstTokenAt))) {
    throw new Error("UI_COMMAND_NANO_FORENSICS_FIRST_TOKEN_INVALID");
  }
  if (typeof value.earlyJsonCompleted !== "boolean" ||
      typeof value.baselineCandidatePresent !== "boolean" ||
      typeof value.nanoOutputTruncated !== "boolean") {
    throw new Error("UI_COMMAND_NANO_FORENSICS_FLAGS_INVALID");
  }
  if (!Array.isArray(value.validationErrors) || value.validationErrors.length > 12 ||
      value.validationErrors.some((item) => typeof item !== "string" || item.length > 300)) {
    throw new Error("UI_COMMAND_NANO_FORENSICS_VALIDATION_ERRORS_INVALID");
  }
  if (!Array.isArray(value.nanoOutputSegments) ||
      value.nanoOutputSegments.length > NANO_FORENSIC_MAX_SEGMENTS ||
      value.nanoOutputSegments.some((item) => typeof item !== "string" || item.length > 760)) {
    throw new Error("UI_COMMAND_NANO_FORENSICS_SEGMENTS_INVALID");
  }
  if (JSON.stringify(value).length > 24_000) {
    throw new Error("UI_COMMAND_NANO_FORENSICS_ENVELOPE_TOO_LARGE");
  }
  return value;
}

function validatePayload(command, payload) {
  const specValue = UI_COMMAND_SPECS[command];
  if (!specValue) throw new Error(`UNKNOWN_UI_COMMAND:${command}`);
  if (!isRecord(payload)) throw new Error(`UI_COMMAND_PAYLOAD_NOT_OBJECT:${command}`);

  const allowed = new Set(specValue.allowedPayloadKeys);
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) throw new Error(`UI_COMMAND_PAYLOAD_KEY_NOT_ALLOWED:${command}:${key}`);
  }
  for (const key of specValue.requiredPayloadKeys) {
    if (!(key in payload)) throw new Error(`UI_COMMAND_PAYLOAD_KEY_REQUIRED:${command}:${key}`);
  }

  if (command === UI_COMMANDS.SELECT_TAB && nullableInteger(payload.tabId) === null) {
    throw new Error("UI_COMMAND_TAB_ID_INVALID");
  }
  if (command === UI_COMMANDS.SET_TARGET_MODE && typeof payload.mode !== "string") {
    throw new Error("UI_COMMAND_TARGET_MODE_INVALID");
  }
  if (command === UI_COMMANDS.SAVE_CONFIG && !isRecord(payload.config)) {
    throw new Error("UI_COMMAND_CONFIG_INVALID");
  }
  if (command === UI_COMMANDS.IMPORT && !isRecord(payload.payload)) {
    throw new Error("UI_COMMAND_IMPORT_INVALID");
  }
  if ([
    UI_COMMANDS.NANO_CLAIM,
    UI_COMMANDS.NANO_HEARTBEAT,
    UI_COMMANDS.NANO_DECISION,
    UI_COMMANDS.NANO_FAILURE
  ].includes(command)) {
    const inputDigest = String(payload.inputDigest || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/u.test(inputDigest)) {
      throw new Error(`UI_COMMAND_${command}_INPUT_DIGEST_INVALID`);
    }
    payload.inputDigest = inputDigest;
    if (payload.inputChars !== undefined &&
        (!Number.isFinite(Number(payload.inputChars)) || Number(payload.inputChars) < 0)) {
      throw new Error(`UI_COMMAND_${command}_INPUT_CHARS_INVALID`);
    }
  }
  if (command === UI_COMMANDS.NANO_DECISION) {
    if (payload.baselineAnalysis !== undefined && payload.baselineAnalysis !== null) {
      validateBaselineAnalysisTransport(payload.baselineAnalysis);
    }
    if (payload.forensics !== undefined && payload.forensics !== null) {
      validateNanoForensicsTransport(payload.forensics);
    }
  }
  if (command === UI_COMMANDS.NANO_FAILURE &&
      payload.forensics !== undefined && payload.forensics !== null) {
    validateNanoForensicsTransport(payload.forensics);
  }
  if (command === UI_COMMANDS.EXECUTE_BROWSER_RESPONSE_ACTION &&
      (typeof payload.responseText !== "string" || payload.responseText.length > 80_000)) {
    throw new Error("UI_COMMAND_BROWSER_RESPONSE_INVALID");
  }
  if (command === UI_COMMANDS.START_MISSION) {
    if (typeof payload.modeId !== "string" || !payload.modeId || !isRecord(payload.input)) {
      throw new Error("UI_COMMAND_START_MISSION_INVALID");
    }
  }
  if (command === UI_COMMANDS.START_NEW_SESSION) {
    if (typeof payload.startPrompt !== "string" || !isRecord(payload.analysis)) {
      throw new Error("UI_COMMAND_START_SESSION_INVALID");
    }
  }
  if ([UI_COMMANDS.APPROVE_BROWSER_ACTION, UI_COMMANDS.DENY_BROWSER_ACTION].includes(command)) {
    if (typeof payload.actionId !== "string" || !payload.actionId ||
        (payload.justification !== undefined && typeof payload.justification !== "string")) {
      throw new Error("UI_COMMAND_BROWSER_APPROVAL_INVALID");
    }
  }
  return payload;
}


export function createUiCommand({
  command,
  windowId,
  payload = {},
  requestId = newRequestId()
} = {}) {
  if (!UI_COMMAND_SPECS[command]) throw new Error(`UNKNOWN_UI_COMMAND:${command}`);
  if (nullableInteger(windowId) === null) throw new Error("UI_COMMAND_WINDOW_ID_INVALID");
  const normalizedPayload = validatePayload(command, cloneValue(payload));
  return {
    type: COMMAND_TYPE,
    schema: UI_COMMAND_SCHEMA,
    requestId: String(requestId || newRequestId()),
    command,
    windowId: Number(windowId),
    payload: normalizedPayload
  };
}

export function parseUiCommand(message) {
  if (!isRecord(message) || message.type !== COMMAND_TYPE) {
    throw new Error("UI_COMMAND_TYPE_INVALID");
  }
  if (message.schema !== UI_COMMAND_SCHEMA) {
    throw new Error(`UI_COMMAND_SCHEMA_UNSUPPORTED:${message.schema || "MISSING"}`);
  }
  const command = String(message.command || "");
  if (!UI_COMMAND_SPECS[command]) throw new Error(`UNKNOWN_UI_COMMAND:${command}`);
  const windowId = nullableInteger(message.windowId);
  if (windowId === null) throw new Error("UI_COMMAND_WINDOW_ID_INVALID");
  const payload = validatePayload(
    command,
    cloneValue(message.payload || {})
  );
  return {
    requestId: String(message.requestId || ""),
    command,
    windowId,
    payload,
    responseKind: UI_COMMAND_SPECS[command].responseKind
  };
}

export function createUiSnapshot({
  appVersion,
  windowId,
  snapshotId,
  capturedAt,
  config,
  continuity,
  window,
  missions,
  buildProfile,
  evidence,
  applicationLogSummary,
  audit
} = {}) {
  if (nullableInteger(windowId) === null) throw new Error("UI_SNAPSHOT_WINDOW_ID_INVALID");
  const model = cloneValue({
    config: config || {},
    continuity: continuity || {},
    window: window || {},
    buildProfile: buildProfile || {
      schema: "eic.autonom.build-profile.v1",
      version: 1,
      profile: "STANDARD",
      debuggerAvailable: false,
      optionalWebOrigins: []
    },
    evidence: evidence || {
      schema: "eic.autonom.evidence-store.v1",
      version: 1,
      observation: { state: "INACTIVE" },
      count: 0,
      counts: {},
      durableBytes: 0,
      latest: []
    },
    missions: missions || {
      schema: "eic.autonom.mission-view.v1",
      version: 1,
      activeMissionId: null,
      missionIds: [],
      missions: {}
    },
    applicationLogSummary: applicationLogSummary || null,
    audit: Array.isArray(audit) ? audit : []
  });
  return {
    ok: true,
    schema: UI_SNAPSHOT_SCHEMA,
    snapshotVersion: 3,
    snapshotId: String(snapshotId || ""),
    capturedAt: String(capturedAt || ""),
    appVersion: String(appVersion || ""),
    windowId: Number(windowId),
    forwardOnly: true,
    model
  };
}

export function readUiSnapshotModel(snapshot) {
  if (!isRecord(snapshot) || snapshot.ok !== true) throw new Error("UI_SNAPSHOT_INVALID");
  if (snapshot.schema !== UI_SNAPSHOT_SCHEMA || Number(snapshot.snapshotVersion) !== 3) {
    throw new Error(`UI_SNAPSHOT_SCHEMA_UNSUPPORTED:${snapshot.schema || "MISSING"}`);
  }
  if (!isRecord(snapshot.model)) throw new Error("UI_SNAPSHOT_MODEL_REQUIRED");
  return cloneValue(snapshot.model);
}

export function createUiCommandError(message, error) {
  const detail = error instanceof Error ? error.message : String(error || "Okänt UI-fel");
  if (message?.schema !== UI_COMMAND_SCHEMA) {
    return { ok: false, error: detail };
  }
  return {
    ok: false,
    schema: UI_COMMAND_RESULT_SCHEMA,
    resultVersion: 2,
    requestId: String(message.requestId || ""),
    command: String(message.command || ""),
    error: detail
  };
}

function createUiCommandSuccess(request, value) {
  if (request.responseKind === UI_RESPONSE_KINDS.SNAPSHOT) {
    if (value?.schema !== UI_SNAPSHOT_SCHEMA) {
      throw new Error(`UI_COMMAND_SNAPSHOT_REQUIRED:${request.command}`);
    }
    return {
      ok: true,
      schema: UI_COMMAND_RESULT_SCHEMA,
      resultVersion: 2,
      requestId: request.requestId,
      command: request.command,
      responseKind: request.responseKind,
      uiSnapshot: value
    };
  }
  return {
    ok: true,
    schema: UI_COMMAND_RESULT_SCHEMA,
    resultVersion: 2,
    requestId: request.requestId,
    command: request.command,
    responseKind: request.responseKind,
    data: cloneValue(value || {})
  };
}

export async function dispatchUiCommand(message, handlers) {
  const request = parseUiCommand(message);
  const handler = handlers?.[request.command];
  if (typeof handler !== "function") throw new Error(`UI_COMMAND_HANDLER_MISSING:${request.command}`);
  const value = await handler({
    command: request.command,
    windowId: request.windowId,
    requestId: request.requestId,
    payload: request.payload
  });
  return createUiCommandSuccess(request, value);
}

export function unwrapUiCommandResult(response, {
  command,
  requestId
} = {}) {
  if (!isRecord(response)) throw new Error("UI_COMMAND_RESULT_INVALID");
  if (!response.schema) {
    if (response.ok === false) throw new Error(response.error || "UI-kommandot misslyckades.");
    return response;
  }
  if (response.schema !== UI_COMMAND_RESULT_SCHEMA) {
    throw new Error(`UI_COMMAND_RESULT_SCHEMA_UNSUPPORTED:${response.schema}`);
  }
  if (response.ok !== true) throw new Error(response.error || "UI-kommandot misslyckades.");
  if (command && response.command !== command) {
    throw new Error(`UI_COMMAND_RESULT_COMMAND_MISMATCH:${response.command}`);
  }
  if (requestId && response.requestId !== requestId) {
    throw new Error("UI_COMMAND_RESULT_REQUEST_ID_MISMATCH");
  }
  if (response.responseKind === UI_RESPONSE_KINDS.SNAPSHOT) {
    readUiSnapshotModel(response.uiSnapshot);
    return response.uiSnapshot;
  }
  if (response.responseKind === UI_RESPONSE_KINDS.ACK) return response.data || {};
  throw new Error(`UI_COMMAND_RESULT_KIND_UNSUPPORTED:${response.responseKind}`);
}
