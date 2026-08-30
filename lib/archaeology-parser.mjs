import { sanitizeText } from "./common.mjs";
import { locateTargetTrailer, stripProtocolNoise } from "./prompt-contract.mjs";
import {
  ARCHAEOLOGY_EVENT_MARKER,
  ARCHAEOLOGY_EVENT_PROTOCOL,
  ARCHAEOLOGY_EFFECT_CEILING,
  ARCHAEOLOGY_GATES,
  ARCHAEOLOGY_HYPOTHESIS_STATUSES,
  ARCHAEOLOGY_PHASES,
  ARCHAEOLOGY_RESULTS,
  scenarioById
} from "./archaeology-contract.mjs";

function markerLines(source) {
  const pattern = new RegExp(`^[ \\t]*(?:<!--[ \\t]*)?${ARCHAEOLOGY_EVENT_MARKER}[ \\t]*(?:-->)?[ \\t]*$`, "gm");
  return [...source.matchAll(pattern)];
}

function extractFirstBalancedObject(text) {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) return text.slice(start, index + 1);
    }
  }
  return "";
}

export function extractArchaeologyEventBlock(text) {
  const source = String(text || "");
  const markers = markerLines(source);
  if (!markers.length) return { found: false, raw: "", markerCount: 0, markerIndex: -1 };
  const first = markers[0];
  const raw = extractFirstBalancedObject(source.slice(first.index + first[0].length));
  return { found: Boolean(raw), raw, markerCount: markers.length, markerIndex: first.index };
}

export function archaeologyEventPlacement(text) {
  const source = stripProtocolNoise(text);
  const markers = markerLines(source);
  if (!markers.length) return "ABSENT";
  const trailer = locateTargetTrailer(source);
  if (!trailer.valid || !trailer.block?.length) return "NO_TRAILER";
  const lines = source.split("\n");
  let trailerIndex = 0;
  for (let index = 0; index < trailer.block[0].sourceLineIndex; index += 1) {
    trailerIndex += lines[index].length + 1;
  }
  return markers[0].index < trailerIndex ? "BEFORE_TRAILER" : "AFTER_TRAILER";
}

function list(value, maxItems = 20, maxLength = 600) {
  return (Array.isArray(value) ? value : [])
    .map((item) => sanitizeText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function workspaceRecommendations(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => ({
      capabilityFamily: sanitizeText(item?.capability_family, 120),
      probe: sanitizeText(item?.probe, 120),
      reason: sanitizeText(item?.reason, 600)
    }))
    .filter((item) => item.capabilityFamily || item.probe || item.reason)
    .slice(0, 8);
}

export function normalizeArchaeologyEvent(value = {}) {
  return {
    protocol: sanitizeText(value.protocol, 80),
    runId: sanitizeText(value.run_id, 120),
    turnId: sanitizeText(value.turn_id, 120),
    scenario: sanitizeText(value.scenario, 80).toUpperCase(),
    stepNo: Number.isSafeInteger(value.step_no) ? value.step_no : null,
    phase: sanitizeText(value.phase, 60).toUpperCase(),
    coverageUnit: sanitizeText(value.coverage_unit, 240),
    hypothesisId: sanitizeText(value.hypothesis_id, 120),
    hypothesis: sanitizeText(value.hypothesis, 1600),
    hypothesisStatus: sanitizeText(value.hypothesis_status, 60).toUpperCase(),
    method: sanitizeText(value.method, 1600),
    observation: sanitizeText(value.observation, 2400),
    result: sanitizeText(value.result, 60).toUpperCase(),
    evidenceLocators: list(value.evidence_locators, 20, 800),
    workspaceRecommendations: workspaceRecommendations(value.workspace_recommendations),
    proposedEffect: sanitizeText(value.proposed_effect, 100).toUpperCase(),
    nextMicroStep: sanitizeText(value.next_micro_step, 1600)
  };
}

export function parseArchaeologyEvent(text) {
  const block = extractArchaeologyEventBlock(text);
  if (!block.found) return { valid: false, reason: ARCHAEOLOGY_GATES.EVENT_MISSING, event: null, block };
  let parsed;
  try {
    parsed = JSON.parse(block.raw);
  } catch {
    return { valid: false, reason: ARCHAEOLOGY_GATES.EVENT_MALFORMED, event: null, block };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { valid: false, reason: ARCHAEOLOGY_GATES.EVENT_MALFORMED, event: null, block };
  }
  return { valid: true, reason: "", event: normalizeArchaeologyEvent(parsed), block };
}

const SECRET_SHAPED = [
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{16,}/,
  /\bAKIA[0-9A-Z]{12,}/,
  /\b(?:sk|rk)-[A-Za-z0-9]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*\S{8,}/i
];

const FORBIDDEN_EFFECT = /(?:SOURCE_MUTATION|PATCH_APPLY|COMMIT|MERGE|RELEASE|DEPLOY|CHANGE_PERMISSION|AUTH_OWNER_ROUTE|SCHEMA_MIGRATION|PRODUCTION_DATA_WRITE|TARGET_MUTATION|SECRET_ACCESS|DELETE|PURGE)/i;

function containsSecret(value) {
  const text = JSON.stringify(value ?? "");
  return SECRET_SHAPED.some((pattern) => pattern.test(text));
}

export function evaluateArchaeologyEvent(event, {
  researchState = {},
  expectedRunId = "",
  expectedTurnId = "",
  expectedScenario = "",
  placement = "BEFORE_TRAILER",
  markerCount = 1
} = {}) {
  const errors = [];
  const push = (code) => { if (!errors.includes(code)) errors.push(code); };

  if (markerCount !== 1) push(ARCHAEOLOGY_GATES.EVENT_DUPLICATE_MARKER);
  if (placement === "AFTER_TRAILER") push(ARCHAEOLOGY_GATES.EVENT_AFTER_TRAILER);
  if (event.protocol !== ARCHAEOLOGY_EVENT_PROTOCOL) push(ARCHAEOLOGY_GATES.PROTOCOL_MISMATCH);
  if (expectedRunId && event.runId !== expectedRunId) push(ARCHAEOLOGY_GATES.RUN_ID_MISMATCH);
  if (expectedTurnId && event.turnId !== expectedTurnId) push(ARCHAEOLOGY_GATES.TURN_ID_MISMATCH);
  if (expectedScenario && scenarioById(event.scenario).id !== scenarioById(expectedScenario).id) {
    push(ARCHAEOLOGY_GATES.SCENARIO_MISMATCH);
  }
  if (!Number.isSafeInteger(event.stepNo) || event.stepNo < 1) push(ARCHAEOLOGY_GATES.STEP_INVALID);
  if (Number.isSafeInteger(event.stepNo) && event.stepNo <= Number(researchState.lastStepNo || 0)) {
    push(ARCHAEOLOGY_GATES.STEP_NOT_MONOTONIC);
  }
  if (!ARCHAEOLOGY_PHASES.includes(event.phase)) push(ARCHAEOLOGY_GATES.PHASE_UNKNOWN);
  if (!ARCHAEOLOGY_RESULTS.includes(event.result)) push(ARCHAEOLOGY_GATES.RESULT_UNKNOWN);

  const hypothesisPresent = Boolean(event.hypothesisId || event.hypothesis || event.hypothesisStatus);
  if (hypothesisPresent && (!event.hypothesisId || !event.hypothesisStatus)) {
    push(ARCHAEOLOGY_GATES.HYPOTHESIS_INCOMPLETE);
  }
  if (event.hypothesisStatus && !ARCHAEOLOGY_HYPOTHESIS_STATUSES.includes(event.hypothesisStatus)) {
    push(ARCHAEOLOGY_GATES.HYPOTHESIS_STATUS_UNKNOWN);
  }

  if (["SUPPORTED", "CONTRADICTED", "REPRODUCED"].includes(event.result) &&
      event.evidenceLocators.length === 0) {
    push(ARCHAEOLOGY_GATES.EVIDENCE_REQUIRED);
  }
  if (!["DONE", "BLOCKED"].includes(event.result) && !event.nextMicroStep) {
    push(ARCHAEOLOGY_GATES.NEXT_STEP_MISSING);
  }
  if (FORBIDDEN_EFFECT.test(event.proposedEffect || "")) push(ARCHAEOLOGY_GATES.FORBIDDEN_EFFECT);
  const allowedEffects = new Set([...ARCHAEOLOGY_EFFECT_CEILING.allowedEffects, "NONE"]);
  if (!allowedEffects.has(event.proposedEffect)) push(ARCHAEOLOGY_GATES.EFFECT_UNKNOWN);
  const allowedWorkspaceProbes = new Set(["workspace.help", "workspace.capabilities.resolve", "workspace.op.describe"]);
  for (const recommendation of event.workspaceRecommendations) {
    if (!recommendation.capabilityFamily || !recommendation.reason || !allowedWorkspaceProbes.has(recommendation.probe)) {
      push(ARCHAEOLOGY_GATES.WORKSPACE_PROBE_INVALID);
    }
  }
  if (containsSecret(event)) push(ARCHAEOLOGY_GATES.SECRET_SHAPED_VALUE);

  return {
    valid: errors.length === 0,
    errors,
    advisories: [],
    placement,
    progress: computeArchaeologyProgress(event, researchState)
  };
}

export function computeArchaeologyProgress(event, researchState = {}) {
  const stepAdvanced = Number.isSafeInteger(event.stepNo) && event.stepNo > Number(researchState.lastStepNo || 0);
  const coverage = String(event.coverageUnit || "").trim().toLowerCase();
  const newCoverage = Boolean(coverage) && !(researchState.coverageUnits || []).includes(coverage);
  const knownEvidence = new Set(researchState.evidenceLocators || []);
  const newEvidence = event.evidenceLocators.some((item) => !knownEvidence.has(item));
  const previous = event.hypothesisId ? researchState.hypotheses?.[event.hypothesisId] : null;
  const hypothesisAdvanced = Boolean(event.hypothesisId) &&
    (!previous || previous.status !== event.hypothesisStatus || previous.statement !== event.hypothesis);
  const delta = [stepAdvanced, newCoverage, newEvidence, hypothesisAdvanced].filter(Boolean).length;
  return { stepAdvanced, newCoverage, newEvidence, hypothesisAdvanced, delta: Math.min(3, delta), productive: delta > 0 };
}

export function applyArchaeologyEvent(researchState, event, { turnId = "", at = "" } = {}) {
  const next = {
    ...researchState,
    coverageUnits: [...(researchState.coverageUnits || [])],
    hypotheses: { ...(researchState.hypotheses || {}) },
    evidenceLocators: [...(researchState.evidenceLocators || [])],
    workspaceRecommendations: [...(researchState.workspaceRecommendations || [])]
  };
  next.lastStepNo = Math.max(Number(next.lastStepNo || 0), Number(event.stepNo || 0));
  next.stepCount = Number(next.stepCount || 0) + 1;
  if (event.phase) next.phase = event.phase;
  const coverage = String(event.coverageUnit || "").trim().toLowerCase();
  if (coverage && !next.coverageUnits.includes(coverage)) next.coverageUnits.push(coverage);
  for (const locator of event.evidenceLocators) {
    if (!next.evidenceLocators.includes(locator)) next.evidenceLocators.push(locator);
  }
  next.evidenceLocators = next.evidenceLocators.slice(-200);
  if (event.hypothesisId) {
    next.hypotheses[event.hypothesisId] = {
      id: event.hypothesisId,
      statement: event.hypothesis || next.hypotheses[event.hypothesisId]?.statement || "",
      status: event.hypothesisStatus || next.hypotheses[event.hypothesisId]?.status || "OPEN",
      lastResult: event.result,
      lastObservation: event.observation,
      turnId,
      at,
      provenance: "target-session-claim"
    };
  }
  for (const recommendation of event.workspaceRecommendations) {
    const key = `${recommendation.capabilityFamily}|${recommendation.probe}|${recommendation.reason}`;
    if (!next.workspaceRecommendations.some((item) => `${item.capabilityFamily}|${item.probe}|${item.reason}` === key)) {
      next.workspaceRecommendations.push({ ...recommendation, turnId, at, provenance: "target-session-claim" });
    }
  }
  next.workspaceRecommendations = next.workspaceRecommendations.slice(-40);
  next.updatedAt = at || new Date().toISOString();
  return next;
}

export function stripArchaeologyEventFromText(text) {
  const source = String(text || "");
  const block = extractArchaeologyEventBlock(source);
  if (!block.found) return { text: source, removedChars: 0, malformed: block.markerCount > 0 };
  const markerEnd = block.markerIndex + markerLines(source)[0][0].length;
  const rawIndex = source.indexOf(block.raw, markerEnd);
  if (rawIndex < 0) return { text: source, removedChars: 0, malformed: true };
  const end = rawIndex + block.raw.length;
  const stripped = `${source.slice(0, block.markerIndex)}${source.slice(end)}`.replace(/\n{3,}/g, "\n\n").trim();
  return { text: stripped, removedChars: end - block.markerIndex, malformed: false };
}

export function summarizeArchaeologyEventForNano(event, gate = {}) {
  const hypothesis = event.hypothesisId ? `hypothesis=${event.hypothesisId}:${event.hypothesisStatus || "OPEN"}` : "hypothesis=none";
  return [
    "ARCHAEOLOGY",
    `gate=${gate.valid ? "VALID" : (gate.errors || []).join(",") || "INVALID"}`,
    `step=${event.stepNo ?? "?"}`,
    `phase=${event.phase || "?"}`,
    `result=${event.result || "?"}`,
    hypothesis,
    `evidence=${event.evidenceLocators?.length || 0}`,
    `workspace=${event.workspaceRecommendations?.length || 0}`
  ].join(" · ");
}
