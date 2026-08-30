import { deepClone, nowIso, sanitizeText } from "./common.mjs";

export const MAIN_TASK_BASELINE_SCHEMA = "eic.main-task-baseline.v3";
const LEGACY_MAIN_TASK_BASELINE_SCHEMAS = new Set(["eic.main-task-baseline.v2", "eic.main-task-baseline.v1"]);
export const MAIN_TASK_PLANE = "MISSION";
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
  "schema", "plane", "mainTask", "success", "current",
  "constraints", "blockers", "contextRefs", "evidenceNeeds"
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
  source,
  observedAt
} = {}) {
  if (!value || typeof value !== "object") return null;
  const mainTask = value.mainTask || {};
  const success = value.success || {};
  const current = value.current || {};
  const normalized = {
    schema: MAIN_TASK_BASELINE_SCHEMA,
    version: 3,
    plane: sanitizeText(value.plane || MAIN_TASK_PLANE, 48).toUpperCase(),
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
    constraints: stringList(value.constraints ?? value.scope?.constraints, 16, 700),
    blockers: stringList(value.blockers, 12, 900),
    contextRefs: stringList(value.contextRefs, 16, 900),
    evidenceNeeds: stringList(value.evidenceNeeds, 12, 700),
    evidenceClass: "ROUTING_CONTEXT",
    source: sanitizeText(source ?? value.source ?? "TARGET_RESPONSE_ROUTING_CONTEXT", 160),
    observedAt: sanitizeText(observedAt ?? value.observedAt, 120) || null
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
  if (sanitizeText(value.plane, 48).toUpperCase() !== MAIN_TASK_PLANE) errors.push("BASELINE_PLANE_MUST_BE_MISSION");
  if (!sanitizeText(value.mainTask?.objective, 1600)) errors.push("BASELINE_OBJECTIVE_REQUIRED");
  if (!sanitizeText(value.mainTask?.programGoal, 1600)) errors.push("BASELINE_PROGRAM_GOAL_REQUIRED");
  if (!(Array.isArray(value.success?.criteria) && value.success.criteria.length) &&
      !sanitizeText(value.success?.doneWhen, 1200)) {
    errors.push("BASELINE_SUCCESS_REQUIRED");
  }
  if (!sanitizeText(value.current?.boundedWorkUnit, 1000)) errors.push("BASELINE_WORK_UNIT_REQUIRED");
  if (!sanitizeText(value.current?.nextHighLeverageAction, 1200)) errors.push("BASELINE_NEXT_ACTION_REQUIRED");
  if (!Array.isArray(value.constraints)) errors.push("BASELINE_CONSTRAINTS_REQUIRED");
  if (!Array.isArray(value.blockers)) errors.push("BASELINE_BLOCKERS_REQUIRED");
  if (!Array.isArray(value.contextRefs)) errors.push("BASELINE_CONTEXT_REFS_REQUIRED");
  if (!Array.isArray(value.evidenceNeeds)) errors.push("BASELINE_EVIDENCE_NEEDS_REQUIRED");
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
    const hasCurrentSchema = candidate.includes(MAIN_TASK_BASELINE_SCHEMA);
    const hasLegacySchema = [...LEGACY_MAIN_TASK_BASELINE_SCHEMAS].some((schema) => candidate.includes(schema));
    if (!hasCurrentSchema && !(options.allowLegacy === true && hasLegacySchema)) continue;
    try {
      const parsed = JSON.parse(candidate);
      const normalized = normalizeMainTaskBaseline(parsed, {
        source: sanitizeText(options.source ?? parsed.source, 160) || "TARGET_RESPONSE_ROUTING_CONTEXT",
        observedAt: sanitizeText(options.observedAt ?? parsed.observedAt, 120) || nowIso()
      });
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
  updatedAt
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
    updatedAt: sanitizeText(updatedAt ?? source.updatedAt, 120) || null
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

export const MAIN_TASK_BASELINE_REQUEST_PROMPT = `HUVUDUPPGIFTSKONTROLL — svara DIREKT I DENNA CHAT med exakt ett JSON-objekt enligt eic.main-task-baseline.v3 och därefter den vanliga EIC-AA/5-trailern. EIC Autonom Agent är redan den aktiva lokala Chrome-extensionruntime som observerar denna session; den är INTE en GPT Action, ett ChatGPT-tool, API eller owner-route som du ska försöka starta eller anropa. Din chattsvarstext är svaret som Agenten läser. Baslinjen är endast routingkontext för Nano. Lägg inte in owner-rutter, skillinventering, 80/20-policy eller readbackbevis här; EIC Core/Backend äger sådan verifiering. current.nextHighLeverageAction ska beskriva första steget EFTER slutförd bootstrap och får inte vara "validera baslinjen", "slutför sessionsinitieringen" eller "anropa Agenten". För en neutral session som bara ska invänta nästa uppgift, använd "Invänta nästa användarinput." Använd tomma listor när inget finns.

{
  "schema": "eic.main-task-baseline.v3",
  "plane": "MISSION",
  "mainTask": {
    "objective": "<användarens grunduppgift>",
    "programGoal": "<det stabila huvudmålet>"
  },
  "success": {
    "criteria": ["<mätbart kriterium>"],
    "doneWhen": "<när programmet verkligen är klart>"
  },
  "current": {
    "boundedWorkUnit": "<minsta aktuella arbetsenhet>",
    "lastMaterialDelta": "<senaste faktiska framsteg eller tomt>",
    "nextHighLeverageAction": "<nästa avgränsade åtgärd>"
  },
  "constraints": ["<styrande begränsning>"],
  "blockers": ["<aktuell blockerare eller tom lista>"],
  "contextRefs": ["<kompakt referens, t.ex. project:2, eller tom lista>"],
  "evidenceNeeds": ["<semantiskt behov som Core får owner-resolvera senare, t.ex. CURRENT_PROJECT_STATUS, eller tom lista>"]
}`;

export function baselineRoutingSummary(value) {
  const baseline = normalizeMainTaskBaseline(value);
  if (!baseline) return null;
  return {
    schema: baseline.schema,
    plane: baseline.plane,
    mainTask: deepClone(baseline.mainTask),
    success: deepClone(baseline.success),
    current: deepClone(baseline.current),
    constraints: [...baseline.constraints],
    blockers: [...baseline.blockers],
    contextRefs: [...baseline.contextRefs],
    evidenceNeeds: [...baseline.evidenceNeeds],
    evidenceClass: baseline.evidenceClass,
    observedAt: baseline.observedAt
  };
}
