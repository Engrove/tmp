// v1.9.3 prompt contradiction linter (GFW_EIC_CONTROL_A2A_v1 handoff item 5,
// promptGenerationAlgorithm step 13: "Validate the prompt for contradictions
// before posting"). It checks only text and structure Greenfield itself
// authors; the mission, the objective, operator instructions and EIC-supplied
// evidence are data and are never linted for wording. A finding means a
// Greenfield template contradicts rules C01-C20, so composeA2APrompt refuses
// to post (fail closed, like envelope validation). Pure.

import {
  GFW_ALWAYS_FETCH_OWNERS,
  GFW_SLICING_METHOD_ID,
  INTERACTION_ROLES,
  interactionPosition
} from "./interaction-slicing.mjs";

export const PROMPT_LINT_SCHEMA = "eic.greenfield.prompt-lint.v1";

// Rules whose subject is receiver behaviour or engine state rather than
// prompt text; they are covered by engine code and tests, not by this lint.
export const PROMPT_LINT_NOT_TEXT_RULES = Object.freeze(["C08", "C09", "C10", "C11", "C13", "C15"]);

// Root properties the current response contract may carry (contract C18).
const ALLOWED_RESPONSE_ROOT_FIELDS = new Set([
  "schema", "status", "sessionAction", "greenfieldStatusRequest", "sessionReason", "pauseSeconds",
  "summary", "workPerformed", "evidence", "blockers", "nextSuggestedAction",
  "missionDelegations", "runtimeControl", "learningControl"
]);

const METHOD_PRECEDENCE = /unless superseded by the current always-fetch owner method/;

// Forbidden Greenfield-authored wording, by rule.
const FORBIDDEN = Object.freeze([
  ["C01", "WHOLE_ENVELOPE_DIRECTIVE", /\b(complete|finish|execute|do|deliver)\s+(?:(?:the|this)\s+(whole|entire|full|complete)\s+(?:[a-z_-]+\s+){0,3}(envelope(?:\/work[_ ]?quantum)?|work[_ ]?quantum|quantum|VTF|work package|mission|plan)|all(?:\s+remaining)?(?:\s+(phases|steps|tasks|work))?|everything)\s+in\s+(this|one|a single)\s+(response|turn|interaction)/i],
  ["C01", "CHAINING_DIRECTIVE", /then continue autonomously/i],
  ["C02", "QUANTUM_AS_PHASES", /maxInteractions\s+(is|are|means)\s+(the\s+)?(number of\s+)?(phases|steps|tasks)\s+to\s+(execute|run|do)/i],
  ["C03", "TURN_AS_QUANTUM_COUNTER", /\b(process\.turn|sessionSeq)\b[^.!?;\n]{0,80}\b(quantum (position|counter|index)|interaction (position|counter)|interactionInQuantum)\b/i],
  ["C04", "FINAL_AS_DONE", /\b(final interaction|finalInteractionInQuantum|checkpointRequired)\b[^.!?;\n]{0,80}\b(means|implies|is|as)\b[^.!?;\n]{0,30}\b(status=)?DONE\b/i],
  ["C05", "NEW_ENVELOPE_AT_BOUNDARY", /\b(create|generate|start)\s+a\s+new\s+progressionEnvelopeRef\b/i],
  ["C06", "REPLAN_EVERY_BOUNDARY", /\bre-?plan\s+(the\s+)?frontier\s+(after|at)\s+(every|each)\b/i],
  ["C07", "BLIND_RETRY", /\b(blind(?:ly)?[- ]retr(?:y|ies|ying)|retry\s+the\s+(same\s+)?mutation\s+without)\b/i],
  ["C12", "EXTERNAL_HJALMAR", /\b(start|open|use|request|require)s?\b[^.]{0,30}\b(fresh|external|separate|new)\b[^.]{0,20}\bHjalmar\b/i],
  ["C12", "HJALMAR_MANDATORY", /Hjalmar D2 is fixed|Audit is mandatory/i],
  ["C14", "NANO_MANDATORY", /\bNano\b[^.]{0,30}\b(is|stage is|are)\s+(mandatory|required)\b/i],
  ["C14", "NANO_ABSENCE_AS_BLOCKER", /\bNano\b[^.!?;\n]{0,40}\b(absence|null|unavailable|missing|absent|not\s+available)\b[^.!?;\n]{0,40}\b(block(?:er|s|ing)?|fail(?:ure|ed|s)?|stop(?:ped|s)?)\b/i],
  ["C16", "RESPONSE_TIME_BUDGET", /keep each response (well )?(inside|within)/i],
  ["C16", "PROVIDER_TTL", /\b(provider|chatgpt)\s+(ttl|time[- ]to[- ]live|timeout is|execution[- ]time limit is)\b/i],
  ["C17", "PART_ARTIFACTS", /\b(create|split into|emit)\b[^.]{0,30}\bPART-\d/i],
  ["C20", "ACTIVITY_AS_PROGRESS", /\b(tool runs?|status reads?|checkpoint writes?)\b[^.]{0,30}\b(count|counts|are|is)\s+(as\s+)?(mission\s+)?progress\b/i]
]);

// A prohibition in authored guidance is not an instruction to do it. Keep
// this local to each match, so a later positive directive is still checked.
function negatedDirective(text, match, code) {
  const prefix = text.slice(Math.max(0, match.index - 100), match.index);
  if (/\b(do not|don't|must not|should not|shall not|never|avoid|forbid)\s+(?:(?:use|treat|assume|hardcode(?:\/provider-assume)?|tell\s+(?:the\s+)?receiver\s+to)\s+)?$/i.test(prefix)) return true;
  let body = match[0];
  if (code === "NANO_ABSENCE_AS_BLOCKER") {
    // "Nano is not available" describes absence, not a negated blocker.
    const absence = body.match(/\b(absence|null|unavailable|missing|absent|not\s+available)\b/i);
    if (absence) body = body.slice(absence.index + absence[0].length);
  }
  return /\b(is|are|must|should|shall|do|does)\s+not\b|\bnever\s+(means?|implies?|becomes?|blocks?|stops?)\b/i.test(body);
}

function numericTimeClaims(text) {
  // Strip only the known label, not its body: an appended provider claim
  // must still fail. The native watchdog body describes client recovery.
  const body = text.replace(/^Greenfield client recovery watchdog \(not a provider limit and not a response-time budget\):\s*/i, "");
  const clauses = body.split(/(?<!\d)[.!?;](?!\d)|\n/);
  return clauses.filter(clause => {
    if (!/\b\d+(?:\.\d+)?\s*(minutes?|mins?|hours?|h)\b/i.test(clause) ||
        !/\b(provider|chatgpt|response|session)\b/i.test(clause) ||
        !/\b(ttl|limit|budget|timeout|deadline|expires?|lasts?|maximum|at most|must[^.!?;]{0,40}within)\b/i.test(clause)) return false;
    // Explicit no-budget statements remain valid authored guidance.
    if (/\b(has|have|is|are)\s+no\s+(fixed|known)\b/i.test(clause)) return false;
    const clock = clause.match(/\b(provider|chatgpt|response|session)\b/i);
    return !negatedDirective(clause, clock, "NUMERIC_TIME_BUDGET");
  });
}

function stringsUnder(value, path, out) {
  if (typeof value === "string") {
    out.push({ path, text: value });
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => stringsUnder(item, `${path}[${index}]`, out));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) stringsUnder(item, path ? `${path}.${key}` : key, out);
  }
  return out;
}

/**
 * Greenfield-authored text of an envelope (whitelisted roots only). Never
 * control.learningControl (it carries the mission's project name and the
 * EIC's own reported learning summary), objective, mission, operator
 * instructions, evidence or the window queue's labels: those are data, and a
 * phrase in them must never stop a prompt.
 */
export function authoredPromptStrings(envelope = {}) {
  const e = envelope && typeof envelope === "object" ? envelope : {};
  const control = e.control && typeof e.control === "object" ? e.control : {};
  const out = [];
  stringsUnder(e.sender?.presentation, "sender.presentation", out);
  stringsUnder(e.responseContract, "responseContract", out);
  stringsUnder(e.promptProfile?.rule, "promptProfile.rule", out);
  stringsUnder(control.ownerState, "control.ownerState", out);
  stringsUnder(control.interactionSlicing, "control.interactionSlicing", out);
  stringsUnder(control.windowQueue?.rule, "control.windowQueue.rule", out);
  if (control.workQueue) {
    for (const key of ["planningHint", "checkpointInstruction", "orderRule", "quantumRule", "priorityRule", "duplicateRule", "loopRule", "scheduleRule"]) {
      stringsUnder(control.workQueue[key], `control.workQueue.${key}`, out);
    }
  }
  const rotation = e.continuity?.sessionRotation;
  if (rotation?.unknownEffectRule) stringsUnder(rotation.unknownEffectRule, "continuity.sessionRotation.unknownEffectRule", out);
  return out;
}

/**
 * Lint one composed envelope. Returns { ok, findings, overpackGuardFired }.
 * findings: [{ rule, code, path, detail }].
 */
export function lintA2AEnvelope(envelope = {}) {
  const findings = [];
  const add = (rule, code, path, detail = "") => findings.push({ rule, code, path, detail: String(detail).slice(0, 240) });
  const e = envelope && typeof envelope === "object" ? envelope : {};
  const strings = authoredPromptStrings(e);
  const compact = e.promptProfile?.profile === "COMPACT";

  for (const { path, text } of strings) {
    for (const [rule, code, pattern] of FORBIDDEN) {
      for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags + "g"))) {
        if (!negatedDirective(text, match, code)) add(rule, code, path, match[0]);
      }
    }
    for (const claim of numericTimeClaims(text)) add("C16", "NUMERIC_TIME_BUDGET", path, claim.trim());
    // C19: older FULL/COMPACT text never outranks the current owner method.
    if (/fully in force/i.test(text) && !METHOD_PRECEDENCE.test(text)) {
      add("C19", "FULL_IN_FORCE_WITHOUT_METHOD_PRECEDENCE", path, "fully in force");
    }
  }

  // C19: the hot-reload method reference is present (FULL capsule, COMPACT reminder).
  const method = e.responseContract?.methodControl;
  if (compact) {
    if (typeof method !== "string" || !/always-fetch/i.test(method) || !method.includes(GFW_SLICING_METHOD_ID)) {
      add("C19", "COMPACT_METHOD_REMINDER_MISSING", "responseContract.methodControl");
    }
  } else if (!method || typeof method !== "object" ||
      method.methodId !== GFW_SLICING_METHOD_ID ||
      !GFW_ALWAYS_FETCH_OWNERS.every((owner) => method.alwaysFetchOwners?.includes(owner))) {
    add("C19", "METHOD_CONTROL_MISSING", "responseContract.methodControl");
  }

  // C01/C03/C04/C05/C06: the slicing statement is present and built from the
  // exact queue counters.
  const slicing = e.control?.interactionSlicing;
  if (!slicing || slicing.methodId !== GFW_SLICING_METHOD_ID) {
    add("C01", "SLICING_CAPSULE_MISSING", "control.interactionSlicing");
  }
  const wq = e.control?.workQueue;
  const hint = wq ? String(wq.planningHint || "") : String(slicing?.planningHint || "");
  if (!/one bounded coherent slice/i.test(hint)) add("C01", "BOUNDED_SLICE_STATEMENT_MISSING", wq ? "control.workQueue.planningHint" : "control.interactionSlicing.planningHint");
  if (!/progressionEnvelopeRef/.test(hint)) add("C05", "ENVELOPE_CONTINUITY_MISSING", "planningHint");
  if (wq) {
    // Compared with the same normalization the hint is built with, so edge
    // counters (e.g. a quantum lowered below the completed count) never fail.
    const expected = interactionPosition(wq);
    const position = hint.match(/^This is interaction (\d+) of (\d+) in the current queue-slot quantum \((\d+) including this turn remain\)\./);
    if (!position) {
      add("C03", "POSITION_STATEMENT_MISSING", "control.workQueue.planningHint");
    } else if (Number(position[1]) !== expected.interactionInQuantum ||
        Number(position[2]) !== expected.maxInteractions ||
        Number(position[3]) !== expected.remainingInteractionsIncludingCurrent) {
      add("C03", "POSITION_NOT_FROM_QUEUE_COUNTERS", "control.workQueue.planningHint", position[0]);
    }
    const role = String(slicing?.role || "");
    const checkpointRole = [INTERACTION_ROLES.FINAL, INTERACTION_ROLES.WINDOW_CHECKPOINT, INTERACTION_ROLES.ONLY].includes(role);
    if ((wq.finalInteractionInQuantum === true || wq.checkpointRequired === true) !== checkpointRole) {
      add("C04", "ROLE_NOT_FROM_QUEUE_COUNTERS", "control.interactionSlicing.role", role);
    }
    if (checkpointRole && !/not mission completion/.test(hint)) add("C04", "CHECKPOINT_NOT_DISTINGUISHED_FROM_DONE", "control.workQueue.planningHint");
    if (Number(wq.remainingInteractionsIncludingCurrent) > 1 && !/later interactions as execution depth/i.test(hint)) {
      add("C01", "EXECUTION_DEPTH_STATEMENT_MISSING", "control.workQueue.planningHint");
    }
    if (role === INTERACTION_ROLES.MIDDLE && !/do not replan the frontier/i.test(hint)) add("C06", "SAME_QUANTUM_CONTINUITY_MISSING", "control.workQueue.planningHint");
    if (!compact && !/not a number of phases/i.test(String(wq.quantumRule || ""))) add("C02", "QUANTUM_RULE_PHASES_CLAUSE_MISSING", "control.workQueue.quantumRule");
  }

  // C07: a prompt after an unanswered prompt carries the unknown-effect rule.
  const rotation = e.continuity?.sessionRotation;
  if (rotation && ["PROMPT_ACKNOWLEDGED_NO_COMPLETED_RESPONSE", "PROMPT_EFFECT_UNKNOWN", "PROMPT_BLOCKED_BY_PROVIDER"].includes(String(rotation.sourceResponseState || "")) &&
      !/effects are unknown/i.test(String(rotation.unknownEffectRule || ""))) {
    add("C07", "UNKNOWN_EFFECT_RULE_MISSING", "continuity.sessionRotation");
  }

  // C12/C14: local analysis is labelled optional advisory.
  if (!compact && e.sender?.presentation) {
    if (!/optional and advisory/i.test(String(e.sender.presentation.policy || ""))) add("C14", "LOCAL_ANALYSIS_NOT_OPTIONAL", "sender.presentation.policy");
    if ((e.sender.presentation.loop || []).some((step) => ["NANO", "HJALMAR_D2"].includes(step))) add("C12", "MANDATORY_ANALYSIS_STEP", "sender.presentation.loop");
  }

  // C16: the stale-session watchdog text is labelled as Greenfield's own.
  const stale = e.responseContract?.queueControl?.staleSessionSemantics;
  if (typeof stale === "string" && !/not a provider limit and not a response-time budget/.test(stale)) {
    add("C16", "WATCHDOG_NOT_LABELLED", "responseContract.queueControl.staleSessionSemantics");
  }

  // C18: no new response root fields for slicing.
  const properties = e.responseContract?.jsonSchema?.properties;
  if (properties && typeof properties === "object") {
    for (const key of Object.keys(properties)) {
      if (!ALLOWED_RESPONSE_ROOT_FIELDS.has(key)) add("C18", "UNSUPPORTED_RESPONSE_ROOT_FIELD", `responseContract.jsonSchema.properties.${key}`, key);
    }
  }

  return {
    schema: PROMPT_LINT_SCHEMA,
    ok: findings.length === 0,
    findings,
    overpackGuardFired: e.control?.interactionSlicing?.objectiveGuard?.overpackSuspected === true
  };
}
