import { normalizeWhitespace, sanitizeText } from "./common.mjs";

const META_ONLY = /\b(?:audit(?:era|ering)?|review|inspect|preflight|verify|verifiera|verifiering|check|kontroll(?:era|ering)?|gransk(?:a|ning)?|läs(?:a|ning)?|read|analysera|analysis|bedöm(?:a|ning)?)\b/i;
const META_PREFIX = /^(?:audit(?:era)?|review|inspect|preflight|verify|verifiera|check|kontrollera|granska|läs|read|analysera|bedöm)\b/i;
const EXACT_LOCATOR = /(?:\b[a-f0-9]{7,64}\b|\b(?:issue|pr|tab|artifact|turn|run|request|receipt|workspace)[- #:]?[a-z0-9_-]{2,}\b|(?:^|[\s"'`])(?:\.{0,2}\/|\/)[^\s"'`]+|\b[\w-]+\.(?:js|mjs|cjs|json|md|html|css|ts|tsx|jsx|py|sql|yaml|yml)\b|\b[\w-]+(?:\.[\w-]+){1,}\b|\b[\w$]+\([^)]*\)|\b[a-z][a-z0-9_]{5,}\b|\b[a-z_]+=[a-z0-9_-]+\b)/i;
// v0.6.4: the target session answers in Swedish, so Swedish implementation verbs
// must be recognised as concrete effects. A missing verb here silently turns a real
// engineering action into META_ONLY, which zeroes deterministic progress and starts
// an anti-loop replan storm. Extending this list is loop-safe: it can only reduce
// false META_ONLY, never grant new authority.
const CONCRETE_EFFECT = /\b(?:implementera|patcha|ändra|skriv|skapa|kör|exekvera|utför|genomför|dispatch(?:a)?|anropa|invoke|call|överlämna|handoff|terminalisera|släpp|frigör|återuppta|resume|uppdatera|ersätt|ta bort|lägg till|leverera|returnera|rapportera|mät|jämför|hasha|persist|readback|diff|testlogg|exit status|sha-?256|reconcile|recreate|create|publish|materialize|restore|rebuild|prepare|stage|apply|commit|branch|rekonstruera|återskapa|återställ(?:a)?|reparera|bygg(?:a|er)?|kompilera|generera|producera|montera|installera|konfigurera|initiera|migrera|extrahera|packa|paketera|exportera|importera|kopiera|flytta|byt(?:a)?|sätt(?:a)?|frys(?:a)?|freeze|lås(?:a)?|signera|tagga|arkivera|publicera|republicera|submit(?:ta|ted)?|poll(?:a)?|push(?:a)?|merge|rebase|checkout|chmod|snapshot(?:a)?|spegla|synka|sync|seal|emit|write|patch|deploy|render|render(?:a)?)\b/i;
const OBSERVABLE_OUTPUT = /\b(?:readback|status|result|resultat|output|utdata|hash|digest|checksum|manifest|commit|branch|receipt|kvitto|locator|delta|diff|log|logg|exit status|http\s*\d{3}|true|false|parity|match|mismatch|mode|permission|write-?bits|postimage|path(?:s)?|sha)\b/i;

function textList(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => sanitizeText(typeof item === "string" ? item : item?.claim || item?.text, 1600))
    .filter(Boolean);
}

export function isMetaOnlyAction(value) {
  const text = normalizeWhitespace(value);
  if (!text || !META_ONLY.test(text)) return false;
  if (/^(?:läs|read|verifiera|verify|kontrollera|check|granska|review)\s+(?:target[- ]?claims?|målsessionens påståenden)$/i.test(text)) {
    return true;
  }
  if (META_PREFIX.test(text)) {
    return !(EXACT_LOCATOR.test(text) && (CONCRETE_EFFECT.test(text) || OBSERVABLE_OUTPUT.test(text)));
  }
  return !CONCRETE_EFFECT.test(text);
}

export function continuityIsGrounded(projection = {}) {
  return Boolean(
    sanitizeText(projection.intent, 6000) &&
    (
      sanitizeText(projection.position?.workUnit, 2400) ||
      textList(projection.verifiedFacts).length ||
      textList(projection.targetClaims).length ||
      textList(projection.inferences).length
    )
  );
}

/**
 * The only decision action that can ever author and deliver a prompt to the target
 * session is CONTINUE. `background.js` enforces this with a hard
 * `if (effectiveAction !== "CONTINUE") throw` before any turn is compiled, and the
 * takeover-specific PAUSE guard (`nanoGroundingRequired`) independently blocks an
 * ungrounded takeover from being replanned into a CONTINUE.
 *
 * v0.6.9 nevertheless applied the *prompt-safety* requirements — task intent, work
 * unit and takeover context — to PAUSE and DONE as well. That made the deterministic
 * takeover recovery self-invalidating: `buildDeterministicDecision()` emitted a PAUSE
 * with empty intent/workUnit/context by design, `validateDecisionGrounding()` rejected
 * it with TASK_INTENT_EMPTY, WORK_UNIT_EMPTY, TAKEOVER_CONTEXT_EMPTY, and
 * `repairDeterministicDecision()` refused it with NOT_REPAIRABLE_CONTINUE because the
 * action was not CONTINUE. The run then entered RECOVERING behind a resume plan that
 * required a changed target response the addon deliberately never triggers: a terminal
 * livelock (field incident 2026-08-02, window 1974094030).
 *
 * v0.7.0 scopes the grounding requirements to prompt-authoring actions and gives
 * PAUSE/DONE their own, correct obligations. This cannot weaken the "never send an
 * ungrounded or generic target prompt" invariant, because the requirements still apply
 * in full to every action that can produce a prompt.
 */
export const PROMPT_AUTHORING_ACTIONS = Object.freeze(["CONTINUE"]);

export function authorsTargetPrompt(action) {
  return PROMPT_AUTHORING_ACTIONS.includes(String(action || "").toUpperCase());
}

export function validateDecisionGrounding(decision = {}, projection = {}, {
  takeover = false
} = {}) {
  const errors = [];
  const action = String(decision.action || "").toUpperCase();
  const authoring = authorsTargetPrompt(action);
  const taskIntent = sanitizeText(decision.taskIntent || projection.intent, 6000);
  const workUnit = sanitizeText(decision.workUnit || projection.position?.workUnit, 2400);
  const requestedAction = sanitizeText(decision.requestedAction, 5000);
  const targetClaims = textList(decision.targetClaims);
  const inferences = textList(decision.inferences);
  const contextEvidence = textList(decision.contextEvidence);
  const verifiedFacts = textList(projection.verifiedFacts);
  const requiredEvidence = textList(decision.requiredEvidence);
  const groundedContextCount = targetClaims.length + inferences.length + contextEvidence.length + verifiedFacts.length;

  if (authoring) {
    if (!taskIntent) errors.push("TASK_INTENT_EMPTY");
    if (!workUnit) errors.push("WORK_UNIT_EMPTY");
    if (!requestedAction) errors.push("REQUESTED_ACTION_EMPTY");
    if (isMetaOnlyAction(requestedAction)) errors.push("META_ONLY_ACTION");
    if (takeover && groundedContextCount === 0) errors.push("TAKEOVER_CONTEXT_EMPTY");
    if (!continuityIsGrounded(projection) && !takeover && groundedContextCount === 0) {
      errors.push("UNGROUNDED_CONTINUATION");
    }
  } else if (action === "PAUSE") {
    // A PAUSE delivers nothing to the target. Its obligation is to state a boundary
    // an operator or a later autonomous pass can act on, not to be grounded as if it
    // were a prompt.
    if (!sanitizeText(decision.reason, 1600)) errors.push("PAUSE_REASON_EMPTY");
    if (!sanitizeText(decision.pauseOrigin, 120)) errors.push("PAUSE_ORIGIN_EMPTY");
  } else if (action === "DONE") {
    if (!sanitizeText(decision.completionEvidence, 1600)) errors.push("COMPLETION_EVIDENCE_EMPTY");
  } else if (!action) {
    errors.push("ACTION_EMPTY");
  }

  if (requiredEvidence.some((item) => /^(?:targetClaims?|target claims?|målsessionens påståenden)$/i.test(normalizeWhitespace(item)))) {
    errors.push("NAKED_TARGETCLAIMS_EVIDENCE");
  }
  return {
    valid: errors.length === 0,
    errors,
    action,
    authorsTargetPrompt: authoring,
    taskIntent,
    workUnit,
    requestedAction,
    groundedContextCount
  };
}


export function deriveDeterministicProgress({
  priorResponseHash = "",
  currentResponseHash = "",
  requestedAction = "",
  priorWorkUnit = "",
  workUnit = "",
  targetResult = null
} = {}) {
  const changedResponse = Boolean(currentResponseHash && currentResponseHash !== priorResponseHash);
  const concreteAction = Boolean(sanitizeText(requestedAction, 5000)) && !isMetaOnlyAction(requestedAction);
  const changedWorkUnit = Boolean(
    sanitizeText(workUnit, 2400) &&
    normalizeWhitespace(workUnit).toLowerCase() !== normalizeWhitespace(priorWorkUnit).toLowerCase()
  );
  const targetStatus = String(targetResult?.status || "").toUpperCase();
  const targetNextIsConcrete = Boolean(
    targetResult?.valid &&
    targetStatus === "CONTINUE" &&
    sanitizeText(targetResult?.next, 5000) &&
    !isMetaOnlyAction(targetResult.next)
  );
  const targetDoneHasEvidence = Boolean(
    targetResult?.valid &&
    targetStatus === "DONE" &&
    sanitizeText(targetResult?.completionEvidence, 1600)
  );
  // Progress is owned by a changed target observation plus a valid turn-bound
  // target contract. Nano-authored progressDelta, action wording and work-unit
  // changes remain telemetry and can never reset the loop counter by themselves.
  const contractProgress = targetNextIsConcrete || targetDoneHasEvidence;
  const value = changedResponse && contractProgress ? 1 : 0;
  return {
    value,
    changedResponse,
    concreteAction,
    changedWorkUnit,
    targetNextIsConcrete,
    targetDoneHasEvidence,
    contractProgress
  };
}

export function canTerminateRun(decision = {}, { targetResult = null } = {}) {
  const decisionEvidence = sanitizeText(decision.completionEvidence, 1600);
  const targetEvidence = sanitizeText(targetResult?.completionEvidence, 1600);
  const targetStatus = String(targetResult?.status || "").toUpperCase();
  const terminalContract = targetStatus === "DONE";
  return decision.completionConfirmed === true &&
    Boolean(decisionEvidence) &&
    String(decision.completionScope || "WORK_UNIT").toUpperCase() === "STABLE_GOAL" &&
    targetResult?.valid === true &&
    terminalContract &&
    Boolean(targetEvidence);
}

export const COMPLETION_DISPOSITIONS = Object.freeze({
  TERMINATE_STABLE_GOAL: "TERMINATE_STABLE_GOAL",
  CONTINUE_NEXT_WORK_UNIT: "CONTINUE_NEXT_WORK_UNIT",
  PAUSE_NEXT_WORK_UNIT_REQUIRED: "PAUSE_NEXT_WORK_UNIT_REQUIRED"
});

export function resolveCompletionDisposition(decision = {}, context = {}) {
  const programNextAction = sanitizeText(
    context.programNextAction || decision.requestedAction,
    5000
  );
  // A finished work unit never terminates a broader program while one concrete next
  // action remains. This check deliberately precedes stable-goal termination so a
  // target/model DONE cannot hide known remaining work.
  if (programNextAction) {
    return COMPLETION_DISPOSITIONS.CONTINUE_NEXT_WORK_UNIT;
  }
  if (canTerminateRun(decision, context)) {
    return COMPLETION_DISPOSITIONS.TERMINATE_STABLE_GOAL;
  }
  return COMPLETION_DISPOSITIONS.PAUSE_NEXT_WORK_UNIT_REQUIRED;
}
