import { sanitizeText } from "./common.mjs";
import { normalizeMainTaskBaseline, validateMainTaskBaseline } from "./main-task-guard.mjs";
import {
  AUTONOM_AGENT_LOCAL_SESSION_STATE,
  LOCAL_AGENT_OWNER_RESOLUTION
} from "./session-init-control.mjs";

export const BASELINE_ANALYSIS_SCHEMA_ID = "eic.nano.baseline-analysis.v2";
export const BASELINE_ANALYSIS_MAX_OUTPUT_CHARS = 6_500;
export const BASELINE_ANALYSIS_RECOVERY_MAX_OUTPUT_CHARS = 10_000;
export const BASELINE_ANALYSIS_RAW_CHUNK_SAFETY_CAP = 12_000;
export const BASELINE_ANALYSIS_DEADLINE_MS = 180_000;

export const BASELINE_ANALYSIS_RESPONSE_SCHEMA = {
  type: "object",
  required: [
    "schema", "verdict", "reason", "violations",
    "correctionPrompt", "normalizedBaselineAccepted"
  ],
  properties: {
    schema: { type: "string", enum: [BASELINE_ANALYSIS_SCHEMA_ID] },
    verdict: { type: "string", enum: ["ACCEPT", "DRIFT", "INSUFFICIENT_CONTEXT"] },
    reason: { type: "string", minLength: 1, maxLength: 900 },
    violations: {
      type: "array",
      maxItems: 8,
      items: { type: "string", maxLength: 260 }
    },
    correctionPrompt: { type: "string", maxLength: 2_400 },
    normalizedBaselineAccepted: { type: "boolean" }
  }
};

const RECOVERED_MAIN_TASK_BASELINE_SCHEMA = {
  type: "object",
  required: [
    "schema", "mainTask", "success", "current",
    "constraints", "blockers", "contextRefs", "evidenceNeeds"
  ],
  properties: {
    schema: { type: "string", enum: ["eic.main-task-baseline.v3"] },
    mainTask: {
      type: "object",
      required: ["objective", "programGoal"],
      properties: {
        objective: { type: "string", minLength: 1, maxLength: 1_600 },
        programGoal: { type: "string", minLength: 1, maxLength: 1_600 }
      }
    },
    success: {
      type: "object",
      required: ["criteria", "doneWhen"],
      properties: {
        criteria: { type: "array", maxItems: 12, items: { type: "string", maxLength: 900 } },
        doneWhen: { type: "string", maxLength: 1_200 }
      }
    },
    current: {
      type: "object",
      required: ["boundedWorkUnit", "lastMaterialDelta", "nextHighLeverageAction"],
      properties: {
        boundedWorkUnit: { type: "string", minLength: 1, maxLength: 1_000 },
        lastMaterialDelta: { type: "string", maxLength: 1_200 },
        nextHighLeverageAction: { type: "string", minLength: 1, maxLength: 1_200 }
      }
    },
    constraints: { type: "array", maxItems: 16, items: { type: "string", maxLength: 700 } },
    blockers: { type: "array", maxItems: 12, items: { type: "string", maxLength: 900 } },
    contextRefs: { type: "array", maxItems: 16, items: { type: "string", maxLength: 900 } },
    evidenceNeeds: { type: "array", maxItems: 12, items: { type: "string", maxLength: 700 } }
  }
};

export const BASELINE_ANALYSIS_RECOVERY_RESPONSE_SCHEMA = {
  ...BASELINE_ANALYSIS_RESPONSE_SCHEMA,
  required: [...BASELINE_ANALYSIS_RESPONSE_SCHEMA.required, "normalizedBaseline"],
  properties: {
    ...BASELINE_ANALYSIS_RESPONSE_SCHEMA.properties,
    normalizedBaseline: RECOVERED_MAIN_TASK_BASELINE_SCHEMA
  }
};

function maxStringChars(schema = {}) {
  return Math.max(0, Number(schema?.maxLength || 0));
}

export function estimateJsonSchemaMaxChars(schema = BASELINE_ANALYSIS_RESPONSE_SCHEMA) {
  if (!schema || typeof schema !== "object") return 0;
  if (schema.type === "string") return maxStringChars(schema) + 2;
  if (schema.type === "boolean") return 5;
  if (schema.type === "integer" || schema.type === "number") return 24;
  if (schema.type === "array") {
    const count = Math.max(0, Number(schema.maxItems || 0));
    const item = estimateJsonSchemaMaxChars(schema.items || {});
    return 2 + count * item + Math.max(0, count - 1);
  }
  if (schema.type === "object") {
    const entries = Object.entries(schema.properties || {});
    let total = 2;
    entries.forEach(([key, child], index) => {
      total += JSON.stringify(key).length + 1 + estimateJsonSchemaMaxChars(child);
      if (index < entries.length - 1) total += 1;
    });
    return total;
  }
  return 0;
}

export const BASELINE_ANALYSIS_SCHEMA_MAX_CHARS =
  estimateJsonSchemaMaxChars(BASELINE_ANALYSIS_RESPONSE_SCHEMA);

function compactText(value, maxLength) {
  const limit = Math.max(0, Number(maxLength || 0));
  if (limit === 0) return "";
  const source = sanitizeText(value, Math.max(limit * 2, limit));
  if (source.length <= limit) return source;
  const marker = "\n...[TRUNCATED]...\n";
  const available = Math.max(0, limit - marker.length);
  const head = Math.floor(available * 0.55);
  return `${source.slice(0, head)}${marker}${source.slice(-(available - head))}`;
}

const BASELINE_PROJECTION_PROFILES = Object.freeze([
  Object.freeze({
    strategy: "BASELINE_SEMANTIC_BALANCED",
    mainTask: [1_600, 1_600],
    success: [12, 900, 1_200],
    current: [1_000, 1_200, 1_200],
    lists: [16, 900],
    responseExcerpt: 900
  }),
  Object.freeze({
    strategy: "BASELINE_SEMANTIC_REDUCED",
    mainTask: [420, 420],
    success: [4, 260, 320],
    current: [320, 300, 340],
    lists: [5, 220],
    responseExcerpt: 300
  }),
  Object.freeze({
    strategy: "BASELINE_SEMANTIC_ESSENTIAL",
    mainTask: [260, 260],
    success: [2, 170, 200],
    current: [210, 190, 220],
    lists: [3, 130],
    responseExcerpt: 0
  }),
  Object.freeze({
    strategy: "BASELINE_SEMANTIC_MICRO",
    mainTask: [130, 130],
    success: [1, 90, 100],
    current: [100, 90, 110],
    lists: [1, 70],
    responseExcerpt: 0
  })
]);

const BASELINE_PROJECTION_STRATEGIES = new Set([
  ...BASELINE_PROJECTION_PROFILES.map((profile) => profile.strategy),
  "BASELINE_SEMANTIC_LOSSLESS",
  "BASELINE_SEMANTIC_MINIMUM"
]);

const BASELINE_DECISION_COLLECTION_PATHS = Object.freeze([
  "success.criteria",
  "constraints",
  "blockers",
  "contextRefs",
  "evidenceNeeds"
]);

const BASELINE_DECISION_SCALAR_PATHS = Object.freeze([
  "mainTask.objective",
  "mainTask.programGoal",
  "success.doneWhen",
  "current.boundedWorkUnit",
  "current.lastMaterialDelta",
  "current.nextHighLeverageAction"
]);

export const BASELINE_PROJECTION_COVERAGE_SCHEMA_ID =
  "eic.nano.baseline-projection-coverage.v3";
const BASELINE_COVERAGE_MAX_ITEM_COUNT = 1_024;
const BASELINE_COVERAGE_MAX_CHAR_COUNT = 1_000_000;

const BASELINE_LOSSLESS_PROFILE = Object.freeze({
  strategy: "BASELINE_SEMANTIC_LOSSLESS",
  mainTask: [BASELINE_COVERAGE_MAX_CHAR_COUNT, BASELINE_COVERAGE_MAX_CHAR_COUNT],
  success: [
    BASELINE_COVERAGE_MAX_ITEM_COUNT,
    BASELINE_COVERAGE_MAX_CHAR_COUNT,
    BASELINE_COVERAGE_MAX_CHAR_COUNT
  ],
  current: [
    BASELINE_COVERAGE_MAX_CHAR_COUNT,
    BASELINE_COVERAGE_MAX_CHAR_COUNT,
    BASELINE_COVERAGE_MAX_CHAR_COUNT
  ],
  lists: [BASELINE_COVERAGE_MAX_ITEM_COUNT, BASELINE_COVERAGE_MAX_CHAR_COUNT],
  responseExcerpt: 0
});

function compactArray(value, count, maxLength) {
  return (Array.isArray(value) ? value : [])
    .slice(0, Math.max(0, count))
    .map((item) => sanitizeText(item, maxLength))
    .filter(Boolean);
}

function compactBaseline(value = null, profile = BASELINE_PROJECTION_PROFILES[0]) {
  if (!value || typeof value !== "object") return null;
  return {
    schema: "eic.main-task-baseline.v3",
    mainTask: {
      objective: sanitizeText(value.mainTask?.objective, profile.mainTask[0]),
      programGoal: sanitizeText(value.mainTask?.programGoal, profile.mainTask[1])
    },
    success: {
      criteria: compactArray(value.success?.criteria, profile.success[0], profile.success[1]),
      doneWhen: sanitizeText(value.success?.doneWhen, profile.success[2])
    },
    current: {
      boundedWorkUnit: sanitizeText(value.current?.boundedWorkUnit, profile.current[0]),
      lastMaterialDelta: sanitizeText(value.current?.lastMaterialDelta, profile.current[1]),
      nextHighLeverageAction: sanitizeText(value.current?.nextHighLeverageAction, profile.current[2])
    },
    constraints: compactArray(value.constraints, profile.lists[0], profile.lists[1]),
    blockers: compactArray(value.blockers, profile.lists[0], profile.lists[1]),
    contextRefs: compactArray(value.contextRefs, profile.lists[0], profile.lists[1]),
    evidenceNeeds: compactArray(value.evidenceNeeds, profile.lists[0], profile.lists[1])
  };
}

function minimumBaselineProjection(value = null) {
  if (!value || typeof value !== "object") return null;
  return {
    schema: "eic.main-task-baseline.v3",
    mainTask: { objective: "", programGoal: "" },
    success: { criteria: [], doneWhen: "" },
    current: {
      boundedWorkUnit: "",
      lastMaterialDelta: "",
      nextHighLeverageAction: ""
    },
    constraints: [],
    blockers: [],
    contextRefs: [],
    evidenceNeeds: []
  };
}

function baselineProjectionForStrategy(value, strategy) {
  const profile = BASELINE_PROJECTION_PROFILES.find((item) => item.strategy === strategy);
  if (profile) return compactBaseline(value, profile);
  if (strategy === BASELINE_LOSSLESS_PROFILE.strategy) {
    return compactBaseline(value, BASELINE_LOSSLESS_PROFILE);
  }
  if (strategy === "BASELINE_SEMANTIC_MINIMUM") return minimumBaselineProjection(value);
  return null;
}

function valueAtPath(value, path) {
  return String(path || "").split(".").reduce((current, key) => current?.[key], value);
}

function fullText(value) {
  return sanitizeText(value, 1_000_000);
}

function collectionCoverage(path, original, represented) {
  const source = Array.isArray(original) ? original : [];
  const projected = Array.isArray(represented) ? represented : [];
  const representedCount = Math.min(source.length, projected.length);
  let truncatedItemCount = 0;
  for (let index = 0; index < representedCount; index += 1) {
    if (fullText(source[index]) !== fullText(projected[index])) truncatedItemCount += 1;
  }
  const omittedItemCount = Math.max(0, source.length - projected.length);
  return {
    originalItemCount: source.length,
    representedItemCount: projected.length,
    omittedItemCount,
    truncatedItemCount,
    complete: omittedItemCount === 0 && truncatedItemCount === 0
  };
}

function scalarCoverage(path, original, represented) {
  const source = fullText(valueAtPath(original, path));
  const projected = fullText(valueAtPath(represented, path));
  const reduced = source !== projected;
  return {
    originalCharCount: source.length,
    representedCharCount: projected.length,
    reduced,
    complete: !reduced
  };
}

function assessBaselineSemanticCoverage(original, represented, strategy) {
  const source = original && typeof original === "object" ? original : {};
  const projected = represented && typeof represented === "object" ? represented : {};
  const collections = {};
  const scalars = {};
  const reducedSections = new Set();
  const omittedSections = new Set();
  for (const path of BASELINE_DECISION_COLLECTION_PATHS) {
    const item = collectionCoverage(path, valueAtPath(source, path), valueAtPath(projected, path));
    collections[path] = item;
    if (!item.complete) reducedSections.add(path);
    if (item.omittedItemCount > 0) omittedSections.add(path);
  }
  for (const path of BASELINE_DECISION_SCALAR_PATHS) {
    const item = scalarCoverage(path, source, projected);
    scalars[path] = item;
    if (!item.complete) reducedSections.add(path);
  }
  return {
    schema: BASELINE_PROJECTION_COVERAGE_SCHEMA_ID,
    strategy: sanitizeText(strategy, 60),
    complete: reducedSections.size === 0,
    collections,
    scalars,
    reducedSections: [...reducedSections],
    omittedSections: [...omittedSections]
  };
}

function boundedCoverageInteger(value, maxValue) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= maxValue
    ? value
    : null;
}

function normalizeCoveragePathList(value, {
  label,
  maxItems,
  errors
}) {
  if (!Array.isArray(value)) {
    errors.push(`BASELINE_PROJECTION_COVERAGE_${label}_REQUIRED`);
    return [];
  }
  const result = [];
  const seen = new Set();
  for (const item of value.slice(0, maxItems + 1)) {
    const path = sanitizeText(item, 80);
    if (!path) {
      errors.push(`BASELINE_PROJECTION_COVERAGE_${label}_INVALID`);
      continue;
    }
    if (seen.has(path)) {
      errors.push(`BASELINE_PROJECTION_COVERAGE_${label}_DUPLICATE:${path}`);
      continue;
    }
    seen.add(path);
    result.push(path);
  }
  if (value.length > maxItems) {
    errors.push(`BASELINE_PROJECTION_COVERAGE_${label}_TOO_LARGE`);
  }
  return result.slice(0, maxItems);
}

function samePathSet(left, right) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

function normalizeCoverageInternal(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { coverage: null, errors: ["BASELINE_PROJECTION_COVERAGE_REQUIRED"] };
  }

  const errors = [];
  const schema = sanitizeText(value.schema, 80);
  if (schema !== BASELINE_PROJECTION_COVERAGE_SCHEMA_ID) {
    errors.push("BASELINE_PROJECTION_COVERAGE_SCHEMA_INVALID");
  }

  const strategy = sanitizeText(value.strategy, 60);
  if (!strategy) {
    errors.push("BASELINE_PROJECTION_COVERAGE_STRATEGY_REQUIRED");
  } else if (!BASELINE_PROJECTION_STRATEGIES.has(strategy)) {
    errors.push("BASELINE_PROJECTION_COVERAGE_STRATEGY_INVALID");
  }

  const sourceCollections = value.collections && typeof value.collections === "object" &&
    !Array.isArray(value.collections)
    ? value.collections
    : null;
  if (!sourceCollections) {
    errors.push("BASELINE_PROJECTION_COVERAGE_COLLECTIONS_REQUIRED");
  }

  const collections = {};
  const derivedReducedSections = new Set();
  const derivedOmittedSections = new Set();
  for (const path of BASELINE_DECISION_COLLECTION_PATHS) {
    const item = sourceCollections?.[path];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`BASELINE_PROJECTION_COVERAGE_COLLECTION_REQUIRED:${path}`);
      continue;
    }
    const originalItemCount = boundedCoverageInteger(item.originalItemCount, BASELINE_COVERAGE_MAX_ITEM_COUNT);
    const representedItemCount = boundedCoverageInteger(item.representedItemCount, BASELINE_COVERAGE_MAX_ITEM_COUNT);
    const omittedItemCount = boundedCoverageInteger(item.omittedItemCount, BASELINE_COVERAGE_MAX_ITEM_COUNT);
    const truncatedItemCount = boundedCoverageInteger(item.truncatedItemCount, BASELINE_COVERAGE_MAX_ITEM_COUNT);
    if (
      originalItemCount === null ||
      representedItemCount === null ||
      omittedItemCount === null ||
      truncatedItemCount === null
    ) {
      errors.push(`BASELINE_PROJECTION_COVERAGE_COLLECTION_COUNTS_INVALID:${path}`);
      collections[path] = {
        originalItemCount,
        representedItemCount,
        omittedItemCount,
        truncatedItemCount,
        complete: false
      };
      derivedReducedSections.add(path);
      continue;
    }
    const countsConsistent =
      representedItemCount <= originalItemCount &&
      representedItemCount + omittedItemCount === originalItemCount &&
      truncatedItemCount <= representedItemCount;
    if (!countsConsistent) {
      errors.push(`BASELINE_PROJECTION_COVERAGE_COLLECTION_COUNTS_INCONSISTENT:${path}`);
    }
    if (typeof item.complete !== "boolean") {
      errors.push(`BASELINE_PROJECTION_COVERAGE_COLLECTION_COMPLETE_REQUIRED:${path}`);
    }
    const derivedComplete = countsConsistent &&
      omittedItemCount === 0 &&
      truncatedItemCount === 0 &&
      representedItemCount === originalItemCount;
    if (typeof item.complete === "boolean" && item.complete !== derivedComplete) {
      errors.push(`BASELINE_PROJECTION_COVERAGE_COLLECTION_COMPLETE_MISMATCH:${path}`);
    }
    const complete = derivedComplete && item.complete === true;
    collections[path] = {
      originalItemCount,
      representedItemCount,
      omittedItemCount,
      truncatedItemCount,
      complete
    };
    if (!complete) derivedReducedSections.add(path);
    if (omittedItemCount > 0) derivedOmittedSections.add(path);
  }

  const sourceScalars = value.scalars && typeof value.scalars === "object" &&
    !Array.isArray(value.scalars)
    ? value.scalars
    : null;
  if (!sourceScalars) {
    errors.push("BASELINE_PROJECTION_COVERAGE_SCALARS_REQUIRED");
  }

  const scalars = {};
  for (const path of BASELINE_DECISION_SCALAR_PATHS) {
    const item = sourceScalars?.[path];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`BASELINE_PROJECTION_COVERAGE_SCALAR_REQUIRED:${path}`);
      continue;
    }
    const originalCharCount = boundedCoverageInteger(item.originalCharCount, BASELINE_COVERAGE_MAX_CHAR_COUNT);
    const representedCharCount = boundedCoverageInteger(item.representedCharCount, BASELINE_COVERAGE_MAX_CHAR_COUNT);
    if (originalCharCount === null || representedCharCount === null) {
      errors.push(`BASELINE_PROJECTION_COVERAGE_SCALAR_COUNTS_INVALID:${path}`);
      scalars[path] = { originalCharCount, representedCharCount, reduced: true, complete: false };
      derivedReducedSections.add(path);
      continue;
    }
    const derivedReduced = originalCharCount !== representedCharCount;
    const reduced = item.reduced === true;
    const complete = item.complete === true && !derivedReduced && !reduced;
    if (typeof item.reduced !== "boolean" || typeof item.complete !== "boolean") {
      errors.push(`BASELINE_PROJECTION_COVERAGE_SCALAR_FLAGS_REQUIRED:${path}`);
    }
    if (reduced !== derivedReduced) {
      errors.push(`BASELINE_PROJECTION_COVERAGE_SCALAR_REDUCED_MISMATCH:${path}`);
    }
    if (item.complete !== !derivedReduced) {
      errors.push(`BASELINE_PROJECTION_COVERAGE_SCALAR_COMPLETE_MISMATCH:${path}`);
    }
    scalars[path] = { originalCharCount, representedCharCount, reduced, complete };
    if (!complete) derivedReducedSections.add(path);
  }

  const reducedSections = normalizeCoveragePathList(value.reducedSections, {
    label: "REDUCED_SECTIONS",
    maxItems: BASELINE_DECISION_COLLECTION_PATHS.length + BASELINE_DECISION_SCALAR_PATHS.length,
    errors
  });
  const omittedSections = normalizeCoveragePathList(value.omittedSections, {
    label: "OMITTED_SECTIONS",
    maxItems: BASELINE_DECISION_COLLECTION_PATHS.length,
    errors
  });

  if (!samePathSet(reducedSections, [...derivedReducedSections])) {
    errors.push("BASELINE_PROJECTION_COVERAGE_REDUCED_SECTIONS_MISMATCH");
  }
  if (!samePathSet(omittedSections, [...derivedOmittedSections])) {
    errors.push("BASELINE_PROJECTION_COVERAGE_OMITTED_SECTIONS_MISMATCH");
  }

  const derivedComplete = derivedReducedSections.size === 0;
  if (typeof value.complete !== "boolean") {
    errors.push("BASELINE_PROJECTION_COVERAGE_COMPLETE_REQUIRED");
  } else if (value.complete !== derivedComplete) {
    errors.push("BASELINE_PROJECTION_COVERAGE_COMPLETE_MISMATCH");
  }
  if (Array.isArray(value.validationErrors)) {
    for (const error of value.validationErrors.slice(0, 32)) {
      const code = sanitizeText(error, 180);
      if (code) errors.push(code);
    }
  }

  return {
    coverage: {
      schema: BASELINE_PROJECTION_COVERAGE_SCHEMA_ID,
      strategy,
      complete: derivedComplete && value.complete === true,
      collections,
      scalars,
      reducedSections,
      omittedSections
    },
    errors
  };
}

export function normalizeBaselineProjectionCoverage(value = null) {
  const normalized = normalizeCoverageInternal(value);
  if (!normalized.coverage) return null;
  return {
    ...normalized.coverage,
    validationErrors: [...new Set(normalized.errors)].slice(0, 32)
  };
}

export function validateBaselineProjectionCoverage(value, {
  baselineCandidate = null
} = {}) {
  const normalized = normalizeCoverageInternal(value);
  const errors = [...normalized.errors];
  if (!normalized.coverage) {
    return { valid: false, complete: false, errors, coverage: null };
  }
  if (baselineCandidate && typeof baselineCandidate === "object") {
    const projected = baselineProjectionForStrategy(
      baselineCandidate,
      normalized.coverage.strategy
    );
    if (!projected) {
      errors.push("BASELINE_PROJECTION_COVERAGE_STRATEGY_UNREPLAYABLE");
    } else {
      const expectedCoverage = assessBaselineSemanticCoverage(
        baselineCandidate,
        projected,
        normalized.coverage.strategy
      );
      for (const path of BASELINE_DECISION_COLLECTION_PATHS) {
        const actual = normalized.coverage.collections[path];
        const expected = expectedCoverage.collections[path];
        if (!actual || !expected ||
            actual.originalItemCount !== expected.originalItemCount ||
            actual.representedItemCount !== expected.representedItemCount ||
            actual.omittedItemCount !== expected.omittedItemCount ||
            actual.truncatedItemCount !== expected.truncatedItemCount ||
            actual.complete !== expected.complete) {
          errors.push(`BASELINE_PROJECTION_COVERAGE_CANDIDATE_COLLECTION_MISMATCH:${path}`);
        }
      }
      for (const path of BASELINE_DECISION_SCALAR_PATHS) {
        const actual = normalized.coverage.scalars[path];
        const expected = expectedCoverage.scalars[path];
        if (!actual || !expected ||
            actual.originalCharCount !== expected.originalCharCount ||
            actual.representedCharCount !== expected.representedCharCount ||
            actual.reduced !== expected.reduced ||
            actual.complete !== expected.complete) {
          errors.push(`BASELINE_PROJECTION_COVERAGE_CANDIDATE_SCALAR_MISMATCH:${path}`);
        }
      }
      if (
        normalized.coverage.complete !== expectedCoverage.complete ||
        !samePathSet(normalized.coverage.reducedSections, expectedCoverage.reducedSections) ||
        !samePathSet(normalized.coverage.omittedSections, expectedCoverage.omittedSections)
      ) {
        errors.push("BASELINE_PROJECTION_COVERAGE_CANDIDATE_PROJECTION_SUMMARY_MISMATCH");
      }
    }
  }
  const uniqueErrors = [...new Set(errors)].slice(0, 32);
  const complete = normalized.coverage.complete && uniqueErrors.length === 0;
  return {
    valid: uniqueErrors.length === 0,
    complete,
    errors: uniqueErrors,
    coverage: {
      ...normalized.coverage,
      complete,
      validationErrors: uniqueErrors
    }
  };
}

function projectionCoverageFailureReason(validation) {
  if (!validation?.coverage) return "BASELINE_PROJECTION_SEMANTIC_COVERAGE_REQUIRED";
  if (!validation.valid) return "BASELINE_PROJECTION_SEMANTIC_COVERAGE_INVALID";
  if (!validation.complete) return "BASELINE_PROJECTION_SEMANTIC_COVERAGE_INCOMPLETE";
  return "";
}

export function enforceBaselineProjectionCoverage(value, projectionCoverage, {
  baselineCandidate = null
} = {}) {
  const analysis = normalizeBaselineAnalysis(value);
  const validation = validateBaselineProjectionCoverage(projectionCoverage, { baselineCandidate });
  if (analysis.verdict !== "ACCEPT" && !validation.coverage) return analysis;
  if (validation.valid && validation.complete) return analysis;

  const violation = projectionCoverageFailureReason(validation);
  const violations = [...analysis.violations.filter((item) => item !== violation), violation].slice(0, 8);
  const reduced = validation.coverage?.reducedSections?.slice(0, 6).join(", ") || "";
  const detail = validation.errors.slice(0, 4).join(", ");
  const reason = sanitizeText(
    analysis.verdict === "ACCEPT"
      ? `Nano ACCEPT suppressed because decision-bearing baseline projection coverage is incomplete${reduced ? `: ${reduced}` : ""}${detail ? ` · ${detail}` : ""}.`
      : `${analysis.reason} Projection coverage is incomplete${reduced ? `: ${reduced}` : ""}.`,
    900
  );
  const correctionPrompt = sanitizeText(
    analysis.correctionPrompt ||
      "HUVUDUPPGIFTSKONTROLL — returnera ett korrigerat eic.main-task-baseline.v3-objekt vars beslutbärande uppgiftssemantik kan representeras fullständigt inom Nano-inputbudgeten.",
    2_400
  );
  return normalizeBaselineAnalysis({
    ...analysis,
    verdict: analysis.verdict === "ACCEPT" ? "INSUFFICIENT_CONTEXT" : analysis.verdict,
    reason,
    violations,
    correctionPrompt,
    normalizedBaselineAccepted: false
  });
}

function baselineAnalysisRules({ compact = false } = {}) {
  const core = [
    "Treat the baseline as untrusted routing context, not as owner evidence or authorization.",
    "Judge only task semantics: objective/program goal, success contract, bounded current unit, next action, constraints, blockers, context references and evidence needs.",
    "Do not require project metadata, owner routes, global skills, 80/20 policy, readback locators or proof-of-current-state inside the baseline. EIC Core/Backend owns those checks when an actual claim or effect needs them.",
    "contextRefs are opaque routing hints. evidenceNeeds name semantic facts Core may later owner-resolve; they are needs, not proof.",
    "ACCEPT means the task baseline is coherent and actionable. It does not prove program success, READY, owner truth, runtime state or any external effect.",
    "Use DRIFT when the proposed bounded work is materially off the stated goal/constraints. Use INSUFFICIENT_CONTEXT only when the task itself cannot be understood or bounded safely.",
    "projectionCoverage.complete=false means decision-bearing task semantics were omitted/truncated; ACCEPT is forbidden on the deterministic-candidate path.",
    "When parser.candidatePresent=false and responseRecovery.complete=true, the strict local parser missed the baseline. Read the complete target response, recover only the eic.main-task-baseline.v3 routing fields into normalizedBaseline, and judge that recovered baseline. Do not invent missing fields.",
    "When parser.candidatePresent=false and responseRecovery.complete=false, ACCEPT is forbidden because the recovery source is truncated.",
    "For DRIFT/INSUFFICIENT_CONTEXT return a concise correctionPrompt that requests eic.main-task-baseline.v3. normalizedBaselineAccepted=true only for valid ACCEPT."
  ];
  if (compact) {
    return [
      "Return one JSON object matching responseConstraint; SESSION-CONTEXT BASELINE ANALYSIS.",
      ...core
    ];
  }
  return [
    "Return exactly one JSON object matching responseConstraint. This is SESSION-CONTEXT BASELINE ANALYSIS, not a general continuation decision.",
    ...core
  ];
}

function nanoProjectionCoverageView(value = null) {
  if (!value || typeof value !== "object") return null;
  return {
    schema: sanitizeText(value.schema, 80),
    strategy: sanitizeText(value.strategy, 60),
    complete: value.complete === true,
    collections: value.collections && typeof value.collections === "object" ? value.collections : {},
    scalars: value.scalars && typeof value.scalars === "object" ? value.scalars : {},
    reducedSections: Array.isArray(value.reducedSections) ? value.reducedSections.slice(0, 16) : [],
    omittedSections: Array.isArray(value.omittedSections) ? value.omittedSections.slice(0, 8) : []
  };
}

function buildCompleteResponseRecoveryPrompt({
  responseText,
  parseErrors,
  observation,
  limit,
  responseRecoveryComplete = true
} = {}) {
  const fullResponse = String(responseText || observation?.responseText || "");
  if (!fullResponse.trim() || responseRecoveryComplete !== true) return null;
  const rules = baselineAnalysisRules({ compact: true });
  const data = {
    parser: {
      candidatePresent: false,
      errors: compactArray(Array.isArray(parseErrors) ? parseErrors : [], 8, 120)
    },
    candidate: null,
    projectionCoverage: null,
    responseIdentity: sanitizeText(observation?.responseIdentity || observation?.responseHash, 140),
    responseRecovery: {
      complete: responseRecoveryComplete === true,
      text: fullResponse
    }
  };
  const prompt = `NANO BASELINE ANALYSIS v2\n${rules.join("\n")}\nDATA=${JSON.stringify(data)}`;
  if (prompt.length > limit) return null;
  return {
    prompt,
    data,
    profile: { strategy: "BASELINE_RESPONSE_RECOVERY" },
    semanticCoverage: null,
    responseRecoveryComplete: true
  };
}

function buildBaselinePromptData({
  baselineCandidate,
  parseErrors,
  observation,
  responseText,
  profile
}) {
  const candidate = compactBaseline(baselineCandidate, profile);
  const semanticCoverage = assessBaselineSemanticCoverage(
    baselineCandidate,
    candidate,
    profile.strategy
  );
  return {
    data: {
      parser: {
        candidatePresent: Boolean(baselineCandidate),
        errors: compactArray(parseErrors, profile.strategy === "BASELINE_SEMANTIC_MICRO" ? 2 : 8, 120)
      },
      candidate,
      projectionCoverage: nanoProjectionCoverageView(semanticCoverage),
      responseIdentity: sanitizeText(
        observation?.responseIdentity || observation?.responseHash,
        profile.strategy === "BASELINE_SEMANTIC_MICRO" ? 80 : 140
      ),
      responseExcerpt: compactText(
        responseText || observation?.responseText || "",
        profile.responseExcerpt
      )
    },
    semanticCoverage
  };
}

export function buildBaselineAnalysisPromptDetailed({
  responseText = "",
  baselineCandidate = null,
  parseErrors = [],
  observation = {},
  responseRecoveryComplete = true,
  maxPromptChars = 12_000
} = {}) {
  const limit = Math.max(512, Math.floor(Number(maxPromptChars || 12_000)));
  let selected = null;

  if (!baselineCandidate) {
    selected = buildCompleteResponseRecoveryPrompt({
      responseText,
      parseErrors,
      observation,
      limit,
      responseRecoveryComplete
    });
  }

  for (const profile of BASELINE_PROJECTION_PROFILES) {
    if (selected) break;
    const compactRules = profile.strategy === "BASELINE_SEMANTIC_MICRO";
    const rules = baselineAnalysisRules({ compact: compactRules });
    const builtData = buildBaselinePromptData({
      baselineCandidate,
      parseErrors: Array.isArray(parseErrors) ? parseErrors : [],
      observation,
      responseText,
      profile
    });
    const prompt = `NANO BASELINE ANALYSIS v2\n${rules.join("\n")}\nDATA=${JSON.stringify(builtData.data)}`;

    if (profile.strategy === "BASELINE_SEMANTIC_BALANCED") {
      const balancedFits = prompt.length <= limit;
      if (balancedFits && builtData.semanticCoverage?.complete === true) {
        selected = { prompt, data: builtData.data, profile, semanticCoverage: builtData.semanticCoverage };
        break;
      }
      const losslessBuilt = buildBaselinePromptData({
        baselineCandidate,
        parseErrors: Array.isArray(parseErrors) ? parseErrors : [],
        observation,
        responseText: "",
        profile: BASELINE_LOSSLESS_PROFILE
      });
      const losslessPrompt =
        `NANO BASELINE ANALYSIS v2\n${baselineAnalysisRules({ compact: true }).join("\n")}\nDATA=${JSON.stringify(losslessBuilt.data)}`;
      if (losslessPrompt.length <= limit && losslessBuilt.semanticCoverage?.complete === true) {
        selected = {
          prompt: losslessPrompt,
          data: losslessBuilt.data,
          profile: BASELINE_LOSSLESS_PROFILE,
          semanticCoverage: losslessBuilt.semanticCoverage
        };
        break;
      }
      if (balancedFits) {
        selected = { prompt, data: builtData.data, profile, semanticCoverage: builtData.semanticCoverage };
        break;
      }
      continue;
    }

    if (prompt.length <= limit) {
      selected = { prompt, data: builtData.data, profile, semanticCoverage: builtData.semanticCoverage };
      break;
    }
  }

  if (!selected) {
    const data = {
      parser: { candidatePresent: Boolean(baselineCandidate), errors: [] },
      candidate: minimumBaselineProjection(baselineCandidate),
      responseIdentity: "",
      responseExcerpt: ""
    };
    const semanticCoverage = assessBaselineSemanticCoverage(
      baselineCandidate,
      data.candidate,
      "BASELINE_SEMANTIC_MINIMUM"
    );
    data.projectionCoverage = nanoProjectionCoverageView(semanticCoverage);
    const prompt = `NANO BASELINE ANALYSIS v2\n${baselineAnalysisRules({ compact: true }).join("\n")}\nDATA=${JSON.stringify(data)}`;
    selected = {
      prompt,
      data,
      profile: { strategy: "BASELINE_SEMANTIC_MINIMUM" },
      semanticCoverage,
      responseRecoveryComplete: false
    };
  }

  return {
    prompt: selected.prompt,
    budget: {
      maxPromptChars: limit,
      promptChars: selected.prompt.length,
      withinBudget: selected.prompt.length <= limit,
      schemaMaxOutputChars: selected.responseRecoveryComplete === true
        ? estimateJsonSchemaMaxChars(BASELINE_ANALYSIS_RECOVERY_RESPONSE_SCHEMA)
        : BASELINE_ANALYSIS_SCHEMA_MAX_CHARS,
      outputBudgetChars: selected.responseRecoveryComplete === true
        ? BASELINE_ANALYSIS_RECOVERY_MAX_OUTPUT_CHARS
        : BASELINE_ANALYSIS_MAX_OUTPUT_CHARS,
      strategy: selected.profile.strategy,
      semanticCoverage: normalizeBaselineProjectionCoverage(selected.semanticCoverage),
      responseRecoveryComplete: selected.responseRecoveryComplete === true,
      sections: {
        projection: {
          strategy: selected.profile.strategy,
          trimmedLists: selected.semanticCoverage?.reducedSections || [],
          reducedSections: selected.semanticCoverage?.reducedSections || [],
          omittedSections: selected.semanticCoverage?.omittedSections || [],
          semanticCoverageComplete: selected.semanticCoverage?.complete === true
        }
      }
    }
  };
}

export function normalizeBaselineAnalysis(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const verdict = ["ACCEPT", "DRIFT", "INSUFFICIENT_CONTEXT"].includes(source.verdict)
    ? source.verdict
    : "INSUFFICIENT_CONTEXT";
  const normalizedBaseline = normalizeMainTaskBaseline(source.normalizedBaseline, {
    source: "NANO_ROUTING_RECOVERY"
  });
  return {
    schema: BASELINE_ANALYSIS_SCHEMA_ID,
    verdict,
    reason: sanitizeText(source.reason, 900),
    violations: (Array.isArray(source.violations) ? source.violations : [])
      .map((item) => sanitizeText(item, 260)).filter(Boolean).slice(0, 8),
    correctionPrompt: sanitizeText(source.correctionPrompt, 2400),
    normalizedBaselineAccepted: source.normalizedBaselineAccepted === true,
    normalizedBaseline
  };
}

export function validateBaselineAnalysis(value, {
  candidatePresent = false,
  baselineCandidate = null,
  projectionCoverage = null,
  responseRecoveryComplete = false
} = {}) {
  const analysis = normalizeBaselineAnalysis(value);
  const recoveredBaseline = analysis.normalizedBaseline || null;
  const effectiveBaseline = baselineCandidate || recoveredBaseline;
  const recovered = !baselineCandidate && Boolean(recoveredBaseline);
  const coverageValidation = validateBaselineProjectionCoverage(projectionCoverage, { baselineCandidate });
  const errors = [];
  if (!analysis.reason) errors.push("BASELINE_ANALYSIS_REASON_REQUIRED");
  if (analysis.verdict === "ACCEPT") {
    if (!effectiveBaseline) errors.push("BASELINE_ANALYSIS_CANDIDATE_REQUIRED");
    if (recovered) {
      if (responseRecoveryComplete !== true) {
        errors.push("BASELINE_ANALYSIS_RECOVERY_SOURCE_INCOMPLETE");
      }
      const recoveredValidation = validateMainTaskBaseline(recoveredBaseline);
      if (!recoveredValidation.valid) {
        errors.push("BASELINE_ANALYSIS_RECOVERED_BASELINE_INVALID");
      }
    } else {
      if (!projectionCoverage || typeof projectionCoverage !== "object") {
        errors.push("BASELINE_ANALYSIS_SEMANTIC_COVERAGE_REQUIRED");
      } else if (!coverageValidation.valid) {
        errors.push("BASELINE_ANALYSIS_SEMANTIC_COVERAGE_INVALID");
      } else if (!coverageValidation.complete) {
        errors.push("BASELINE_ANALYSIS_SEMANTIC_COVERAGE_INCOMPLETE");
      }
    }
    if (!analysis.normalizedBaselineAccepted) errors.push("BASELINE_ANALYSIS_ACCEPT_FLAG_REQUIRED");
    if (analysis.violations.length) errors.push("BASELINE_ANALYSIS_ACCEPT_WITH_VIOLATIONS");
  } else {
    if (analysis.normalizedBaselineAccepted) errors.push("BASELINE_ANALYSIS_REJECT_FLAG_INVALID");
    if (!analysis.correctionPrompt) errors.push("BASELINE_ANALYSIS_CORRECTION_REQUIRED");
  }
  return {
    valid: errors.length === 0,
    errors,
    analysis,
    effectiveBaseline,
    recoveredBaseline,
    recoveryUsed: recovered,
    projectionCoverage: coverageValidation.coverage,
    projectionCoverageValidation: coverageValidation
  };
}

function acceptedDecisionStopCriteria(baseline = {}) {
  const sourceCriteria = Array.isArray(baseline.success?.criteria)
    ? baseline.success.criteria.map((item) => fullText(item)).filter(Boolean)
    : [];
  const doneWhen = fullText(baseline.success?.doneWhen);
  const allCriteriaFit = sourceCriteria.length <= 2 &&
    sourceCriteria.every((item) => item.length <= 400) &&
    doneWhen.length <= 400;
  if (allCriteriaFit) {
    return [
      ...sourceCriteria.map((item) => sanitizeText(item, 400)),
      sanitizeText(doneWhen, 400),
      "Operatören stoppar."
    ].filter(Boolean).slice(0, 4);
  }
  return [
    sanitizeText(
      `PROGRAM_SUCCESS_CONTRACT_NON_EXHAUSTIVE: ${sourceCriteria.length} success.criteria remain authoritative in committed eic.main-task-baseline.v3; this bounded stopCriteria list is not the complete success contract.`,
      400
    ),
    doneWhen
      ? sanitizeText(
          `success.doneWhen summary (NON_EXHAUSTIVE if truncated): ${compactText(doneWhen, 300)}`,
          400
        )
      : "success.doneWhen remains defined by the committed eic.main-task-baseline.v3.",
    "BASELINE ACCEPT does not prove READY, owner truth or program success.",
    "Operatören stoppar."
  ];
}

export function baselineAnalysisToDecision(analysisValue, {
  baselineCandidate = null,
  observation = {},
  fallbackCorrectionPrompt = "",
  projectionCoverage = null,
  responseRecoveryComplete = false
} = {}) {
  const normalized = normalizeBaselineAnalysis(analysisValue);
  const recoveredBaseline = normalized.normalizedBaseline || null;
  const baseline = baselineCandidate || recoveredBaseline || {};
  const analysis = baselineCandidate
    ? enforceBaselineProjectionCoverage(normalized, projectionCoverage, { baselineCandidate })
    : normalized;
  const accepted = analysis.verdict === "ACCEPT" &&
    analysis.normalizedBaselineAccepted === true &&
    Boolean(baselineCandidate || recoveredBaseline) &&
    (Boolean(baselineCandidate) || responseRecoveryComplete === true);
  let correction = sanitizeText(
    analysis.correctionPrompt || fallbackCorrectionPrompt ||
      "HUVUDUPPGIFTSKONTROLL — returnera ett korrigerat eic.main-task-baseline.v3-objekt med tydligt mål, framgångskriterier, avgränsad arbetsenhet, constraints, blockers, contextRefs och evidenceNeeds.",
    2200
  );
  if (!correction.includes("eic.main-task-baseline.v3")) {
    correction = sanitizeText(
      `HUVUDUPPGIFTSKONTROLL — returnera ett korrigerat eic.main-task-baseline.v3-objekt. ${correction}`,
      2400
    );
  }
  const responseAnchor = sanitizeText(
    observation?.responseIdentity || observation?.responseHash,
    320
  );

  if (accepted) {
    return {
      analysisMode: "CONTINUATION_ANALYSIS",
      intent: sanitizeText(baseline.mainTask?.programGoal || baseline.mainTask?.objective, 1200),
      action: "CONTINUE",
      progressDelta: 1,
      primaryProgramGoal: sanitizeText(baseline.mainTask?.programGoal, 1200),
      activeMilestone: sanitizeText(baseline.current?.activeMilestone || "MAIN_TASK", 800),
      boundedCurrentUnit: sanitizeText(baseline.current?.boundedWorkUnit, 800),
      directProgramDelta: 0,
      requiredControl: false,
      omissionFailure: "",
      unlocksNextAction: sanitizeText(baseline.current?.nextHighLeverageAction, 800),
      evidenceClass: "ROUTING_CONTEXT",
      completionState: "MILESTONE_CONTINUE",
      boundedStop: false,
      baselineCommitOnly: true,
      reason: analysis.reason,
      workUnit: sanitizeText(baseline.current?.boundedWorkUnit, 800),
      // v0.11.3: nextHighLeverageAction is future routing context, not a current
      // executable action. Baseline ACCEPT is a typed commit event and therefore
      // must never be fed into ordinary continuation grounding/transport.
      requestedAction: "",
      requiredEvidence: Array.isArray(baseline.evidenceNeeds) ? baseline.evidenceNeeds.slice(0, 8) : [],
      verifiedFacts: [],
      targetClaims: [],
      inferences: ["Huvuduppgiftsbaslinjen är Nano-validerad routingkontext, inte owner-bevis."],
      evidenceAnchors: responseAnchor ? [`BASELINE_RESPONSE_IDENTITY:${responseAnchor}`] : ["BASELINE_RESPONSE_OBSERVED"],
      contextEvidence: responseAnchor ? [`BASELINE_RESPONSE_IDENTITY:${responseAnchor}`] : ["BASELINE_RESPONSE_OBSERVED"],
      attempts: [],
      blockers: Array.isArray(baseline.blockers) ? baseline.blockers.slice(0, 4) : [],
      alternatives: [],
      continueCriteria: ["Nästa bounded åtgärd är fortfarande förenlig med den validerade huvuduppgiftsbaslinjen."],
      stopCriteria: acceptedDecisionStopCriteria(baseline),
      completionEvidence: "",
      completionScope: "WORK_UNIT",
      completionConfirmed: false,
      pauseOrigin: "NONE",
      boundaryEvidence: "",
      destructivenessLevel: 1,
      destructivenessRationale: "Nano validerar endast uppgiftsrouting; owner- och effect-verifiering ägs av EIC Core/Backend.",
      rollbackPath: "NOT_REQUIRED_TRANSIENT",
      readbackPlan: "CORE_RESOLVES_EVIDENCE_NEEDS_BEFORE_STRONG_CLAIM_OR_EFFECT",
      materialAmbiguity: "NONE",
      ownerRoute: AUTONOM_AGENT_LOCAL_SESSION_STATE,
      ownerResolution: LOCAL_AGENT_OWNER_RESOLUTION,
      exactTarget: "CURRENT_SESSION_MAIN_TASK",
      unlockEvent: "",
      trackControl: {
        status: "ON_TRACK",
        baselinePresent: true,
        currentActionRelation: "DIRECT",
        eightyTwentyVerdict: "HIGH_LEVERAGE",
        activeGlobalSkills: [],
        requiredGlobalSkills: [],
        skillGaps: [],
        detourReason: "",
        returnCondition: "",
        correctionPrompt: ""
      }
    };
  }

  return {
    analysisMode: "CONTINUATION_ANALYSIS",
    intent: "Korrigera huvuduppgiftsbaslinjen innan vanlig agentbearbetning.",
    action: "CONTINUE",
    progressDelta: 0,
    primaryProgramGoal: sanitizeText(
      baseline.mainTask?.programGoal || "Fastställ den aktuella sessionens korrekta huvuduppgift.",
      1200
    ),
    activeMilestone: "SESSION_CONTEXT_INIT",
    boundedCurrentUnit: "Korrigera eic.main-task-baseline.v3.",
    directProgramDelta: 0,
    requiredControl: true,
    omissionFailure: `Utan korrigerad Nano-validerad baseline kan huvudmål och nästa bounded åtgärd inte styras säkert. ${analysis.violations.join("; ")}`,
    unlocksNextAction: "Ett korrigerat eic.main-task-baseline.v3-svar observeras och Nano-valideras.",
    evidenceClass: "ROUTING_CONTEXT",
    completionState: "MILESTONE_CONTINUE",
    boundedStop: false,
    reason: analysis.reason,
    workUnit: "Korrigera eic.main-task-baseline.v3.",
    requestedAction: correction,
    requiredEvidence: ["Ett korrigerat eic.main-task-baseline.v3-svar med koherent mål, framgångskriterier, bounded work unit och nästa åtgärd."],
    verifiedFacts: [],
    targetClaims: [],
    inferences: analysis.violations.map((item) => `Nano baseline violation: ${item}`),
    evidenceAnchors: responseAnchor ? [`BASELINE_RESPONSE_IDENTITY:${responseAnchor}`] : ["BASELINE_RESPONSE_OBSERVED"],
    contextEvidence: responseAnchor ? [`BASELINE_RESPONSE_IDENTITY:${responseAnchor}`] : ["BASELINE_RESPONSE_OBSERVED"],
    attempts: [],
    blockers: analysis.violations.slice(0, 4),
    alternatives: [],
    continueCriteria: ["Ett korrigerat baseline-svar har observerats."],
    stopCriteria: ["Ett Nano-validerat eic.main-task-baseline.v3-svar finns.", "Operatören stoppar initieringen."],
    completionEvidence: "",
    completionScope: "WORK_UNIT",
    completionConfirmed: false,
    pauseOrigin: "NONE",
    boundaryEvidence: "",
    destructivenessLevel: 1,
    destructivenessRationale: "Endast korrigerande sessionskontextprompt; ingen extern effekt.",
    rollbackPath: "NOT_REQUIRED_TRANSIENT",
    readbackPlan: "OBSERVE_CORRECTED_BASELINE_RESPONSE",
    materialAmbiguity: "PRESENT",
    ownerRoute: AUTONOM_AGENT_LOCAL_SESSION_STATE,
    ownerResolution: LOCAL_AGENT_OWNER_RESOLUTION,
    exactTarget: "CURRENT_SESSION_MAIN_TASK_BASELINE",
    unlockEvent: "CORRECTED_BASELINE_RESPONSE",
    trackControl: {
      status: "BASELINE_REQUESTED",
      baselinePresent: false,
      currentActionRelation: "UNKNOWN",
      eightyTwentyVerdict: "UNKNOWN",
      activeGlobalSkills: [],
      requiredGlobalSkills: [],
      skillGaps: [],
      detourReason: "",
      returnCondition: "",
      correctionPrompt: correction
    }
  };
}
