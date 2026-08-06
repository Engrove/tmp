import {
  normalizeWhitespace,
  nowIso,
  sanitizeText,
  sha256Hex,
  stableStringify
} from "./common.mjs";
import {
  classifyEvidence,
  EVIDENCE_CLASSES
} from "./delivery-kernel.mjs";

export const ACTIVE_TASK_BINDING_SCHEMA = "eic.autonom.active-task-binding.v1";
export const MANDATE_REGISTRY_SCHEMA = "eic.autonom.mandate-registry.v1";
export const DECISION_TRACE_SCHEMA = "eic.autonom.decision-trace.v1";

export const TASK_SWITCH_OPERATION = "TASK_SWITCH";

export const DECISION_OWNERS = Object.freeze({
  NANO_HOST: "NANO_HOST",
  LOCAL_PROTOCOL: "LOCAL_PROTOCOL",
  LOCAL_DETERMINISTIC_RECOVERY: "LOCAL_DETERMINISTIC_RECOVERY"
});

const REQUIRED_BINDING_FIELDS = Object.freeze([
  "projectId",
  "workstreamId",
  "taskFingerprint",
  "auditRunId",
  "mandateVersion",
  "mandateSha256",
  "sourceTurnId"
]);

const STRONG_CLAIM_TYPES = new Set([
  "ARTIFACT",
  "COMMIT",
  "ISSUE",
  "TEST",
  "RUNTIME",
  "PROJECT_UPDATE",
  "INSTALLATION",
  "DEPLOYMENT",
  "RELEASE",
  "WORKSPACE",
  "SOURCE",
  "FILE",
  "OWNER_READBACK"
]);

const SELF_REFERENTIAL_NANO_ACTION = /(?:\b(?:aktivera|återaktivera|kör|starta|återköa|requeue|invoke)\s+(?:den\s+)?(?:lokala?\s+)?nano\b|\bnano[- ]owner[- ]route\b|\båterköa\s+(?:genom\s+)?(?:en\s+)?lokal\s+nano\b)/iu;
const ACTION_LIKE_STOP = /^(?:aktivera|återaktivera|kör|starta|fortsätt|återköa|läs|skapa|implementera|anropa|proba|testa)\b/iu;

function fail(code, message, detail = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  Object.assign(error, detail);
  throw error;
}

function requiredText(value, field, maxLength = 2000) {
  const text = sanitizeText(value, maxLength);
  if (!text) fail("REQUIRED_FIELD_MISSING", `${field} krävs.`, { field });
  return text;
}

function normalizedSemantic(value) {
  return normalizeWhitespace(String(value ?? ""))
    .toLocaleLowerCase("sv")
    .replace(/[.,;:!?()[\]{}"'`´“”‘’]/gu, "")
    .trim();
}

export async function createActiveTaskBinding({
  projectId,
  workstreamId,
  taskFingerprint,
  auditRunId,
  mandateVersion,
  mandateSha256,
  sourceTurnId
} = {}) {
  const binding = {
    schema: ACTIVE_TASK_BINDING_SCHEMA,
    projectId: Number(projectId),
    workstreamId: requiredText(workstreamId, "workstreamId", 240),
    taskFingerprint: requiredText(taskFingerprint, "taskFingerprint", 256),
    auditRunId: requiredText(auditRunId, "auditRunId", 240),
    mandateVersion: requiredText(mandateVersion, "mandateVersion", 160),
    mandateSha256: requiredText(mandateSha256, "mandateSha256", 96).toLowerCase(),
    sourceTurnId: requiredText(sourceTurnId, "sourceTurnId", 240)
  };
  if (!Number.isInteger(binding.projectId) || binding.projectId <= 0) {
    fail("PROJECT_ID_INVALID", "projectId måste vara ett positivt heltal.");
  }
  if (!/^(?:sha256:)?[a-f0-9]{64}$/u.test(binding.mandateSha256)) {
    fail("MANDATE_SHA_INVALID", "mandateSha256 måste vara SHA-256.");
  }
  binding.bindingSha256 = await sha256Hex(stableStringify(binding));
  return Object.freeze(binding);
}

export function validateActiveTaskBinding(binding) {
  if (!binding || typeof binding !== "object") {
    fail("ACTIVE_TASK_BINDING_MISSING", "active_task_binding saknas.");
  }
  if (binding.schema !== ACTIVE_TASK_BINDING_SCHEMA) {
    fail("ACTIVE_TASK_BINDING_SCHEMA_INVALID", "Fel active_task_binding-schema.");
  }
  for (const field of REQUIRED_BINDING_FIELDS) {
    if (field === "projectId") {
      if (!Number.isInteger(Number(binding[field])) || Number(binding[field]) <= 0) {
        fail("PROJECT_ID_INVALID", "projectId måste vara ett positivt heltal.");
      }
    } else if (!sanitizeText(binding[field], 500)) {
      fail("ACTIVE_TASK_BINDING_FIELD_MISSING", `${field} saknas.`, { field });
    }
  }
  if (!/^(?:sha256:)?[a-f0-9]{64}$/iu.test(String(binding.mandateSha256))) {
    fail("MANDATE_SHA_INVALID", "mandateSha256 måste vara SHA-256.");
  }
  return true;
}

export function assertTaskBindingTransition(current, candidate, {
  operation = "CONTINUE"
} = {}) {
  validateActiveTaskBinding(candidate);
  if (!current) return { allowed: true, switched: false, binding: candidate };
  validateActiveTaskBinding(current);

  if (current.mandateVersion === candidate.mandateVersion &&
      current.mandateSha256 !== candidate.mandateSha256) {
    fail(
      "MANDATE_VERSION_HASH_CONFLICT",
      `Mandatversion ${candidate.mandateVersion} är redan bunden till en annan hash.`,
      { currentSha256: current.mandateSha256, candidateSha256: candidate.mandateSha256 }
    );
  }

  const identityFields = ["projectId", "workstreamId", "taskFingerprint"];
  const changed = identityFields.filter((field) => String(current[field]) !== String(candidate[field]));
  if (changed.length && operation !== TASK_SWITCH_OPERATION) {
    fail(
      "PROJECT_BINDING_CONFLICT",
      `Task binding ändrades i ${changed.join(", ")} utan explicit TASK_SWITCH.`,
      { changedFields: changed }
    );
  }
  return {
    allowed: true,
    switched: changed.length > 0,
    binding: candidate,
    changedFields: changed
  };
}

export async function contentAddressedMandateVersion(surface, text) {
  const normalizedSurface = requiredText(surface, "surface", 40)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  const normalizedText = sanitizeText(text, 120_000);
  if (!normalizedText) {
    fail("MANDATE_TEXT_EMPTY", "Mandattext krävs för en innehållsadresserad version.");
  }
  const digest = await sha256Hex(normalizedText);
  return `${normalizedSurface}-custom-${digest.slice(0, 16)}`;
}

export async function registerMandateVersion(registryValue, {
  surface = "TARGET",
  version,
  text = "",
  sha256 = ""
} = {}) {
  const registry = registryValue && typeof registryValue === "object"
    ? structuredClone(registryValue)
    : { schema: MANDATE_REGISTRY_SCHEMA, entries: {} };
  registry.schema = MANDATE_REGISTRY_SCHEMA;
  registry.entries ||= {};

  const normalizedSurface = requiredText(surface, "surface", 80).toUpperCase();
  const normalizedVersion = requiredText(version, "version", 160);
  const normalizedText = sanitizeText(text, 120_000);
  const digest = (sanitizeText(sha256, 96) || await sha256Hex(normalizedText)).toLowerCase();
  if (!/^(?:sha256:)?[a-f0-9]{64}$/u.test(digest)) {
    fail("MANDATE_SHA_INVALID", "Mandatets SHA-256 är ogiltig.");
  }
  const key = `${normalizedSurface}:${normalizedVersion}`;
  const existing = registry.entries[key];
  if (existing && existing.sha256 !== digest) {
    fail(
      "MANDATE_VERSION_HASH_CONFLICT",
      `${key} kan inte återanvändas med annan semantik.`,
      { key, existingSha256: existing.sha256, candidateSha256: digest }
    );
  }
  registry.entries[key] ||= {
    surface: normalizedSurface,
    version: normalizedVersion,
    sha256: digest
  };
  return {
    registry,
    entry: registry.entries[key],
    reused: Boolean(existing)
  };
}

export function assertTargetActionAllowed(value) {
  const action = requiredText(value, "requestedAction", 5000);
  if (SELF_REFERENTIAL_NANO_ACTION.test(action)) {
    fail(
      "SELF_REFERENTIAL_NANO_ACTION",
      "Målsessionen får inte instrueras att aktivera, köra eller återköa Nano."
    );
  }
  return action;
}

export function assertDistinctClaimsAndInferences(targetClaims = [], inferences = []) {
  const claims = new Set((Array.isArray(targetClaims) ? targetClaims : [])
    .map(normalizedSemantic)
    .filter(Boolean));
  const duplicates = (Array.isArray(inferences) ? inferences : [])
    .map((value) => ({ raw: value, normalized: normalizedSemantic(value) }))
    .filter((item) => item.normalized && claims.has(item.normalized));
  if (duplicates.length) {
    fail(
      "CLAIM_INFERENCE_COLLISION",
      "targetClaims och inferences får inte innehålla semantiskt identiska poster.",
      { duplicates: duplicates.map((item) => sanitizeText(item.raw, 400)) }
    );
  }
  return true;
}

export function validateStopCriteria(criteria = []) {
  const values = Array.isArray(criteria) ? criteria : [];
  for (const item of values) {
    const text = requiredText(item, "stopCriteria[]", 1200);
    if (ACTION_LIKE_STOP.test(text)) {
      fail("STOP_CRITERION_IS_ACTION", `Stopvillkor måste vara ett tillstånd, inte åtgärden: ${text}`);
    }
  }
  return true;
}

export function deriveExecutableWorkUnit({
  statement,
  requestedAction,
  ownerSurface = "TARGET_SESSION_OWNER",
  observableResult = ""
} = {}) {
  const normalizedStatement = requiredText(statement, "workUnit.statement", 5000);
  const action = requiredText(requestedAction, "requestedAction", 5000);
  const verb = sanitizeText(action.split(/\s+/u)[0], 80).replace(/[^\p{L}\p{N}_-]/gu, "") || "Utför";
  const result = requiredText(
    observableResult || "Ett konkret, observerbart resultat eller ett exakt owner-bound blockerarkvitto.",
    "workUnit.observableResult",
    1600
  );
  return {
    statement: normalizedStatement,
    verb,
    exactObject: normalizedStatement,
    ownerSurface: requiredText(ownerSurface, "workUnit.ownerSurface", 300),
    observableResult: result
  };
}

export function validateExecutableWorkUnit(workUnit) {
  if (!workUnit || typeof workUnit !== "object") {
    fail("WORK_UNIT_INVALID", "workUnit måste vara ett strukturerat objekt.");
  }
  for (const field of ["statement", "verb", "exactObject", "ownerSurface", "observableResult"]) {
    requiredText(workUnit[field], `workUnit.${field}`, field === "statement" ? 5000 : 1800);
  }
  return true;
}

export function buildProtocolRepairDecision({
  reason = "PROTOCOL_INVALID"
} = {}) {
  return {
    analysisMode: "PROTOCOL_REPAIR",
    intent: "Återställ det befintliga EIC-AA-svarskontraktet utan att ändra uppgift eller projektbindning.",
    action: "CONTINUE",
    progressDelta: 0,
    reason: `Målsvaret är kontraktsogiltigt: ${sanitizeText(reason, 600)}.`,
    workUnit: "Reparera endast EIC-AA-footern för den senast observerade target-responsen.",
    requestedAction: "Återge endast en kompakt kontraktsreparation med den aktuella repair-turnens EIC_TURN, EIC_NEXT, EIC_COMPLETION_EVIDENCE, EIC_NEXT_ACTOR och EIC_AUTONOMY. Utför ingen ny sakåtgärd i denna tur.",
    requiredEvidence: ["Fem syntaktiskt giltiga EIC-AA/5-footer-rader bundna till rätt turn-id."],
    targetClaims: [],
    inferences: [],
    contextEvidence: ["Lokal targetResult-parser klassificerade svaret som ogiltigt."],
    blockers: [],
    alternatives: [],
    continueCriteria: ["Footer-kontraktet är syntaktiskt återställt."],
    stopCriteria: ["Footer-kontraktet är återställt eller en faktisk owner-/säkerhetsgräns har verifierats."],
    completionScope: "WORK_UNIT",
    completionConfirmed: false,
    pauseOrigin: "NONE",
    boundaryEvidence: "",
    destructivenessLevel: 1,
    destructivenessRationale: "Textuell protokollreparation utan extern effekt.",
    rollbackPath: "Ingen extern effekt; nästa giltiga target-response ersätter reparationsläget.",
    readbackPlan: "Läs nästa target-response genom parseTargetResult.",
    materialAmbiguity: "NONE",
    protocolRepairOnly: true
  };
}

export function decisionOwnerForSource(source) {
  const value = String(source || "").toUpperCase();
  if (value === "NANO") return DECISION_OWNERS.NANO_HOST;
  if (value === "DETERMINISTIC_PROTOCOL") return DECISION_OWNERS.LOCAL_PROTOCOL;
  return DECISION_OWNERS.LOCAL_DETERMINISTIC_RECOVERY;
}

export function recordDecisionTrace(runValue, traceValue, {
  source = "NANO",
  now = Date.now()
} = {}) {
  const run = runValue && typeof runValue === "object" ? structuredClone(runValue) : {};
  const trace = {
    schema: DECISION_TRACE_SCHEMA,
    ...structuredClone(traceValue || {}),
    decisionOwner: decisionOwnerForSource(source),
    recordedAt: nowIso(now)
  };
  run.decisionOwner = trace.decisionOwner;
  if (trace.decisionOwner === DECISION_OWNERS.NANO_HOST) {
    run.lastNanoAttemptTrace = trace;
    run.runtimeDecisionStatus = trace.status === "COMPLETED" ? "NANO_COMPLETED" : `NANO_${trace.status || "UNKNOWN"}`;
  } else {
    run.lastDeterministicRecoveryTrace = trace;
    run.runtimeDecisionStatus = "DEGRADED_RECOVERY";
  }
  return { run, trace };
}


export function stableFingerprint(value) {
  const text = typeof value === "string" ? value : stableStringify(value);
  const seeds = [
    0xcbf29ce484222325n,
    0x84222325cbf29ce4n,
    0x9e3779b185ebca87n,
    0x100000001b3n
  ];
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  const parts = seeds.map((seed, index) => {
    let hash = seed;
    for (const char of `${index}:${text}`) {
      hash ^= BigInt(char.codePointAt(0));
      hash = (hash * prime) & mask;
    }
    return hash.toString(16).padStart(16, "0");
  });
  return parts.join("");
}

export async function buildContinuityTransition({
  progressDelta = 0,
  blockers = [],
  nextDirection = "",
  now = Date.now()
} = {}) {
  const blockerText = (Array.isArray(blockers) ? blockers : [])
    .map((item) => sanitizeText(typeof item === "string" ? item : item?.statement || item?.text, 1600))
    .filter(Boolean)
    .sort();
  return {
    lastProgressDelta: Math.max(0, Math.min(3, Number(progressDelta) || 0)),
    blockerFingerprint: blockerText.length ? stableFingerprint(blockerText) : "",
    nextDirection: sanitizeText(nextDirection, 2000),
    updatedAt: nowIso(now)
  };
}

export function evaluateClaimReceipt({
  claimType,
  claim = "",
  receipt = null,
  sameTurn = false,
  freshOwnerRead = false
} = {}) {
  const type = requiredText(claimType, "claimType", 80).toUpperCase();
  const strong = STRONG_CLAIM_TYPES.has(type);
  const hasReceipt = Boolean(
    receipt &&
    sanitizeText(receipt.ownerSurface, 200) &&
    sanitizeText(receipt.locator, 500) &&
    receipt.readback === true &&
    (sameTurn || freshOwnerRead)
  );
  const evidenceClass = classifyEvidence({
    ownerSurface: receipt?.ownerSurface,
    locator: receipt?.locator,
    readback: receipt?.readback === true,
    current: Boolean(freshOwnerRead),
    durableEffect: Boolean(sameTurn || receipt?.durableEffect),
    localOnly: type === "ARTIFACT" && !hasReceipt
  });
  if (strong && !hasReceipt) {
    return {
      allowed: false,
      band: type === "ARTIFACT" ? "LOCAL_ONLY" : "NOT_VERIFIED",
      evidenceClass,
      claim: sanitizeText(claim, 2000),
      reason: "OWNER_RECEIPT_REQUIRED"
    };
  }
  return {
    allowed: true,
    band: strong ? "VERIFIED" : "CANDIDATE",
    evidenceClass: strong ? EVIDENCE_CLASSES.OWNER_RECEIPT : evidenceClass,
    claim: sanitizeText(claim, 2000),
    receiptLocator: hasReceipt ? sanitizeText(receipt.locator, 500) : ""
  };
}


export function inferStrongClaimTypes(value) {
  const text = normalizedSemantic(
    Array.isArray(value) ? value.join(" ") : value
  );
  const types = new Set();
  const matchers = [
    ["ARTIFACT", /\b(?:artifact|artifakt)(?:\s+#?\d+)?\s+(?:sparad(?:es)?|skapad(?:es)?|skriven|persisted|saved|created|written)\b|\bsparad(?:e|es)?\s+som\s+(?:artifact|artifakt)\b/u],
    ["COMMIT", /\b(?:commit(?:ten)?|commit\s+[a-f0-9]{7,})\s+(?:skapad|skriven|persisted|created|written)\b|\b(?:committad|incheckad)\b/u],
    ["ISSUE", /\b(?:issue|ärende|ticket)(?:\s+#?\d+)?\s+(?:skapad(?:es)?|uppdaterad(?:es)?|created|updated|closed)\b/u],
    ["TEST", /\btests?\s+(?:pass|passed|godkänd|godkända)\b|\b\d+\s*\/\s*\d+\s+pass\b/u],
    ["RUNTIME", /\b(?:runtime|live)\s+(?:verifierad|verified|aktiv|active|running|körande)\b/u],
    ["PROJECT_UPDATE", /\b(?:project update|projektuppdatering)(?:\s+#?\d+)?\s+(?:skapad(?:es)?|skriven|loggad(?:es)?|created|written|logged)\b/u],
    ["INSTALLATION", /\b(?:installerad|installed)\b/u],
    ["DEPLOYMENT", /\b(?:deployed|driftsatt|produktionssatt)\b/u],
    ["RELEASE", /\b(?:released|publicerad|taggad|release\s+(?:skapad(?:es)?|created|published))\b/u],
    ["WORKSPACE", /\bworkspace\s+[a-z0-9_-]+\s+(?:skapad(?:es)?|öppnad(?:es)?|materialiserad(?:es)?|created|opened|materialized)\b/u],
    ["SOURCE", /\bsource\s+\d+\s+(?:skapad(?:es)?|registrerad(?:es)?|materialiserad(?:es)?|created|registered|materialized)\b/u],
    ["FILE", /\b(?:fil(?:en)?|file)\s+(?:skrevs|skriven|skapad(?:es)?|lästes\s+tillbaka|written|created|read\s+back)\b/u],
    ["OWNER_READBACK", /\bowner[- ]readback\s+(?:visar|verifierade|confirmed|shows)\b/u]
  ];
  for (const [type, pattern] of matchers) {
    if (pattern.test(text)) types.add(type);
  }
  return [...types];
}

export function evaluateDecisionClaimReceipts(decision = {}, {
  receipts = [],
  sameTurn = false,
  freshOwnerRead = false
} = {}) {
  const claimText = [
    decision?.completionEvidence,
    ...(Array.isArray(decision?.targetClaims) ? decision.targetClaims : [])
  ].filter(Boolean).join(" ");
  const claimTypes = inferStrongClaimTypes(claimText);
  const available = Array.isArray(receipts) ? receipts : [];
  const results = claimTypes.map((claimType) => {
    const receipt = available.find((item) =>
      String(item?.claimType || "").toUpperCase() === claimType
    ) || null;
    return evaluateClaimReceipt({
      claimType,
      claim: claimText,
      receipt,
      sameTurn: Boolean(receipt?.sameTurn ?? sameTurn),
      freshOwnerRead: Boolean(receipt?.freshOwnerRead ?? freshOwnerRead)
    });
  });
  const hasStrongClaims = claimTypes.length > 0;
  const allowed = hasStrongClaims
    ? results.every((result) => result.allowed)
    : true;
  const verified = hasStrongClaims && allowed && results.every((result) => result.band === "VERIFIED");
  return {
    allowed,
    verified,
    status: !hasStrongClaims
      ? "NO_STRONG_CLAIMS"
      : verified
        ? "VERIFIED"
        : "OWNER_RECEIPT_REQUIRED",
    claimTypes,
    results,
    claimText: sanitizeText(claimText, 4000)
  };
}
