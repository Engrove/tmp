import { deepClone, nowIso, sanitizeText } from "./common.mjs";

export const MAIN_TASK_BASELINE_SCHEMA = "eic.main-task-baseline.v1";
export const MAIN_TASK_TRACK_SCHEMA = "eic.main-task-track.v1";

export const MAIN_TASK_TRACK_STATUS = Object.freeze({
  BASELINE_REQUESTED: "BASELINE_REQUESTED",
  ON_TRACK: "ON_TRACK",
  JUSTIFIED_DETOUR: "JUSTIFIED_DETOUR",
  DRIFT: "DRIFT",
  INSUFFICIENT_CONTEXT: "INSUFFICIENT_CONTEXT"
});

export const MAIN_TASK_RELATION = Object.freeze({
  DIRECT: "DIRECT",
  REQUIRED_DETOUR: "REQUIRED_DETOUR",
  UNRELATED: "UNRELATED",
  UNKNOWN: "UNKNOWN"
});

export const EIGHTY_TWENTY_VERDICT = Object.freeze({
  HIGH_LEVERAGE: "HIGH_LEVERAGE",
  NECESSARY_ENABLER: "NECESSARY_ENABLER",
  LOW_LEVERAGE: "LOW_LEVERAGE",
  UNKNOWN: "UNKNOWN"
});

const REQUIRED_BASELINE_KEYS = Object.freeze([
  "schema", "mainTask", "success", "current", "scope", "owners",
  "blockers", "eightyTwenty", "globalSkills", "detourPolicy", "evidence"
]);

function stringList(value, maxItems = 12, maxLength = 800) {
  return (Array.isArray(value) ? value : [])
    .map((item) => sanitizeText(typeof item === "string" ? item : item?.text || item?.name || item?.code, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function skillList(value, maxItems = 16) {
  return (Array.isArray(value) ? value : []).map((item) => {
    if (typeof item === "string") return { code: sanitizeText(item, 160), reason: "", payloadHash: "" };
    return {
      code: sanitizeText(item?.code || item?.name, 160),
      reason: sanitizeText(item?.reason || item?.why, 600),
      payloadHash: sanitizeText(item?.payloadHash || item?.payload_hash, 160)
    };
  }).filter((item) => item.code).slice(0, maxItems);
}

function ownerList(value, maxItems = 16) {
  return (Array.isArray(value) ? value : []).map((item) => {
    if (typeof item === "string") return { claim: "", surface: "", locator: sanitizeText(item, 800) };
    return {
      claim: sanitizeText(item?.claim, 600),
      surface: sanitizeText(item?.surface || item?.ownerSurface, 240),
      locator: sanitizeText(item?.locator || item?.id, 800)
    };
  }).filter((item) => item.claim || item.surface || item.locator).slice(0, maxItems);
}

export function createEmptyMainTaskTrack() {
  return {
    schema: MAIN_TASK_TRACK_SCHEMA,
    version: 1,
    status: MAIN_TASK_TRACK_STATUS.INSUFFICIENT_CONTEXT,
    baselinePresent: false,
    currentActionRelation: MAIN_TASK_RELATION.UNKNOWN,
    eightyTwentyVerdict: EIGHTY_TWENTY_VERDICT.UNKNOWN,
    activeGlobalSkills: [],
    requiredGlobalSkills: [],
    skillGaps: [],
    detourReason: "",
    returnCondition: "",
    correctionPrompt: "",
    updatedAt: null
  };
}

export function normalizeMainTaskBaseline(value, {
  source = "TARGET_RESPONSE_ROUTING_CONTEXT",
  observedAt = nowIso()
} = {}) {
  if (!value || typeof value !== "object") return null;
  const mainTask = value.mainTask || {};
  const success = value.success || {};
  const current = value.current || {};
  const scope = value.scope || {};
  const eightyTwenty = value.eightyTwenty || {};
  const globalSkills = value.globalSkills || {};
  const detourPolicy = value.detourPolicy || {};
  const evidence = value.evidence || {};
  const normalized = {
    schema: MAIN_TASK_BASELINE_SCHEMA,
    version: 1,
    mainTask: {
      title: sanitizeText(mainTask.title, 500),
      objective: sanitizeText(mainTask.objective, 1600),
      programGoal: sanitizeText(mainTask.programGoal, 1600)
    },
    success: {
      criteria: stringList(success.criteria, 12, 900),
      doneWhen: sanitizeText(success.doneWhen, 1200)
    },
    current: {
      activeMilestone: sanitizeText(current.activeMilestone, 800),
      boundedWorkUnit: sanitizeText(current.boundedWorkUnit, 1000),
      lastMaterialDelta: sanitizeText(current.lastMaterialDelta, 1200),
      nextHighLeverageAction: sanitizeText(current.nextHighLeverageAction, 1200)
    },
    scope: {
      inScope: stringList(scope.inScope, 16, 700),
      outOfScope: stringList(scope.outOfScope, 16, 700),
      constraints: stringList(scope.constraints, 16, 700)
    },
    owners: ownerList(value.owners),
    blockers: stringList(value.blockers, 12, 900),
    eightyTwenty: {
      vitalFew: stringList(eightyTwenty.vitalFew, 8, 800),
      deferredMany: stringList(eightyTwenty.deferredMany, 12, 800),
      rationale: sanitizeText(eightyTwenty.rationale, 1000)
    },
    globalSkills: {
      active: skillList(globalSkills.active),
      required: skillList(globalSkills.required),
      gaps: skillList(globalSkills.gaps)
    },
    detourPolicy: {
      allowedReasons: stringList(detourPolicy.allowedReasons, 8, 500),
      returnCondition: sanitizeText(detourPolicy.returnCondition, 1000),
      maxDetourTurns: Math.max(0, Math.min(20, Number(detourPolicy.maxDetourTurns || 0)))
    },
    evidence: {
      locators: stringList(evidence.locators, 16, 900),
      asOf: sanitizeText(evidence.asOf, 120)
    },
    evidenceClass: "ROUTING_CONTEXT",
    source: sanitizeText(source, 160),
    observedAt: sanitizeText(observedAt, 120) || nowIso()
  };
  return validateMainTaskBaseline(normalized).valid ? normalized : null;
}

export function validateMainTaskBaseline(value) {
  const errors = [];
  if (!value || typeof value !== "object") return { valid: false, errors: ["BASELINE_NOT_OBJECT"] };
  for (const key of REQUIRED_BASELINE_KEYS) {
    if (!(key in value)) errors.push(`BASELINE_MISSING_${key.toUpperCase()}`);
  }
  if (value.schema !== MAIN_TASK_BASELINE_SCHEMA) errors.push("BASELINE_SCHEMA_INVALID");
  if (!sanitizeText(value.mainTask?.objective, 1600)) errors.push("BASELINE_OBJECTIVE_REQUIRED");
  if (!sanitizeText(value.mainTask?.programGoal, 1600)) errors.push("BASELINE_PROGRAM_GOAL_REQUIRED");
  if (!(Array.isArray(value.success?.criteria) && value.success.criteria.length) &&
      !sanitizeText(value.success?.doneWhen, 1200)) {
    errors.push("BASELINE_SUCCESS_REQUIRED");
  }
  if (!sanitizeText(value.current?.activeMilestone, 800)) errors.push("BASELINE_MILESTONE_REQUIRED");
  if (!sanitizeText(value.current?.boundedWorkUnit, 1000)) errors.push("BASELINE_WORK_UNIT_REQUIRED");
  if (!sanitizeText(value.current?.nextHighLeverageAction, 1200)) errors.push("BASELINE_NEXT_ACTION_REQUIRED");
  if (!Array.isArray(value.owners)) errors.push("BASELINE_OWNERS_REQUIRED");
  if (!Array.isArray(value.blockers)) errors.push("BASELINE_BLOCKERS_REQUIRED");
  if (!Array.isArray(value.eightyTwenty?.vitalFew) || !value.eightyTwenty.vitalFew.length) {
    errors.push("BASELINE_80_20_VITAL_FEW_REQUIRED");
  }
  if (!Array.isArray(value.globalSkills?.active) ||
      !Array.isArray(value.globalSkills?.required) ||
      !Array.isArray(value.globalSkills?.gaps)) {
    errors.push("BASELINE_GLOBAL_SKILLS_REQUIRED");
  }
  if (!sanitizeText(value.detourPolicy?.returnCondition, 1000)) {
    errors.push("BASELINE_DETOUR_RETURN_CONDITION_REQUIRED");
  }
  if (!Array.isArray(value.evidence?.locators)) errors.push("BASELINE_EVIDENCE_LOCATORS_REQUIRED");
  return { valid: errors.length === 0, errors };
}

function balancedObjects(text) {
  const source = String(text || "");
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(source.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return objects;
}

export function parseMainTaskBaseline(text, options = {}) {
  for (const candidate of balancedObjects(text)) {
    if (!candidate.includes(MAIN_TASK_BASELINE_SCHEMA)) continue;
    try {
      const parsed = JSON.parse(candidate);
      const normalized = normalizeMainTaskBaseline(parsed, options);
      if (normalized) return { valid: true, baseline: normalized, errors: [] };
      const rawValidation = validateMainTaskBaseline(parsed);
      return { valid: false, baseline: null, errors: rawValidation.errors };
    } catch {
      // Continue to a later balanced object when present.
    }
  }
  return { valid: false, baseline: null, errors: ["MAIN_TASK_BASELINE_NOT_FOUND"] };
}

export function normalizeTrackControl(value, {
  baselinePresent = false,
  updatedAt = nowIso()
} = {}) {
  const base = createEmptyMainTaskTrack();
  const source = value && typeof value === "object" ? value : {};
  const status = Object.values(MAIN_TASK_TRACK_STATUS).includes(source.status)
    ? source.status
    : baselinePresent ? MAIN_TASK_TRACK_STATUS.INSUFFICIENT_CONTEXT : MAIN_TASK_TRACK_STATUS.BASELINE_REQUESTED;
  return {
    ...base,
    status,
    baselinePresent: Boolean(source.baselinePresent ?? baselinePresent),
    currentActionRelation: Object.values(MAIN_TASK_RELATION).includes(source.currentActionRelation)
      ? source.currentActionRelation
      : MAIN_TASK_RELATION.UNKNOWN,
    eightyTwentyVerdict: Object.values(EIGHTY_TWENTY_VERDICT).includes(source.eightyTwentyVerdict)
      ? source.eightyTwentyVerdict
      : EIGHTY_TWENTY_VERDICT.UNKNOWN,
    activeGlobalSkills: skillList(source.activeGlobalSkills),
    requiredGlobalSkills: skillList(source.requiredGlobalSkills),
    skillGaps: skillList(source.skillGaps),
    detourReason: sanitizeText(source.detourReason, 1000),
    returnCondition: sanitizeText(source.returnCondition, 1000),
    correctionPrompt: sanitizeText(source.correctionPrompt, 2400),
    updatedAt: sanitizeText(updatedAt || source.updatedAt, 120) || null
  };
}

export function validateTrackControl(value, { baselinePresent = false } = {}) {
  const track = normalizeTrackControl(value, { baselinePresent });
  const errors = [];
  if (!baselinePresent) {
    if (track.status !== MAIN_TASK_TRACK_STATUS.BASELINE_REQUESTED) {
      errors.push("TRACK_BASELINE_REQUEST_REQUIRED");
    }
    if (track.baselinePresent) errors.push("TRACK_BASELINE_PRESENT_FALSE_REQUIRED");
    if (!track.correctionPrompt.includes(MAIN_TASK_BASELINE_SCHEMA)) {
      errors.push("TRACK_BASELINE_REQUEST_PROMPT_REQUIRED");
    }
  } else {
    if (track.status === MAIN_TASK_TRACK_STATUS.BASELINE_REQUESTED) {
      errors.push("TRACK_BASELINE_ALREADY_PRESENT");
    }
    if (!track.baselinePresent) errors.push("TRACK_BASELINE_PRESENT_TRUE_REQUIRED");
    if (track.status === MAIN_TASK_TRACK_STATUS.JUSTIFIED_DETOUR) {
      if (track.currentActionRelation !== MAIN_TASK_RELATION.REQUIRED_DETOUR) {
        errors.push("TRACK_DETOUR_RELATION_REQUIRED");
      }
      if (!track.detourReason) errors.push("TRACK_DETOUR_REASON_REQUIRED");
      if (!track.returnCondition) errors.push("TRACK_DETOUR_RETURN_CONDITION_REQUIRED");
      if (![EIGHTY_TWENTY_VERDICT.NECESSARY_ENABLER, EIGHTY_TWENTY_VERDICT.HIGH_LEVERAGE]
        .includes(track.eightyTwentyVerdict)) {
        errors.push("TRACK_DETOUR_80_20_JUSTIFICATION_REQUIRED");
      }
    }
    if (track.status === MAIN_TASK_TRACK_STATUS.DRIFT && !track.correctionPrompt) {
      errors.push("TRACK_DRIFT_CORRECTION_REQUIRED");
    }
  }
  return { valid: errors.length === 0, errors, track };
}

export const MAIN_TASK_BASELINE_REQUEST_PROMPT = `HUVUDUPPGIFTSKONTROLL — svara med exakt ett JSON-objekt och därefter den vanliga EIC-AA/5-trailern. Utelämna ingen nyckel och använd tomma listor när inget finns. Aktiva och nödvändiga global skills ska hämtas från EIC:s live global.get/global.skill.payload.get; skilluppgifter är routingkontext, inte owner-bevis.

{
  "schema": "eic.main-task-baseline.v1",
  "mainTask": {
    "title": "<kort namn>",
    "objective": "<användarens grunduppgift>",
    "programGoal": "<det stabila huvudmålet>"
  },
  "success": {
    "criteria": ["<mätbart kriterium>"],
    "doneWhen": "<när programmet verkligen är klart>"
  },
  "current": {
    "activeMilestone": "<aktiv milstolpe>",
    "boundedWorkUnit": "<minsta aktuella arbetsenhet>",
    "lastMaterialDelta": "<senaste faktiska framsteg>",
    "nextHighLeverageAction": "<nästa åtgärd med högst nytta>"
  },
  "scope": {
    "inScope": ["<ingår>"],
    "outOfScope": ["<ingår inte>"],
    "constraints": ["<styrande begränsning>"]
  },
  "owners": [
    {"claim": "<vad som måste verifieras>", "surface": "<ägarrutt>", "locator": "<exakt id/ref eller tomt>"}
  ],
  "blockers": ["<aktuell blockerare eller tom lista>"],
  "eightyTwenty": {
    "vitalFew": ["<20 % som ger cirka 80 % av nyttan>"],
    "deferredMany": ["<lågvärdesarbete som skjuts upp>"],
    "rationale": "<varför prioriteringen håller EIC på spåret>"
  },
  "globalSkills": {
    "active": [{"code": "<aktiv skill>", "payloadHash": "<hash eller tomt>", "reason": "<hur den styr arbetet>"}],
    "required": [{"code": "<skill som borde följas>", "payloadHash": "<hash eller tomt>", "reason": "<varför>"}],
    "gaps": [{"code": "<saknad/stale skill>", "payloadHash": "", "reason": "<konkret gap>"}]
  },
  "detourPolicy": {
    "allowedReasons": ["OWNER_DEPENDENCY", "SAFETY_BOUNDARY", "BLOCKER_REMOVAL", "REQUIRED_VALIDATION"],
    "returnCondition": "<exakt villkor för återgång till huvudspåret>",
    "maxDetourTurns": 2
  },
  "evidence": {
    "locators": ["<projekt/update/artifact/repo/runtime-id som faktiskt lästs>"],
    "asOf": "<ISO-tid för owner-läsningarna>"
  }
}`;

export function baselineRoutingSummary(value) {
  const baseline = normalizeMainTaskBaseline(value);
  if (!baseline) return null;
  return {
    schema: baseline.schema,
    mainTask: deepClone(baseline.mainTask),
    success: deepClone(baseline.success),
    current: deepClone(baseline.current),
    scope: deepClone(baseline.scope),
    owners: deepClone(baseline.owners),
    blockers: [...baseline.blockers],
    eightyTwenty: deepClone(baseline.eightyTwenty),
    globalSkills: deepClone(baseline.globalSkills),
    detourPolicy: deepClone(baseline.detourPolicy),
    evidence: deepClone(baseline.evidence),
    evidenceClass: baseline.evidenceClass,
    observedAt: baseline.observedAt
  };
}
