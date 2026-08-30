import {
  nowIso,
  nullableInteger,
  randomId,
  sanitizeText,
  sha256Hex,
  stableStringify
} from "./common.mjs";
import {
  redactEvidenceText
} from "./evidence-contract.mjs";

export const BROWSER_RISK_DECISION_SCHEMA = "eic.autonom.browser-risk-decision.v1";
export const BROWSER_APPROVAL_SCHEMA = "eic.autonom.browser-approval.v1";

export const BROWSER_RISK_LEVELS = Object.freeze({
  READ_ONLY: "READ_ONLY",
  INTERACTIVE: "INTERACTIVE",
  EXTERNAL_EFFECTS: "EXTERNAL_EFFECTS",
  HUMAN_REQUIRED: "HUMAN_REQUIRED"
});

export const BROWSER_APPROVAL_STATES = Object.freeze({
  NOT_REQUIRED: "NOT_REQUIRED",
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  DENIED: "DENIED",
  CONSUMED: "CONSUMED",
  EXPIRED: "EXPIRED"
});

export const BROWSER_APPROVAL_TTL_MS = 15 * 60 * 1000;

const READ_ONLY_OPS = new Set(["observe", "scroll", "wait_for", "capture"]);
const INTERACTIVE_OPS = new Set([
  "click", "double_click", "focus", "type", "clear", "select", "check", "uncheck",
  "keypress", "navigate", "back", "forward", "reload"
]);

const HUMAN_RULES = Object.freeze([
  ["AUTHENTICATION", /\b(password|passcode|pin|sign[\s-]?in|log[\s-]?in|authentication|credential)\b/i],
  ["TWO_FACTOR", /\b(2fa|two[\s-]?factor|one[\s-]?time|otp|totp|webauthn|security key|verification code)\b/i],
  ["CAPTCHA", /\b(captcha|recaptcha|hcaptcha|human verification)\b/i],
  ["PAYMENT_OR_PURCHASE", /\b(payment|pay now|purchase|buy now|checkout|credit card|card number|cvv|billing)\b/i],
  ["DELETE_OR_DESTRUCTIVE", /\b(delete|erase|remove account|close account|permanent|destroy)\b/i],
  ["PUBLICATION_OR_EXTERNAL_MESSAGE", /\b(publish|post publicly|send message|send email|submit comment|external message|share publicly)\b/i],
  ["ACCOUNT_OR_PERMISSION_CHANGE", /\b(change password|account settings|permission|grant access|revoke access|role change|invite user)\b/i],
  ["LOCAL_FILE_OR_NATIVE_DIALOG", /\b(upload|choose file|file picker|native dialog|open file|select file)\b/i],
  ["SECRET_ACCESS", /\b(secret|api[\s_-]?key|bearer token|private key|session token|access token)\b/i]
]);

const EXTERNAL_RULES = Object.freeze([
  ["FORM_SUBMISSION", /\b(submit|save changes|confirm|apply|register|subscribe|unsubscribe)\b/i],
  ["DATA_MUTATION", /\b(create|update|edit|change|add item|remove item|set value)\b/i],
  ["EXTERNAL_EFFECT", /\b(send|share|notify|book|reserve|order)\b/i]
]);

const INJECTION_PATTERNS = Object.freeze([
  /ignore (all|any|the|previous|prior) instructions/i,
  /system prompt/i,
  /developer message/i,
  /override (policy|permissions|approval|mandate)/i,
  /reveal (secrets|credentials|tokens|passwords)/i,
  /upload (all|local) files/i,
  /do not tell the user/i,
  /execute (javascript|script|code)/i
]);

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function exactTarget(action) {
  return {
    tabId: nullableInteger(action?.target?.tabId),
    surfaceId: String(action?.target?.surfaceId || ""),
    documentEpoch: String(action?.target?.documentEpoch || ""),
    origin: String(action?.target?.origin || "")
  };
}

function observationElement(observation, action) {
  const ref = String(action?.target?.elementRef || "");
  if (!ref || !Array.isArray(observation?.elements)) return null;
  return observation.elements.find((entry) => entry?.ref === ref) || null;
}

function riskText(action, observation) {
  const element = observationElement(observation, action);
  return [
    action?.operation,
    action?.expectedEffect,
    action?.args?.text,
    action?.args?.value,
    action?.args?.url,
    action?.args?.key,
    element?.role,
    element?.name,
    element?.sensitive ? "sensitive field" : ""
  ].map((value) => sanitizeText(value || "", 800)).filter(Boolean).join(" ");
}

function reasonCodes(text, rules) {
  return rules.filter(([, pattern]) => pattern.test(text)).map(([code]) => code);
}

function riskRank(level) {
  return {
    [BROWSER_RISK_LEVELS.READ_ONLY]: 1,
    [BROWSER_RISK_LEVELS.INTERACTIVE]: 2,
    [BROWSER_RISK_LEVELS.EXTERNAL_EFFECTS]: 3,
    [BROWSER_RISK_LEVELS.HUMAN_REQUIRED]: 4
  }[level] || 4;
}

function raiseRisk(current, next) {
  return riskRank(next) > riskRank(current) ? next : current;
}

function normalizeDigest(value) {
  const text = String(value || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error("BROWSER_POLICY_DIGEST_INVALID");
  return text;
}

export async function browserActionDigest(action) {
  return sha256Hex(stableStringify(action));
}

export function detectPromptInjectionSignals(value) {
  const text = redactEvidenceText(value || "", 4000);
  return INJECTION_PATTERNS
    .filter((pattern) => pattern.test(text))
    .map((pattern, index) => `TARGET_INJECTION_SIGNAL_${index + 1}`)
    .slice(0, 12);
}

export function isolateBrowserObservation(observationValue) {
  if (!record(observationValue)) return null;
  const observation = observationValue;
  return {
    protocol: String(observation.protocol || ""),
    schemaVersion: Number(observation.schemaVersion || 0),
    observationId: String(observation.observationId || ""),
    observationDigest: String(observation.observationDigest || ""),
    capturedAt: String(observation.capturedAt || ""),
    expiresAt: String(observation.expiresAt || ""),
    contentClass: "UNTRUSTED_TARGET_OBSERVATION",
    instructionAuthority: "NONE",
    target: {
      tabId: nullableInteger(observation.target?.tabId),
      surfaceId: String(observation.target?.surfaceId || ""),
      documentEpoch: String(observation.target?.documentEpoch || ""),
      origin: String(observation.target?.origin || "")
    },
    page: {
      url: String(observation.page?.url || ""),
      title: redactEvidenceText(observation.page?.title, 300),
      injectionSignals: detectPromptInjectionSignals(observation.page?.title)
    },
    elements: (Array.isArray(observation.elements) ? observation.elements : []).slice(0, 200).map((element) => {
      const name = redactEvidenceText(element?.name, 240);
      return {
        ref: String(element?.ref || ""),
        role: String(element?.role || ""),
        name,
        contentClass: "UNTRUSTED_TARGET_TEXT",
        injectionSignals: detectPromptInjectionSignals(name),
        disabled: Boolean(element?.disabled),
        checked: element?.checked ?? null,
        selected: Boolean(element?.selected),
        focusable: Boolean(element?.focusable),
        editable: Boolean(element?.editable),
        sensitive: Boolean(element?.sensitive)
      };
    }),
    evidenceRefs: (Array.isArray(observation.evidenceRefs) ? observation.evidenceRefs : [])
      .map(String).slice(0, 64)
  };
}

export async function classifyBrowserActionRisk({
  action,
  observation = null,
  now = Date.now()
} = {}) {
  if (!record(action) || !action.actionId || !action.turnId || !action.operation) {
    throw new Error("BROWSER_POLICY_ACTION_REQUIRED");
  }
  const operation = String(action.operation).toLowerCase();
  let level = READ_ONLY_OPS.has(operation)
    ? BROWSER_RISK_LEVELS.READ_ONLY
    : INTERACTIVE_OPS.has(operation)
      ? BROWSER_RISK_LEVELS.INTERACTIVE
      : BROWSER_RISK_LEVELS.HUMAN_REQUIRED;
  const text = riskText(action, observation);
  const human = reasonCodes(text, HUMAN_RULES);
  const external = reasonCodes(text, EXTERNAL_RULES);
  const injectionSignals = detectPromptInjectionSignals(text);
  if (external.length) level = raiseRisk(level, BROWSER_RISK_LEVELS.EXTERNAL_EFFECTS);
  if (human.length) level = BROWSER_RISK_LEVELS.HUMAN_REQUIRED;

  const element = observationElement(observation, action);
  if (element?.sensitive) {
    level = BROWSER_RISK_LEVELS.HUMAN_REQUIRED;
    human.push("SENSITIVE_ELEMENT");
  }
  if (injectionSignals.length) {
    // Target/model text can only raise risk. It can never lower policy or authorize an action.
    level = raiseRisk(level, BROWSER_RISK_LEVELS.EXTERNAL_EFFECTS);
  }

  const decision = {
    schema: BROWSER_RISK_DECISION_SCHEMA,
    version: 1,
    decisionId: randomId("browser-risk"),
    actionId: String(action.actionId),
    turnId: String(action.turnId),
    actionDigest: await browserActionDigest(action),
    target: exactTarget(action),
    level,
    approvalRequired: [
      BROWSER_RISK_LEVELS.EXTERNAL_EFFECTS,
      BROWSER_RISK_LEVELS.HUMAN_REQUIRED
    ].includes(level),
    mandatoryHumanPresence: level === BROWSER_RISK_LEVELS.HUMAN_REQUIRED,
    reasonCodes: [...new Set([
      ...(READ_ONLY_OPS.has(operation) ? ["READ_ONLY_OPERATION"] : []),
      ...(INTERACTIVE_OPS.has(operation) ? ["INTERACTIVE_OPERATION"] : []),
      ...external,
      ...human,
      ...injectionSignals
    ])].slice(0, 32),
    targetTextAuthority: "NONE",
    policyFloor: level,
    createdAt: nowIso(now)
  };
  return decision;
}

export async function createPendingBrowserApproval({
  action,
  responseHash,
  decision,
  now = Date.now()
} = {}) {
  if (decision?.schema !== BROWSER_RISK_DECISION_SCHEMA || !decision.approvalRequired) {
    throw new Error("BROWSER_APPROVAL_DECISION_REQUIRED");
  }
  const actionDigest = await browserActionDigest(action);
  if (actionDigest !== decision.actionDigest) throw new Error("BROWSER_APPROVAL_ACTION_DIGEST_MISMATCH");
  return {
    schema: BROWSER_APPROVAL_SCHEMA,
    version: 1,
    approvalId: randomId("browser-approval"),
    status: BROWSER_APPROVAL_STATES.PENDING,
    actionId: String(action.actionId),
    turnId: String(action.turnId),
    actionDigest,
    responseHash: normalizeDigest(responseHash),
    target: exactTarget(action),
    riskDecision: decision,
    justification: "",
    approvedBy: "",
    approvedAt: null,
    deniedAt: null,
    consumedAt: null,
    createdAt: nowIso(now),
    expiresAt: nowIso(now + BROWSER_APPROVAL_TTL_MS)
  };
}

export function normalizeBrowserApproval(value, now = Date.now()) {
  if (!record(value) || value.schema !== BROWSER_APPROVAL_SCHEMA) return null;
  const approval = {
    ...value,
    status: Object.values(BROWSER_APPROVAL_STATES).includes(value.status)
      ? value.status
      : BROWSER_APPROVAL_STATES.DENIED,
    actionId: String(value.actionId || ""),
    turnId: String(value.turnId || ""),
    actionDigest: String(value.actionDigest || ""),
    responseHash: String(value.responseHash || ""),
    justification: sanitizeText(value.justification, 1200),
    approvedBy: sanitizeText(value.approvedBy, 120),
    target: {
      tabId: nullableInteger(value.target?.tabId),
      surfaceId: String(value.target?.surfaceId || ""),
      documentEpoch: String(value.target?.documentEpoch || ""),
      origin: String(value.target?.origin || "")
    }
  };
  if (approval.status === BROWSER_APPROVAL_STATES.PENDING ||
      approval.status === BROWSER_APPROVAL_STATES.APPROVED) {
    const expiry = Date.parse(approval.expiresAt || "");
    if (!Number.isFinite(expiry) || expiry <= now) {
      approval.status = BROWSER_APPROVAL_STATES.EXPIRED;
    }
  }
  return approval;
}

export async function approvalMatchesAction(approvalValue, {
  action,
  responseHash,
  now = Date.now()
} = {}) {
  const approval = normalizeBrowserApproval(approvalValue, now);
  if (!approval || approval.status !== BROWSER_APPROVAL_STATES.APPROVED) return false;
  const target = exactTarget(action);
  const actionDigest = await browserActionDigest(action);
  return approval.actionId === String(action?.actionId || "") &&
    approval.turnId === String(action?.turnId || "") &&
    approval.actionDigest === actionDigest &&
    approval.responseHash === String(responseHash || "").toLowerCase() &&
    approval.target.tabId === target.tabId &&
    approval.target.surfaceId === target.surfaceId &&
    approval.target.documentEpoch === target.documentEpoch &&
    approval.target.origin === target.origin;
}

export function approveBrowserAction(approvalValue, {
  actionId,
  justification,
  approvedBy = "OPERATOR_UI",
  now = Date.now()
} = {}) {
  const approval = normalizeBrowserApproval(approvalValue, now);
  if (!approval || approval.status !== BROWSER_APPROVAL_STATES.PENDING) {
    throw new Error("BROWSER_APPROVAL_NOT_PENDING");
  }
  if (approval.actionId !== String(actionId || "")) throw new Error("BROWSER_APPROVAL_ACTION_ID_MISMATCH");
  if (approval.riskDecision?.mandatoryHumanPresence === true) {
    throw new Error("BROWSER_APPROVAL_HUMAN_ACTION_NOT_AUTOMATABLE");
  }
  const reason = sanitizeText(justification, 1200);
  if (reason.length < 12) throw new Error("BROWSER_APPROVAL_JUSTIFICATION_TOO_SHORT");
  return {
    ...approval,
    status: BROWSER_APPROVAL_STATES.APPROVED,
    justification: reason,
    approvedBy: sanitizeText(approvedBy, 120) || "OPERATOR_UI",
    approvedAt: nowIso(now)
  };
}

export function denyBrowserAction(approvalValue, {
  actionId,
  justification = "Operator denied the browser action.",
  now = Date.now()
} = {}) {
  const approval = normalizeBrowserApproval(approvalValue, now);
  if (!approval || ![
    BROWSER_APPROVAL_STATES.PENDING,
    BROWSER_APPROVAL_STATES.APPROVED
  ].includes(approval.status)) {
    throw new Error("BROWSER_APPROVAL_NOT_DENIABLE");
  }
  if (approval.actionId !== String(actionId || "")) throw new Error("BROWSER_APPROVAL_ACTION_ID_MISMATCH");
  return {
    ...approval,
    status: BROWSER_APPROVAL_STATES.DENIED,
    justification: sanitizeText(justification, 1200),
    deniedAt: nowIso(now)
  };
}

export async function consumeBrowserApproval(approvalValue, {
  action,
  responseHash,
  now = Date.now()
} = {}) {
  if (!await approvalMatchesAction(approvalValue, { action, responseHash, now })) {
    throw new Error("BROWSER_APPROVAL_NOT_VALID_FOR_ACTION");
  }
  return {
    ...normalizeBrowserApproval(approvalValue, now),
    status: BROWSER_APPROVAL_STATES.CONSUMED,
    consumedAt: nowIso(now)
  };
}
