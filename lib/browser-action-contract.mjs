import {
  nullableInteger,
  sanitizeText,
  sha256Hex,
  stableStringify
} from "./common.mjs";
import {
  redactEvidenceText
} from "./evidence-contract.mjs";
import {
  verifyBrowserObservation
} from "./browser-observation.mjs";

export const BROWSER_ACTION_PROTOCOL = "EIC_BROWSER_ACTION/1";
export const BROWSER_ACTION_SCHEMA = "eic.autonom.browser-action.v1";
export const BROWSER_ACTION_RECEIPT_SCHEMA = "eic.autonom.browser-action-receipt.v1";

export const BROWSER_ACTIONS = Object.freeze([
  "observe",
  "scroll",
  "click",
  "double_click",
  "focus",
  "type",
  "clear",
  "select",
  "check",
  "uncheck",
  "keypress",
  "navigate",
  "back",
  "forward",
  "reload",
  "wait_for",
  "capture"
]);

export const FORBIDDEN_BROWSER_ACTIONS = Object.freeze([
  "eval",
  "execute_javascript",
  "run_script",
  "call_function",
  "set_cookie",
  "modify_request"
]);

const ACTION_SET = new Set(BROWSER_ACTIONS);
const TOP_LEVEL_FIELDS = new Set([
  "protocol",
  "schemaVersion",
  "actionId",
  "turnId",
  "observationId",
  "observationDigest",
  "operation",
  "target",
  "args",
  "expectedEffect"
]);
const TARGET_FIELDS = new Set([
  "tabId",
  "surfaceId",
  "documentEpoch",
  "origin",
  "elementRef"
]);
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/i;
const KEY_SET = new Set([
  "Enter", "Escape", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Home", "End", "PageUp", "PageDown", "Backspace", "Delete", "Space"
]);
const ELEMENT_OPERATIONS = new Set([
  "click", "double_click", "focus", "type", "clear", "select", "check", "uncheck"
]);
const SENSITIVE_TEXT = [
  /\bBearer\s+[A-Za-z0-9._~+\/=-]{8,}\b/i,
  /\bBasic\s+[A-Za-z0-9+\/=]{8,}\b/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /(?:password|passwd|secret|token|api[-_]?key|authorization|cookie)\s*[:=]/i,
  /\b(?:sk|pk|api)[-_][A-Za-z0-9_-]{12,}\b/i
];

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function unknownFields(value, allowed) {
  return Object.keys(value || {}).filter((key) => !allowed.has(key));
}

function requireId(value, name) {
  const text = String(value || "");
  if (!ID_PATTERN.test(text)) throw new Error(`BROWSER_ACTION_${name}_INVALID`);
  return text;
}

function requireDigest(value, name) {
  const text = String(value || "").toLowerCase();
  if (!DIGEST_PATTERN.test(text)) throw new Error(`BROWSER_ACTION_${name}_INVALID`);
  return text;
}

function exactOrigin(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw new Error("BROWSER_ACTION_ORIGIN_INVALID");
  }
  if (!["http:", "https:"].includes(parsed.protocol) ||
      parsed.username || parsed.password ||
      parsed.origin !== String(value)) {
    throw new Error("BROWSER_ACTION_ORIGIN_INVALID");
  }
  return parsed.origin;
}

function actionJsonAfterMarker(text, markerIndex) {
  const after = text.slice(markerIndex + BROWSER_ACTION_PROTOCOL.length);
  const fenced = after.match(/^\s*```(?:json)?\s*\n([\s\S]*?)\n```/i);
  if (fenced) return fenced[1].trim();
  const start = after.search(/\{/);
  if (start < 0) throw new Error("BROWSER_ACTION_JSON_MISSING");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < after.length; index += 1) {
    const char = after[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return after.slice(start, index + 1);
    }
  }
  throw new Error("BROWSER_ACTION_JSON_UNTERMINATED");
}

function normalizeArgs(operation, argsValue) {
  const args = record(argsValue) ? { ...argsValue } : {};
  let allowed = new Set();
  if (operation === "scroll") allowed = new Set(["deltaX", "deltaY"]);
  else if (operation === "type") allowed = new Set(["text"]);
  else if (operation === "select") allowed = new Set(["index"]);
  else if (operation === "keypress") allowed = new Set(["key", "shift"]);
  else if (operation === "navigate") allowed = new Set(["url"]);
  else if (operation === "wait_for") allowed = new Set(["condition", "timeoutMs"]);
  const unknown = unknownFields(args, allowed);
  if (unknown.length) throw new Error(`BROWSER_ACTION_ARGS_UNKNOWN:${unknown.join(",")}`);

  if (operation === "scroll") {
    const deltaX = Number(args.deltaX || 0);
    const deltaY = Number(args.deltaY || 0);
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) ||
        Math.abs(deltaX) > 5000 || Math.abs(deltaY) > 5000 ||
        (deltaX === 0 && deltaY === 0)) {
      throw new Error("BROWSER_ACTION_SCROLL_INVALID");
    }
    return { deltaX, deltaY };
  }
  if (operation === "type") {
    const text = String(args.text ?? "");
    if (!text || text.length > 4000) throw new Error("BROWSER_ACTION_TYPE_TEXT_INVALID");
    if (SENSITIVE_TEXT.some((pattern) => pattern.test(text))) {
      throw new Error("BROWSER_ACTION_SENSITIVE_TEXT_FORBIDDEN");
    }
    return { text };
  }
  if (operation === "select") {
    const index = Number(args.index);
    if (!Number.isInteger(index) || index < 0 || index > 100) {
      throw new Error("BROWSER_ACTION_SELECT_INDEX_INVALID");
    }
    return { index };
  }
  if (operation === "keypress") {
    const key = String(args.key || "");
    if (!KEY_SET.has(key)) throw new Error("BROWSER_ACTION_KEY_FORBIDDEN");
    return { key, shift: Boolean(args.shift) };
  }
  if (operation === "navigate") {
    let parsed;
    try {
      parsed = new URL(String(args.url || ""));
    } catch {
      throw new Error("BROWSER_ACTION_NAVIGATE_URL_INVALID");
    }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error("BROWSER_ACTION_NAVIGATE_URL_INVALID");
    }
    if (SENSITIVE_TEXT.some((pattern) => pattern.test(parsed.href))) {
      throw new Error("BROWSER_ACTION_NAVIGATE_SECRET_FORBIDDEN");
    }
    return { url: parsed.href };
  }
  if (operation === "wait_for") {
    const condition = String(args.condition || "");
    if (!["document_ready", "element_present", "element_absent", "duration"].includes(condition)) {
      throw new Error("BROWSER_ACTION_WAIT_CONDITION_INVALID");
    }
    const timeoutMs = Math.max(100, Math.min(10_000, Number(args.timeoutMs || 3000)));
    return { condition, timeoutMs };
  }
  return {};
}

export function parseBrowserActionResponse(responseText) {
  const text = String(responseText || "");
  const matches = [...text.matchAll(/^\s*EIC_BROWSER_ACTION\/1\s*$/gm)];
  if (!matches.length) return { kind: "NO_ACTION", action: null };
  if (matches.length !== 1) throw new Error(`BROWSER_ACTION_COUNT_INVALID:${matches.length}`);
  const markerOffset = matches[0].index + matches[0][0].indexOf(BROWSER_ACTION_PROTOCOL);
  const jsonText = actionJsonAfterMarker(text, markerOffset);
  let value;
  try {
    value = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`BROWSER_ACTION_JSON_INVALID:${error?.message || error}`);
  }
  if (!record(value)) throw new Error("BROWSER_ACTION_OBJECT_REQUIRED");
  return { kind: "ACTION", action: normalizeBrowserAction(value) };
}

export function normalizeBrowserAction(value) {
  if (!record(value)) throw new Error("BROWSER_ACTION_OBJECT_REQUIRED");
  const unknown = unknownFields(value, TOP_LEVEL_FIELDS);
  if (unknown.length) throw new Error(`BROWSER_ACTION_FIELDS_UNKNOWN:${unknown.join(",")}`);
  if (value.protocol !== BROWSER_ACTION_PROTOCOL || Number(value.schemaVersion) !== 1) {
    throw new Error("BROWSER_ACTION_PROTOCOL_INVALID");
  }
  const operation = String(value.operation || "").toLowerCase();
  if (!ACTION_SET.has(operation)) {
    if (FORBIDDEN_BROWSER_ACTIONS.includes(operation)) {
      throw new Error(`BROWSER_ACTION_OPERATION_FORBIDDEN:${operation}`);
    }
    throw new Error(`BROWSER_ACTION_OPERATION_UNKNOWN:${operation}`);
  }
  const targetValue = record(value.target) ? value.target : {};
  const unknownTarget = unknownFields(targetValue, TARGET_FIELDS);
  if (unknownTarget.length) throw new Error(`BROWSER_ACTION_TARGET_FIELDS_UNKNOWN:${unknownTarget.join(",")}`);
  const normalizedTabId = nullableInteger(targetValue.tabId);
  const target = {
    tabId: normalizedTabId,
    surfaceId: requireId(targetValue.surfaceId, "SURFACE_ID"),
    documentEpoch: requireId(targetValue.documentEpoch, "DOCUMENT_EPOCH"),
    origin: exactOrigin(targetValue.origin),
    elementRef: targetValue.elementRef ? requireId(targetValue.elementRef, "ELEMENT_REF") : ""
  };
  if (target.tabId === null) throw new Error("BROWSER_ACTION_TAB_ID_INVALID");
  if (ELEMENT_OPERATIONS.has(operation) && !target.elementRef) {
    throw new Error(`BROWSER_ACTION_ELEMENT_REF_REQUIRED:${operation}`);
  }
  const observationOptional = operation === "observe";
  const observationId = observationOptional && !value.observationId
    ? ""
    : requireId(value.observationId, "OBSERVATION_ID");
  const observationDigest = observationOptional && !value.observationDigest
    ? ""
    : requireDigest(value.observationDigest, "OBSERVATION_DIGEST");
  const expectedEffect = redactEvidenceText(value.expectedEffect, 600);
  if (!expectedEffect) throw new Error("BROWSER_ACTION_EXPECTED_EFFECT_REQUIRED");
  return {
    schema: BROWSER_ACTION_SCHEMA,
    version: 1,
    protocol: BROWSER_ACTION_PROTOCOL,
    schemaVersion: 1,
    actionId: requireId(value.actionId, "ACTION_ID"),
    turnId: requireId(value.turnId, "TURN_ID"),
    observationId,
    observationDigest,
    operation,
    target,
    args: normalizeArgs(operation, value.args),
    expectedEffect
  };
}

function sameIdentity(target, surface) {
  const targetTabId = nullableInteger(target?.tabId);
  const surfaceTabId = nullableInteger(surface?.tabId);
  return targetTabId !== null && surfaceTabId !== null &&
    targetTabId === surfaceTabId &&
    target.surfaceId === String(surface?.surfaceId || "") &&
    target.documentEpoch === String(surface?.documentEpoch || "") &&
    target.origin === String(surface?.origin || "");
}

function observationElement(observation, ref) {
  return (observation?.elements || []).find((item) => item.ref === ref) || null;
}

export async function validateBrowserAction(actionValue, {
  surface,
  observation = null,
  now = Date.now(),
  consumedActionIds = [],
  consumedTurnIds = []
} = {}) {
  const action = normalizeBrowserAction(actionValue);
  if (!sameIdentity(action.target, surface)) throw new Error("BROWSER_ACTION_TARGET_IDENTITY_MISMATCH");
  if (consumedActionIds.includes(action.actionId)) throw new Error("BROWSER_ACTION_REPLAY_ACTION_ID");
  if (consumedTurnIds.includes(action.turnId)) throw new Error("BROWSER_ACTION_REPLAY_TURN_ID");

  if (action.operation === "navigate") {
    const destination = new URL(action.args.url);
    if (destination.origin !== action.target.origin) {
      throw new Error("BROWSER_ACTION_CROSS_ORIGIN_NAVIGATION_FORBIDDEN");
    }
  }

  if (action.operation !== "observe") {
    if (!observation) throw new Error("BROWSER_ACTION_OBSERVATION_REQUIRED");
    if (!await verifyBrowserObservation(observation)) {
      throw new Error("BROWSER_ACTION_OBSERVATION_DIGEST_INVALID");
    }
    if (action.observationId !== observation.observationId ||
        action.observationDigest !== observation.observationDigest) {
      throw new Error("BROWSER_ACTION_OBSERVATION_IDENTITY_MISMATCH");
    }
    if (!sameIdentity(observation.target, surface)) {
      throw new Error("BROWSER_ACTION_OBSERVATION_TARGET_MISMATCH");
    }
    if (Date.parse(observation.expiresAt || "") <= now) {
      throw new Error("BROWSER_ACTION_OBSERVATION_EXPIRED");
    }
  }

  const element = action.target.elementRef
    ? observationElement(observation, action.target.elementRef)
    : null;
  if (ELEMENT_OPERATIONS.has(action.operation) && !element) {
    throw new Error("BROWSER_ACTION_ELEMENT_REF_STALE");
  }
  if (element?.disabled) throw new Error("BROWSER_ACTION_ELEMENT_DISABLED");
  if (action.operation === "type" || action.operation === "clear") {
    if (!element?.editable || element?.sensitive) {
      throw new Error("BROWSER_ACTION_TEXT_TARGET_FORBIDDEN");
    }
  }
  if (action.operation === "select" && !["combobox", "listbox"].includes(element?.role)) {
    throw new Error("BROWSER_ACTION_SELECT_TARGET_INVALID");
  }
  if (["check", "uncheck"].includes(action.operation) &&
      !["checkbox", "switch", "radio"].includes(element?.role)) {
    throw new Error("BROWSER_ACTION_CHECK_TARGET_INVALID");
  }
  if (action.operation === "wait_for" &&
      ["element_present", "element_absent"].includes(action.args.condition) &&
      !action.target.elementRef) {
    throw new Error("BROWSER_ACTION_WAIT_ELEMENT_REF_REQUIRED");
  }
  return { action, element };
}

export async function browserActionDigest(action) {
  return sha256Hex(stableStringify(normalizeBrowserAction(action)));
}

export function createBrowserActionReceipt({
  action,
  status,
  methods = [],
  startedAt,
  completedAt,
  targetAfter = null,
  effectReadback = "NOT_RUN",
  error = ""
} = {}) {
  return {
    schema: BROWSER_ACTION_RECEIPT_SCHEMA,
    version: 1,
    actionId: action.actionId,
    turnId: action.turnId,
    operation: action.operation,
    status: String(status || "UNKNOWN"),
    expectedEffect: action.expectedEffect,
    targetBefore: { ...action.target },
    targetAfter: targetAfter ? { ...targetAfter } : null,
    methods: methods.map((method) => sanitizeText(method, 160)),
    startedAt: String(startedAt || ""),
    completedAt: String(completedAt || ""),
    effectReadback: String(effectReadback || "NOT_RUN"),
    error: redactEvidenceText(error, 800)
  };
}
