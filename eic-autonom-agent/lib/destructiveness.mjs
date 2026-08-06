import { sanitizeText } from "./common.mjs";

export const DESTRUCTIVENESS_SCALE_VERSION = "EIC_DESTRUCTIVENESS/1";

export const DESTRUCTIVENESS_LADDER = Object.freeze([
  Object.freeze({ level: 1, name: "READ_ONLY", description: "Read, status, list, inspect or reconcile without mutation.", humanDecision: false, hjalmarMentalControl: false }),
  Object.freeze({ level: 2, name: "LOCAL_NAVIGATION", description: "Bounded retry, navigation, refresh or idempotent local no-op.", humanDecision: false, hjalmarMentalControl: false }),
  Object.freeze({ level: 3, name: "LOCAL_RUNTIME_RECOVERY", description: "Reconnect, reload, reinject packaged content or resume a verified marker.", humanDecision: false, hjalmarMentalControl: false }),
  Object.freeze({ level: 4, name: "EPHEMERAL_WORKBENCH", description: "Workspace/Workbench lock, package, temporary state or reversible local materialization.", humanDecision: false, hjalmarMentalControl: false }),
  Object.freeze({ level: 5, name: "BOUNDED_ENGINEERING_CHANGE", description: "Workbench source/package/test/branch candidate work and other reversible engineering effects.", humanDecision: false, hjalmarMentalControl: false }),
  Object.freeze({ level: 6, name: "CORE_ADMIN_LOW", description: "EIC backend core administrative write with exact target and readback; no runtime interruption.", humanDecision: false, hjalmarMentalControl: true }),
  Object.freeze({ level: 7, name: "CORE_RUNTIME_CONTROLLED", description: "Controlled single-service restart/reload or equivalent bounded core runtime effect.", humanDecision: false, hjalmarMentalControl: true }),
  Object.freeze({ level: 8, name: "CORE_HIGH_IMPACT_REVERSIBLE", description: "Core config/schema/migration or multi-component restart with tested rollback and readback.", humanDecision: false, hjalmarMentalControl: true }),
  Object.freeze({ level: 9, name: "CORE_CRITICAL_REVERSIBLE", description: "High-impact production/core administration, merge/release/deploy or permission effect that remains explicitly authorized, bounded and reversible.", humanDecision: false, hjalmarMentalControl: true }),
  Object.freeze({ level: 10, name: "HUMAN_AUTHORITY_REQUIRED", description: "Irreversible/unknown-blast-radius destruction, identity/user-presence, secrets, safety/policy exception or material value decision.", humanDecision: true, hjalmarMentalControl: true })
]);

const LEVEL_10 = [
  /\bUSER[_ -]?PAUSE\b/i,
  /\bCAPTCHA\b/i,
  /\b(LOGIN|LOG[ -]?IN|SIGN[ -]?IN|AUTHENTICATION|IDENTITY VERIFICATION|USER PRESENCE)\b/i,
  /\b(CREDENTIAL|PASSWORD|PRIVATE KEY|ACCESS TOKEN|SECRET)\b/i,
  /\b(PERMANENT(?:LY)? DELETE|DELETE DATA|IRREVERSIBLE|NO ROLLBACK|PURGE ALL|DESTROY WITHOUT|UNKNOWN BLAST RADIUS)\b/i,
  /\b(SECURITY POLICY EXCEPTION|BYPASS SAFETY|BYPASS AUTH|LEGAL ACCEPTANCE|PAYMENT APPROVAL|MEDICAL DECISION|PHYSICAL SAFETY)\b/i,
  /(inloggning|logga\s+in|autentisering|identitetsverifiering|användarnärvaro|lösenord|privat\s+nyckel|åtkomsttoken|hemlighet)/i,
  /(radera\s+permanent|oåterkallelig|utan\s+rollback|okänd\s+spridningsradie|kringgå\s+(?:säkerhet|behörighet)|juridiskt\s+godkännande|betalningsgodkännande)/i
];

const LEVEL_9 = [
  /\b(PRODUCTION DEPLOY|DEPLOY PRODUCTION|PRODUCTION RELEASE|CREATE PRODUCTION RELEASE|RELEASE TO PRODUCTION|RELEASE BUILD|MERGE TO MAIN|MERGE BRANCH|FORCE PUSH|PERMISSION CHANGE|CHANGE(?: [A-Z0-9]+){0,3} PERMISSION|SHARE OR VISIBILITY|ROTATE CREDENTIAL)\b/i,
  /\b(CORE ADMIN(?:ISTRATION)? CRITICAL|CORE SECURITY CONFIG|PRODUCTION MIGRATION)\b/i,
  /(produktionssätt|driftsätt|deploya.{0,40}produktion|release.{0,40}produktion|merge(?:a|ning|auktorisation)?|utför\s+merge|slå\s+ihop.{0,40}(?:main|huvudgren)|force[- ]?push|behörighetsändring|ändra.{0,30}behörighet|dela.{0,30}(?:projekt|synlighet)|rotera.{0,30}(?:credential|token|hemlighet))/i
];

const LEVEL_8 = [
  /\b(SCHEMA MIGRATION|DATABASE MIGRATION|MULTI[- ]SERVICE RESTART|CORE CONFIG(?:URATION)? CHANGE|RUNTIME CONFIG(?:URATION)?)\b/i,
  /(schemamigrering|databasmigrering|migrera.{0,30}(?:schema|databas)|fler(?:tjänst|service).{0,30}omstart|ändra.{0,30}(?:core|kärn).{0,30}konfiguration|runtimekonfiguration)/i
];

const LEVEL_7 = [
  /\b(RESTART|REBOOT|SERVICE RELOAD|RELOAD SERVICE|ROLLING RESTART)\b/i,
  /\b(EIC BACKEND CORE RUNTIME)\b/i,
  /(starta\s+om|omstart|reboot|ladda\s+om.{0,20}(?:tjänst|service)|rullande\s+omstart)/i
];

const LEVEL_6 = [
  /\b(EIC BACKEND CORE|BACKEND CORE|CORE ADMIN|ADMINISTRATIVE WRITE|INFRA CONFIG WRITE)\b/i,
  /\b(ISSUE UPDATE|MILESTONE UPDATE|PROJECT ADMIN)\b/i,
  /(backendkärna|kärnadministration|administrativ\s+skrivning|skriv.{0,30}infrastrukturkonfiguration|uppdatera.{0,20}(?:issue|ärende|milestone|milstolpe)|projektadministration)/i
];

const WORKBENCH = /\b(WORKBENCH|WORKSPACE|WORK PACKAGE|PACKAGE|CANDIDATE BRANCH|TEMP(?:ORARY)? FILE|EPHEMERAL|LOCK|LEASE)\b|(?:arbetsyta|arbetspaket|kandidatgren|temporär\s+fil|tillfällig\s+fil|lås|\blease\b)/i;
const LEVEL_5 = /\b(COMMIT CANDIDATE|BRANCH CANDIDATE|BUILD|PACKAGE BUILD|TEST RUN|PATCH|SOURCE CHANGE)\b|(?:committa|kandidatcommit|bygg|paketera|testkör|patcha|källkodsändring|ändra.{0,20}källkod)/i;
const LEVEL_3 = /\b(RECONNECT|RELOAD TAB|REFRESH TAB|REINJECT|RESUME VERIFIED|AUTO.?DISCARDABLE)\b|(?:återanslut|ladda\s+om\s+flik|uppdatera\s+flik|återinjicera|återuppta\s+verifierat)/i;
const LEVEL_2 = /\b(RETRY|NAVIGATE|REFRESH|RECONCILE|WAIT|POLL)\b|(?:försök\s+igen|navigera|uppdatera|stäm\s+av|vänta|polla)/i;
const LEVEL_1 = /\b(READ|GET|LIST|STATUS|INSPECT|VERIFY|CHECK|QUERY)\b|(?:^|\s)(?:läs|hämta|lista|status|inspektera|verifiera|kontrollera|sök|fråga)(?:\s|$)/i;

export const CLASSIFIER_VERSION = "EIC_DESTRUCTIVENESS/1@0.9.2";

/**
 * v0.7.1 persists the exact fields a level was derived from, so a boundary can be
 * re-classified later without re-deriving it from prose. v0.7.0 stored only the verdict,
 * which made a superseded classification impossible to audit or replay.
 */
function snapshotInput(input = {}) {
  const snapshot = {};
  for (const field of EFFECT_FIELDS) {
    const value = sanitizeText(input[field], 1200);
    if (value) snapshot[field] = value;
  }
  const explicit = Number(input.destructivenessLevel);
  if (Number.isFinite(explicit)) snapshot.destructivenessLevel = Math.max(1, Math.min(10, Math.trunc(explicit)));
  return snapshot;
}

function boundedLevel(value, fallback = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(10, Math.trunc(numeric)));
}

/**
 * Fields that describe a *proposed effect*.
 *
 * v0.7.0 also fed `reason` and `boundaryEvidence` into the level classifier. Those are
 * free-form justification fields, and Gemini Nano routinely echoes the injected target
 * mandate into them. In the field incident 2026-08-03 (run
 * run-b175d216-8fba-4fa8-8b82-2a367fb39b90) the decision's action was the literal string
 * "None", Mjölnar itself returned `destructiveness_level: 6` and `verdict: DELEGABLE`,
 * yet the run hard-blocked at level 10 because the echoed mandate text contains the words
 * "CAPTCHA" and "hemligheter". The classifier was reading untrusted target text as if it
 * described an effect, which is exactly what the Nano core mandate forbids.
 *
 * `pauseOrigin` is retained because it is our own enum, not model or target text.
 * `targetNext` is retained because it genuinely describes the next proposed effect; it is
 * untrusted, but escalating on it is the correct direction.
 */
const EFFECT_FIELDS = Object.freeze([
  "actionCode",
  "proposedAction",
  "requestedAction",
  "exactTarget",
  "expectedEffect",
  "ownerSurface",
  "pauseOrigin",
  "targetNext"
]);

const NON_EFFECT_LITERAL = /^(?:none|null|undefined|n\/a|na|-|—|ingen|inget|tom)$/i;

function effectText(input = {}) {
  return EFFECT_FIELDS
    .map((field) => sanitizeText(input[field], 4000).replace(/[_-]+/g, " "))
    .filter(Boolean)
    .join(" ");
}

/**
 * True when nothing is actually proposed. A decision that performs no action cannot have
 * a destructiveness above read-only, whatever its prose says.
 */
export function hasProposedEffect(input = {}) {
  const action = [input.actionCode, input.proposedAction, input.requestedAction, input.targetNext]
    .map((value) => sanitizeText(value, 4000))
    .find((value) => value && !NON_EFFECT_LITERAL.test(value.trim()));
  return Boolean(action);
}

export function classifyDestructiveness(input = {}) {
  const text = effectText(input);
  const explicit = boundedLevel(input.destructivenessLevel, 0);
  const proposesEffect = hasProposedEffect(input);
  const hasText = Boolean(text);
  const strictUserPause = /^USER[_ -]?PAUSE$/i.test(sanitizeText(input.pauseOrigin, 120));

  // v0.8.0: USER_PAUSE is a trusted local enum and always represents an explicit
  // level-10 operator decision, even before a concrete effect has been selected.
  if (strictUserPause) {
    const rungTen = DESTRUCTIVENESS_LADDER[9];
    return {
      schema: DESTRUCTIVENESS_SCALE_VERSION,
      level: 10,
      name: rungTen.name,
      reasonCode: "LEVEL_10_USER_PAUSE",
      rationale: sanitizeText(input.destructivenessRationale || "USER_PAUSE requires local operator decision.", 1200),
      classified: true,
      humanDecisionRequired: true,
      hjalmarMentalControlRequired: true,
      workbenchCapped: false,
      classifierVersion: CLASSIFIER_VERSION,
      classificationInput: snapshotInput(input)
    };
  }

  // v0.7.1: an actionless decision is read-only by construction. This cap sits above the
  // explicit-level override on purpose: a model-supplied `destructivenessLevel` must not
  // be able to escalate a decision that proposes nothing.
  if (!proposesEffect) {
    const rungOne = DESTRUCTIVENESS_LADDER[0];
    return {
      schema: DESTRUCTIVENESS_SCALE_VERSION,
      level: 1,
      name: rungOne.name,
      reasonCode: hasText ? "NO_PROPOSED_EFFECT" : "EMPTY_READ_ONLY",
      rationale: sanitizeText(input.destructivenessRationale || text, 1200),
      classified: true,
      humanDecisionRequired: false,
      hjalmarMentalControlRequired: false,
      workbenchCapped: false,
      classifierVersion: CLASSIFIER_VERSION,
      classificationInput: snapshotInput(input)
    };
  }

  let level = 6;
  let reasonCode = "UNCLASSIFIED_REQUIRES_CONTROL";
  let classified = false;
  let workbenchClassified = false;

  if (LEVEL_10.some((pattern) => pattern.test(text))) {
    level = 10;
    reasonCode = "LEVEL_10_HUMAN_AUTHORITY";
    classified = true;
  } else if (LEVEL_9.some((pattern) => pattern.test(text))) {
    level = 9;
    reasonCode = "LEVEL_9_CRITICAL_REVERSIBLE";
    classified = true;
  } else if (LEVEL_8.some((pattern) => pattern.test(text))) {
    level = 8;
    reasonCode = "LEVEL_8_HIGH_IMPACT_REVERSIBLE";
    classified = true;
  } else if (LEVEL_7.some((pattern) => pattern.test(text))) {
    level = 7;
    reasonCode = "LEVEL_7_CONTROLLED_RUNTIME";
    classified = true;
  } else if (LEVEL_6.some((pattern) => pattern.test(text))) {
    level = 6;
    reasonCode = "LEVEL_6_CORE_ADMIN";
    classified = true;
  } else if (WORKBENCH.test(text)) {
    level = LEVEL_5.test(text) ? 5 : 4;
    reasonCode = level === 5 ? "LEVEL_5_WORKBENCH_ENGINEERING" : "LEVEL_4_EPHEMERAL_WORKBENCH";
    classified = true;
    workbenchClassified = true;
  } else if (LEVEL_5.test(text)) {
    level = 5;
    reasonCode = "LEVEL_5_BOUNDED_ENGINEERING";
    classified = true;
  } else if (LEVEL_3.test(text)) {
    level = 3;
    reasonCode = "LEVEL_3_LOCAL_RUNTIME_RECOVERY";
    classified = true;
  } else if (LEVEL_2.test(text)) {
    level = 2;
    reasonCode = "LEVEL_2_LOCAL_NAVIGATION";
    classified = true;
  } else if (LEVEL_1.test(text)) {
    level = 1;
    reasonCode = "LEVEL_1_READ_ONLY";
    classified = true;
  }

  if (explicit > 0) {
    if (explicit > level) reasonCode = "EXPLICIT_LEVEL_RAISED";
    level = Math.max(level, explicit);
    classified = true;
  }
  const rung = DESTRUCTIVENESS_LADDER[level - 1];
  return {
    schema: DESTRUCTIVENESS_SCALE_VERSION,
    level,
    name: reasonCode === "UNCLASSIFIED_REQUIRES_CONTROL" ? "UNCLASSIFIED" : rung.name,
    reasonCode,
    // v0.7.1: `reason` is no longer promoted into the rationale either. It is the field
    // Nano echoed the target mandate into, and a rationale is read by an operator who is
    // about to authorize a boundary.
    rationale: sanitizeText(input.destructivenessRationale || text, 1200),
    classified,
    humanDecisionRequired: level === 10,
    hjalmarMentalControlRequired: level > 5,
    workbenchCapped: workbenchClassified && level <= 5,
    classifierVersion: CLASSIFIER_VERSION,
    classificationInput: snapshotInput(input)
  };
}

function known(value) {
  const text = sanitizeText(value, 2000);
  return Boolean(text && !/^UNKNOWN$/i.test(text));
}

export function runHjalmarMentalControl({
  assessment,
  exactTarget,
  ownerRoute,
  mandate,
  rollbackPath,
  readbackPlan,
  materialAmbiguity = "NONE"
} = {}) {
  const level = boundedLevel(assessment?.level, 1);
  if (level === 10) {
    return { required: true, verdict: "HUMAN_REQUIRED", reason: "DESTRUCTIVENESS_LEVEL_10", checks: {} };
  }
  if (level <= 5) {
    return { required: false, verdict: "NOT_REQUIRED", reason: "DESTRUCTIVENESS_LEVEL_1_TO_5", checks: {} };
  }

  const checks = {
    exactTarget: known(exactTarget),
    ownerRoute: known(ownerRoute),
    mandate: known(mandate),
    rollback: known(rollbackPath),
    readback: known(readbackPlan),
    ambiguityBounded: String(materialAmbiguity || "UNKNOWN").toUpperCase() === "NONE"
  };
  const pass = Object.values(checks).every(Boolean);
  return {
    required: true,
    verdict: pass ? "PASS" : "READ_REQUIRED",
    reason: pass ? "HJALMAR_MENTAL_CONTROL_PASS" : "HJALMAR_MENTAL_CONTROL_NEEDS_OWNER_FACTS",
    checks,
    evidenceLimit: "Local deterministic second-control; not an external Hjalmar owner verdict."
  };
}

export function resolveAutonomousPause({
  decision = {},
  targetResult = null,
  assessment,
  control,
  fallbackAction = ""
} = {}) {
  if (assessment?.level === 10 || assessment?.humanDecisionRequired) {
    return { action: "PAUSE", humanRequired: true, reason: "DESTRUCTIVENESS_LEVEL_10", requestedAction: "" };
  }

  const targetNext = sanitizeText(targetResult?.next, 5000);
  const requested = sanitizeText(decision.requestedAction, 5000);
  const alternative = Array.isArray(decision.alternatives)
    ? sanitizeText(decision.alternatives.find(Boolean), 5000)
    : "";
  const base = targetNext || requested || alternative || sanitizeText(fallbackAction, 5000) ||
    "Läs om den exakta owner-statusen och fortsätt med minsta säkra, reversibla nästa steg.";

  if (control?.verdict === "READ_REQUIRED") {
    return {
      action: "CONTINUE",
      humanRequired: false,
      reason: "HJALMAR_MENTAL_CONTROL_READ_REQUIRED",
      requestedAction: `Genomför först en färsk owner-read för exakt mål, mandat, rollback och readback; fortsätt därefter autonomt med: ${base}`
    };
  }

  return {
    action: "CONTINUE",
    humanRequired: false,
    reason: targetResult?.status === "CONTINUE"
      ? "VALID_TARGET_CONTINUE"
      : "MJOLNAR_AUTONOMOUS_PAUSE_CONVERSION",
    requestedAction: base
  };
}
