import { text } from "./common.mjs";

// v1.8.0 EIC Learning & Continuity Control.
//
// Prompt extension only. Three layers:
//   A. EIC_LEARNING_CONTROL_CONTRACT: self-contained definitions and rules, in
//      every FULL prompt. The receiving model is assumed to know nothing about
//      EIC beyond this contract and live backend responses.
//   B. EIC_LEARNING_CONTEXT (learningControlContext): per-prompt obligations
//      decided deterministically by Greenfield from lifecycle facts it already
//      owns, plus the previous learning result. In FULL and COMPACT prompts.
//   C. Learning closure: REQUIRED at the end of a quantum and whenever the
//      response ends a substantive work block.
// Greenfield performs no AIK / Operator Learning / Memory calls itself; the
// receiving EIC session executes the checks with its own tools and reports a
// structured learningControl result that Greenfield carries forward.

export const LEARNING_CONTEXT_SCHEMA = "eic.greenfield.learning-context.v1";
export const LEARNING_CONTRACT_SCHEMA = "eic.greenfield.learning-contract.v1";
export const LEARNING_RESULT_FIELD = "learningControl";
export const LEARNING_RESULT_MAX_JSON_CHARS = 8000;

export const LEARNING_KEYPOINTS = Object.freeze({
  START_RESUME_AFTER_OWNER_BOOTSTRAP: "START_RESUME_AFTER_OWNER_BOOTSTRAP",
  PRE_MATERIAL_R2_EFFECT: "PRE_MATERIAL_R2_EFFECT",
  POST_FAILURE_FALSE_BLOCKER_UNKNOWN_EFFECT_RECOVERY: "POST_FAILURE_FALSE_BLOCKER_UNKNOWN_EFFECT_RECOVERY",
  RECURRING_SOFT_BLOCKER_OR_FAILURE_FAMILY: "RECURRING_SOFT_BLOCKER_OR_FAILURE_FAMILY",
  MAJOR_REPLAN_OR_SCOPE_DRIFT_RISK: "MAJOR_REPLAN_OR_SCOPE_DRIFT_RISK",
  CHECKPOINT_HANDOFF_STOP_OR_TERMINAL_CLOSE: "CHECKPOINT_HANDOFF_STOP_OR_TERMINAL_CLOSE"
});

export const OBLIGATION = Object.freeze({
  REQUIRED: "REQUIRED",
  FRESH_RESULT_REUSABLE: "FRESH_RESULT_REUSABLE",
  REQUIRED_AT_DECLARED_KEYPOINT: "REQUIRED_AT_DECLARED_KEYPOINT",
  REQUIRED_ON_TRIGGER: "REQUIRED_ON_TRIGGER",
  REQUIRED_WHEN_ENDING_WORK_BLOCK: "REQUIRED_WHEN_ENDING_WORK_BLOCK",
  REQUIRED_BEFORE_ACTING_ON_RETAINED_LEARNING: "REQUIRED_BEFORE_ACTING_ON_RETAINED_LEARNING"
});

const AIK_DISCOVERY_OUTCOMES = Object.freeze([
  "DISCOVERY_HIT_USED",
  "DISCOVERY_HIT_NOT_APPLICABLE",
  "DISCOVERY_NO_HIT",
  "DISCOVERY_UNAVAILABLE_SCOPED",
  "FRESH_DISCOVERY_REUSED"
]);
const AIK_CONTINUITY_OUTCOMES = Object.freeze([
  "NOT_TRIGGERED",
  "WRITE_LEARNED",
  "WRITE_STREAM",
  "REVISE_EXISTING",
  "NO_WRITE_WRONG_OWNER",
  "NO_WRITE_DUPLICATE",
  "NO_WRITE_TRANSIENT",
  "NO_WRITE_LOW_VALUE",
  "NO_WRITE_SENSITIVE"
]);
const KAIZEN_OUTCOMES = Object.freeze([
  "NOT_AT_KEYPOINT",
  "APPLICABLE_DELTA",
  "NO_APPLICABLE_LESSON",
  "ALREADY_COVERED",
  "NO_DURABLE_LEARNING",
  "RETRIEVAL_UNAVAILABLE_SCOPED",
  "FRESH_CHECK_REUSED"
]);
const OPERATOR_LEARNING_OUTCOMES = Object.freeze([
  "NOT_AT_KEYPOINT",
  "CHECK_EXECUTED_APPLICABLE",
  "CHECK_EXECUTED_NOT_APPLICABLE",
  "NO_LESSONS",
  "RETRIEVAL_UNAVAILABLE_SCOPED",
  "FRESH_CHECK_REUSED"
]);
const SELF_LEARN_CLOSURES = Object.freeze([
  "NOT_AT_CLOSURE",
  "NO_DURABLE_LEARNING",
  "ALREADY_COVERED",
  "MEMORY_WRITE",
  "PROJECT_MEMORY_WRITE",
  "PROJECT_CHRONOLOGY_ONLY",
  "REPO_OWNER_WRITE",
  "GLOBAL_SKILL_UPDATE_CANDIDATE",
  "OPERATOR_LEARNING_CANDIDATE",
  "METHOD_IMPROVEMENT_CANDIDATE",
  "SUPERSEDE_EXISTING_LESSON"
]);

// ---------------------------------------------------------------------------
// Layer A: static contract (FULL prompts).

export const EIC_LEARNING_CONTROL_CONTRACT = Object.freeze({
  schema: LEARNING_CONTRACT_SCHEMA,
  title: "EIC LEARNING & CONTINUITY CONTROL CONTRACT",
  baseline: [
    "You have no built-in knowledge of EIC.",
    "Do not assume that terms such as AIK, Self-learn, Kaizen, Operator Learning, Memory, Project owner, or owner truth have their generic meanings.",
    "Use only the definitions and runtime context supplied in this contract, in control.learningControl, and in live EIC backend responses. Do not infer undocumented EIC behavior."
  ],
  ownerTruthModel: [
    "EIC uses explicit semantic owners.",
    "Current mutable facts are owned by their factual owner: Project state -> Project owner; Repository/source -> Repo/Git owner; Runtime/process/deployment -> Runtime/Infra owner; Artifact content -> Artifact owner; Effects/writes -> Effect owner and readback.",
    "Retained-learning systems may influence METHOD and INTERPRETATION. They never replace current owner truth.",
    "Retained learning may change how you work, but it never replaces fresh owner truth about mutable facts.",
    "If retained context conflicts with a fresh factual owner: THE FACTUAL OWNER WINS. Example: if AIK says a service runs but the runtime owner says it is stopped, the runtime owner wins.",
    "Never claim PASS/COMPLETE/APPLIED/PERSISTED from your own text. Use owner readback where the operation requires it."
  ],
  surfaces: {
    AIK_LEARNED: {
      is: "Scope-bound AI-to-AI cross-session continuity knowledge with stable identity, scope, provenance and lifecycle.",
      usedFor: "Compact reusable knowledge, rationale, invariants and continuation knowledge a fresh session needs.",
      isNot: "Current runtime truth, project current state, authorization, a generic transcript store, or a reason to skip factual-owner reads."
    },
    AIK_STREAM: {
      is: "Event-like continuity breadcrumb channel.",
      usedFor: "Sequence, provenance and transitions where time order matters.",
      isNot: "A project diary for everything, and not an automatic fallback when AIK Learned has no hit."
    },
    SELF_LEARN: {
      is: "The routing/governance layer for retained context and durable learning. It is not one storage system.",
      usedFor: "Deciding when retained context must be read and where durable learning belongs (closure routing).",
      isNot: "A database of its own, and not a license to write memory."
    },
    KAIZEN: {
      is: "Method-improvement cycle from real evidence: STANDARD -> DO -> CHECK -> LEARN -> STANDARDIZE_OR_SUPERSEDE -> REUSE_VERIFY.",
      usedFor: "Changing standard work at declared keypoints when evidence shows a better method.",
      isNot: "Writing a lesson after every prompt."
    },
    OPERATOR_LEARNING: {
      is: "Evidence-bound durable operational-method lessons.",
      usedFor: "Reusable execution and failure-prevention methods.",
      isNot: "General project status or user memory. An active lesson is not proof that runtime behavior changed."
    },
    MEMORY: {
      is: "Durable semantic user/project context.",
      usedFor: "Stable user preferences, workstyle, durable project rules, aliases and recurring semantic constraints.",
      isNot: "Proof of current runtime state, project status, repo state or artifact contents."
    },
    PROJECT_CHRONOLOGY: {
      is: "The project's factual chronology.",
      usedFor: "What happened, decisions, problems, milestones.",
      isNot: "A general cross-project lesson store."
    },
    GLOBAL_SKILL: {
      is: "System-wide canonical EIC behavior.",
      usedFor: "Portable EIC rules that genuinely apply broadly.",
      isNot: "An incident log."
    },
    REPO_RUNTIME_INFRA_OWNER: {
      is: "The actual current truth.",
      usedFor: "Code, process, deployment, server, config, effects.",
      isNot: "Something AIK or Memory may replace."
    }
  },
  aik: [
    "For non-trivial continuation of a known active project/subject, a bounded exact-scope AIK Learned discovery is REQUIRED unless an equivalent fresh result from the same work block already exists. Use the exact project scope and a compact subject query (for example aik.learned.search). Do not dump broad history, all AIK records, AIK Stream as automatic fallback, or a global search 'for safety'.",
    "Valid discovery outcomes: DISCOVERY_HIT_USED, DISCOVERY_HIT_NOT_APPLICABLE, DISCOVERY_NO_HIT, DISCOVERY_UNAVAILABLE_SCOPED, FRESH_DISCOVERY_REUSED. Silent omission is NON_CONFORMANT.",
    "Interpret every AIK Learned record you use as: what it is (id, canonical key, title, scope, status) -> why it matters -> when it applies -> the compact knowledge -> owner locators -> freshness boundary (continuity context; re-read current repo/runtime truth before acting) -> recommended use -> authority boundary (AIK grants no permission and is not current runtime truth).",
    "After a material discovery, invariant, failure mode, non-obvious rationale, unresolved risk, continuation dependency, handoff, phase transition or closure, run AIK_CONTINUITY_OPPORTUNITY_CHECK: (1) Would a competent fresh EIC/GFW session materially benefit after the current session disappears? (2) Is this continuity knowledge rather than mutable state better owned by Project, Repo, Runtime, Memory or Operator Learning? (3) Can scope, provenance, owner locators and freshness limits be stated? (4) Does an equivalent active AIK record already exist?",
    "Positive outcomes: WRITE_LEARNED, WRITE_STREAM, REVISE_EXISTING. Negative outcomes: NO_WRITE_WRONG_OWNER, NO_WRITE_DUPLICATE, NO_WRITE_TRANSIENT, NO_WRITE_LOW_VALUE, NO_WRITE_SENSITIVE. A no-write result is valid AFTER the check. There is no valid 'not evaluated'. Do not create AIK records merely to prove the check happened.",
    "Deduplicate before any AIK Learned or Memory write: search the same semantic identity; same rule exists -> NO_WRITE_DUPLICATE; older weaker rule exists -> revise/supersede; conflicting active rule exists -> reconcile first; only then write new. Prefer one good canonical Learned record over many near-duplicate observations.",
    "After any persistence, require AIK owner readback before claiming the record was stored."
  ],
  selfLearn: [
    "At the end of every substantive work block, material correction, failure/recovery, handoff, or phase transition, LEARNING CLOSURE is REQUIRED. Do not ask whether you learned something; classify the work block.",
    "Classify exactly one of: NO_DURABLE_LEARNING, ALREADY_COVERED, MEMORY_WRITE, PROJECT_MEMORY_WRITE, PROJECT_CHRONOLOGY_ONLY, REPO_OWNER_WRITE, GLOBAL_SKILL_UPDATE_CANDIDATE, OPERATOR_LEARNING_CANDIDATE, METHOD_IMPROVEMENT_CANDIDATE, SUPERSEDE_EXISTING_LESSON. Perform the canonical write when the classification requires one.",
    "Route the information to exactly one canonical semantic owner unless the semantics are genuinely different. Do not write transient project/runtime state into personal Memory. Do not duplicate the same lesson into AIK + Memory + Operator Learning merely for redundancy."
  ],
  routing: [
    { information: "This user prefers X", canonicalOwner: "Memory / user profile" },
    { information: "Project N is now at commit X", canonicalOwner: "Project/repo owner" },
    { information: "This happened in this run", canonicalOwner: "Project chronology / runtime receipt" },
    { information: "The next AI session must know this rationale/invariant", canonicalOwner: "AIK Learned" },
    { information: "This is a provenance/sequence breadcrumb", canonicalOwner: "AIK Stream" },
    { information: "This method prevents a recurring operational failure", canonicalOwner: "Operator Learning candidate" },
    { information: "This improves the EIC method generally", canonicalOwner: "Self-learn -> canonical Global Skill candidate" },
    { information: "The repo must always do X because of its API", canonicalOwner: "Repo/code owner" },
    { information: "Current server status is X", canonicalOwner: "Runtime/infra owner, not a learning store" }
  ],
  kaizen: [
    "Declared mandatory keypoints: START_RESUME_AFTER_OWNER_BOOTSTRAP (new session, new quantum or real resume); PRE_MATERIAL_R2_EFFECT (before a material but controllable change); POST_FAILURE_FALSE_BLOCKER_UNKNOWN_EFFECT_RECOVERY (after failure, false blocker or unknown effect); RECURRING_SOFT_BLOCKER_OR_FAILURE_FAMILY (the same problem family returns); MAJOR_REPLAN_OR_SCOPE_DRIFT_RISK (larger replanning or scope shift); CHECKPOINT_HANDOFF_STOP_OR_TERMINAL_CLOSE (handoff, checkpoint, stop or closure).",
    "At each declared keypoint execute one bounded retained-learning check, or reuse an equivalent fresh check from the same work block. You are not allowed to silently decide that learning is 'probably unnecessary'.",
    "Valid keypoint outcomes: APPLICABLE_DELTA, NO_APPLICABLE_LESSON, ALREADY_COVERED, NO_DURABLE_LEARNING, RETRIEVAL_UNAVAILABLE_SCOPED.",
    "If a lesson is APPLICABLE, state the concrete METHOD / ROUTING / CONTROL delta you will apply BEFORE continuing (KAIZEN_APPLICATION: keypoint, retrieved lesson, applicability, execution_delta, owner_refresh_required, effect). Then re-read current mutable truth from the actual factual owner. Retained learning changes method; it does not prove current facts.",
    "When an applied lesson later proves wrong or too broad, narrow, supersede or retire it instead of accumulating contradictions."
  ],
  operatorLearning: [
    "READ: at a Kaizen keypoint, use bounded natural-language retrieval of relevant active lessons (for example operator.learning.retrieve) when Operator Learning is available. Reading at keypoints is a normal bounded operation.",
    "For each retrieved lesson classify APPLICABLE or NOT_APPLICABLE. Interpret it as: applies_when -> method_delta (what you will concretely do differently) -> must_not_change (authorization boundaries, owner-truth requirements, claim strength) -> evidence basis -> current relevance. The lesson changes method only; fresh current state must still be read from the actual owner.",
    "WRITE: do NOT create lessons for routine success, one-off transient errors (for example 'retry when timeout') or generic 'quality improvement'. A durable lesson is normally justified only when the human explicitly requests a reusable operational lesson, OR at least two owner-verified occurrences establish the same material reusable failure pattern, OR one critical owner-verified failure has a concrete reusable prevention rule. Retrieve existing lessons before creating a new one.",
    "Application claims require the appropriate evidence/application receipt where the backend supports it."
  ],
  memory: [
    "Memory is durable semantic context, not live state. Use it for stable user preferences, workstyle, durable project rules, aliases and recurring semantic constraints.",
    "Do not use Memory as proof of current runtime state, project status, repo state or artifact contents. Current facts must be re-read from their owner."
  ],
  threeM: [
    "When a material process defect is already visible, classify it if useful: MUDA (work/control/retrieval that consumes effort without changing decision, owner truth, safety or durable value); MURA (materially equivalent situations receive inconsistent method, routing, continuation or claim behavior); MURI (context/tool/control/executor load is unnecessarily excessive and raises truncation/recovery/operator burden).",
    "Do not run a broad 3M audit on every prompt."
  ],
  origin: [
    "Do not infer HUMAN_OPERATOR merely because the same account/user is used.",
    "Origin kinds: HUMAN_OPERATOR, GREENFIELD_AUTONOMOUS, OPERATOR_DELEGATED_AUTONOMY, SYSTEM, IMPORTED, UNKNOWN.",
    "Greenfield autonomous work remains GREENFIELD_AUTONOMOUS unless owner evidence says otherwise; control.learningControl.origin states the origin of this prompt."
  ],
  dynamicContext: [
    "control.learningControl (EIC_LEARNING_CONTEXT) is present in every Greenfield prompt, FULL or COMPACT. It states the project scope, the keypoints Greenfield detected for this prompt with their triggers, the obligation for each check, carried-over obligations and the previous learning result.",
    "Obligation values: REQUIRED = execute now (or reuse a fresh equivalent result and say so). FRESH_RESULT_REUSABLE = an executed result from this same work block exists; report FRESH_DISCOVERY_REUSED unless the situation changed materially. REQUIRED_AT_DECLARED_KEYPOINT / REQUIRED_ON_TRIGGER / REQUIRED_WHEN_ENDING_WORK_BLOCK = becomes REQUIRED the moment the standing trigger below occurs during this turn. REQUIRED_BEFORE_ACTING_ON_RETAINED_LEARNING = re-read the factual owner before acting on any retained learning.",
    "Treat REQUIRED checks as execution obligations. NO_HIT, NO_APPLICABLE, ALREADY_COVERED and NO_WRITE are valid results after the check executes. Silent skip is never a valid result.",
    "An obligation listed in control.learningControl.carriedOverObligations was REQUIRED in the previous prompt but not reported in its response; execute it now or report the scoped unavailable outcome.",
    "Auxiliary learning failure must not stop unrelated R0/R1 work: if a learning route is unavailable, report the scoped unavailable outcome and continue safe work."
  ],
  standingTriggers: {
    PRE_MATERIAL_R2_EFFECT: "Before any material but controllable (R2) effect in this turn, run the bounded Kaizen/Operator Learning check first or reuse a fresh one from this work block.",
    MAJOR_REPLAN_OR_SCOPE_DRIFT_RISK: "If you are about to replan materially or shift scope, you have reached this keypoint: run the bounded check first.",
    RECURRING_SOFT_BLOCKER_OR_FAILURE_FAMILY: "If the same problem family returns, you have reached this keypoint even if Greenfield has not detected it yet.",
    AIK_CONTINUITY_CHECK: "After a material discovery, invariant, failure mode, non-obvious rationale, unresolved risk, continuation dependency, handoff or phase transition.",
    SELF_LEARN_CLOSURE: "If this response returns status DONE or BLOCKED, or sessionAction YIELD_TO_QUEUE, PAUSE_PROCESS, BACKGROUND_SLEEP, STOP_PROCESS or ROTATE_SESSION_NOW, or otherwise ends a substantive work block, it is at CHECKPOINT_HANDOFF_STOP_OR_TERMINAL_CLOSE: closure and the AIK continuity check are REQUIRED in this response."
  },
  rules: [
    "REQUIRED means you may not silently skip the check.",
    "NO_HIT / NO_APPLICABLE / ALREADY_COVERED / NO_WRITE are valid results after execution.",
    "Do not create learning records only to prove that a check occurred.",
    "Retained learning never replaces fresh factual-owner truth."
  ],
  closureOutput: [
    "Report the result in the optional top-level response field learningControl (schema in responseContract.jsonSchema.properties.learningControl) whenever any learning obligation applied to this response: keypoints reached; AIK discovery outcome and records consumed; AIK continuity check outcome and records written with readback status; Kaizen keypoint outcome and execution delta; Operator Learning retrieval outcome, lessons considered and method deltas; Self-learn closure classification and canonical owner; whether current factual owner truth was refreshed.",
    "This result is Greenfield observability/conformance data. Do not write it to AIK or any learning store merely because it exists. Do not fabricate ids, receipts or writes."
  ]
});

// ---------------------------------------------------------------------------
// Response field schema.

const shortString = (maxLength) => ({ type: "string", maxLength });

export const LEARNING_CONTROL_RESULT_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    keypoints: {
      type: "array",
      maxItems: 6,
      items: { type: "string", enum: Object.values(LEARNING_KEYPOINTS) }
    },
    aik: {
      type: "object",
      additionalProperties: false,
      properties: {
        discovery: { type: "string", enum: [...AIK_DISCOVERY_OUTCOMES] },
        recordsConsumed: {
          type: "array",
          maxItems: 10,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "applicability"],
            properties: {
              id: shortString(120),
              canonicalKey: shortString(200),
              applicability: { type: "string", enum: ["APPLICABLE", "NOT_APPLICABLE"] }
            }
          }
        },
        continuityCheck: { type: "string", enum: [...AIK_CONTINUITY_OUTCOMES] },
        recordsWritten: {
          type: "array",
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "kind", "readbackVerified"],
            properties: {
              id: shortString(120),
              kind: { type: "string", enum: ["LEARNED", "STREAM"] },
              readbackVerified: { type: "boolean" }
            }
          }
        }
      }
    },
    kaizen: {
      type: "object",
      additionalProperties: false,
      properties: {
        keypointOutcome: { type: "string", enum: [...KAIZEN_OUTCOMES] },
        executionDelta: shortString(1500)
      }
    },
    operatorLearning: {
      type: "object",
      additionalProperties: false,
      properties: {
        retrieval: { type: "string", enum: [...OPERATOR_LEARNING_OUTCOMES] },
        lessons: {
          type: "array",
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "applicability"],
            properties: {
              id: shortString(120),
              title: shortString(200),
              applicability: { type: "string", enum: ["APPLICABLE", "NOT_APPLICABLE"] },
              methodDelta: shortString(800)
            }
          }
        },
        executionDeltaApplied: { type: "boolean" }
      }
    },
    selfLearn: {
      type: "object",
      additionalProperties: false,
      properties: {
        closure: { type: "string", enum: [...SELF_LEARN_CLOSURES] },
        canonicalOwner: shortString(200),
        writeReadbackVerified: { type: ["boolean", "null"] }
      }
    },
    ownerTruthRefreshed: { type: "boolean" }
  }
});

// ---------------------------------------------------------------------------
// Response-side: accept and bound the reported result (no effects).

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function enumValue(value, allowed) {
  return typeof value === "string" && allowed.includes(value) ? value : "";
}

function list(value, max, map) {
  return Array.isArray(value) ? value.slice(0, max).filter(plainObject).map(map) : [];
}

/**
 * Normalize the optional learningControl response field into a bounded,
 * closed shape. Unknown keys and non-enum values are dropped; an oversize or
 * non-object value is kept only as a malformed marker. Never throws.
 */
export function normalizeLearningControlResult(raw) {
  if (raw === undefined || raw === null) return null;
  if (plainObject(raw) && raw.malformed === true) return { malformed: true };
  let size = Infinity;
  try {
    size = String(JSON.stringify(raw) ?? "").length;
  } catch {}
  if (!plainObject(raw) || size > LEARNING_RESULT_MAX_JSON_CHARS) {
    return { malformed: true };
  }
  const aik = plainObject(raw.aik) ? raw.aik : {};
  const kaizen = plainObject(raw.kaizen) ? raw.kaizen : {};
  const operatorLearning = plainObject(raw.operatorLearning) ? raw.operatorLearning : {};
  const selfLearn = plainObject(raw.selfLearn) ? raw.selfLearn : {};
  return {
    malformed: false,
    keypoints: Array.isArray(raw.keypoints)
      ? raw.keypoints.filter((item) => Object.values(LEARNING_KEYPOINTS).includes(item)).slice(0, 6)
      : [],
    aik: {
      discovery: enumValue(aik.discovery, AIK_DISCOVERY_OUTCOMES),
      recordsConsumed: list(aik.recordsConsumed, 10, (item) => ({
        id: text(item.id, 120),
        canonicalKey: text(item.canonicalKey, 200),
        applicability: enumValue(item.applicability, ["APPLICABLE", "NOT_APPLICABLE"])
      })),
      continuityCheck: enumValue(aik.continuityCheck, AIK_CONTINUITY_OUTCOMES),
      recordsWritten: list(aik.recordsWritten, 5, (item) => ({
        id: text(item.id, 120),
        kind: enumValue(item.kind, ["LEARNED", "STREAM"]),
        readbackVerified: item.readbackVerified === true
      }))
    },
    kaizen: {
      keypointOutcome: enumValue(kaizen.keypointOutcome, KAIZEN_OUTCOMES),
      executionDelta: text(kaizen.executionDelta, 1500)
    },
    operatorLearning: {
      retrieval: enumValue(operatorLearning.retrieval, OPERATOR_LEARNING_OUTCOMES),
      lessons: list(operatorLearning.lessons, 5, (item) => ({
        id: text(item.id, 120),
        title: text(item.title, 200),
        applicability: enumValue(item.applicability, ["APPLICABLE", "NOT_APPLICABLE"]),
        methodDelta: text(item.methodDelta, 800)
      })),
      executionDeltaApplied: operatorLearning.executionDeltaApplied === true
    },
    selfLearn: {
      closure: enumValue(selfLearn.closure, SELF_LEARN_CLOSURES),
      canonicalOwner: text(selfLearn.canonicalOwner, 200),
      writeReadbackVerified: typeof selfLearn.writeReadbackVerified === "boolean" ? selfLearn.writeReadbackVerified : null
    },
    ownerTruthRefreshed: raw.ownerTruthRefreshed === true
  };
}

/** Which obligations a normalized result reports as executed or reused. */
export function reportedLearningObligations(result) {
  if (!result || result.malformed) return new Set();
  const reported = new Set();
  if (result.aik.discovery) reported.add("AIK_DISCOVERY");
  if (result.aik.continuityCheck && result.aik.continuityCheck !== "NOT_TRIGGERED") reported.add("AIK_CONTINUITY_CHECK");
  if ((result.kaizen.keypointOutcome && result.kaizen.keypointOutcome !== "NOT_AT_KEYPOINT") ||
      (result.operatorLearning.retrieval && result.operatorLearning.retrieval !== "NOT_AT_KEYPOINT")) {
    reported.add("KAIZEN_RETRIEVAL");
  }
  if (result.selfLearn.closure && result.selfLearn.closure !== "NOT_AT_CLOSURE") reported.add("SELF_LEARN_CLOSURE");
  return reported;
}

// ---------------------------------------------------------------------------
// Layer B: deterministic keypoints and obligations.

const BOUNDARY_MESSAGE_TYPES = new Set(["MISSION_START", "MISSION_RESTORE", "SESSION_ROTATION"]);
const FOLLOW_UP_MESSAGE_TYPES = new Set(["CONTINUATION", "READ_REQUIRED"]);
const UNKNOWN_EFFECT_SOURCE_STATES = new Set(["PROMPT_ACKNOWLEDGED_NO_COMPLETED_RESPONSE", "PROMPT_EFFECT_UNKNOWN"]);
const FAILURE_DISPOSITIONS = new Set(["BLOCKED", "SESSION_UNRESPONSIVE"]);

/** "Projekt: 59 - EIC Backend / ELLM Backend - Gf: GF-002." -> project scope. */
export function missionLearningScope(goal) {
  const first = String(goal || "").split(/\r?\n/, 1)[0].trim();
  const match = first.match(/^Pro(?:jekt|ject)\s*:\s*(\d+)\s*[-–]\s*(.+?)(?:\s*[-–]\s*Gf\s*:\s*([A-Za-z0-9][A-Za-z0-9_-]*[A-Za-z0-9]))?\s*\.?\s*$/i);
  if (!match) {
    return { projectId: null, projectName: "", subject: "", source: "UNRESOLVED_RESOLVE_FROM_OWNER_STATE" };
  }
  return {
    projectId: Number(match[1]),
    projectName: match[2].trim(),
    subject: match[3] || "",
    source: "MISSION_HEADER"
  };
}

function previousResultSummary(result) {
  if (!result) return null;
  if (result.malformed) return { reported: true, malformed: true };
  return {
    reported: true,
    keypoints: result.keypoints,
    aikDiscovery: result.aik.discovery || "NOT_REPORTED",
    aikContinuityCheck: result.aik.continuityCheck || "NOT_REPORTED",
    aikRecordsConsumed: result.aik.recordsConsumed.slice(0, 5),
    aikRecordsWritten: result.aik.recordsWritten.slice(0, 5),
    kaizenOutcome: result.kaizen.keypointOutcome || "NOT_REPORTED",
    executionDelta: text(result.kaizen.executionDelta, 500),
    operatorLearningRetrieval: result.operatorLearning.retrieval || "NOT_REPORTED",
    applicableLessons: result.operatorLearning.lessons
      .filter((lesson) => lesson.applicability === "APPLICABLE")
      .slice(0, 3)
      .map((lesson) => ({ id: lesson.id, title: lesson.title, methodDelta: text(lesson.methodDelta, 400) })),
    selfLearnClosure: result.selfLearn.closure || "NOT_REPORTED",
    ownerTruthRefreshed: result.ownerTruthRefreshed
  };
}

/**
 * Build EIC_LEARNING_CONTEXT for one prompt. All inputs are facts Greenfield
 * already owns; nothing here depends on model judgement.
 */
export function buildLearningControlContext({
  process,
  messageType = "CONTINUATION",
  previousDisposition = "",
  analysisEvidence = null,
  sessionRotation = null,
  operatorInstruction = null,
  checkpointRequired = false
} = {}) {
  const ctx = process?.queueContext?.itemId ? process.queueContext : null;
  const scope = missionLearningScope(process?.goal);
  const subject = scope.subject || (ctx?.savedMissionId ? String(ctx.savedMissionId) : "GFW");
  const workBlockId = ctx
    ? `${subject}-s${Number(process?.sessionSeq || 1)}-a${Math.max(1, Number(ctx.activationCount || 0))}`
    : `${subject}-s${Number(process?.sessionSeq || 1)}`;

  const previousContext = process?.lastPrompt?.a2a?.control?.learningControl || null;
  const previousResult = normalizeLearningControlResult(process?.lastResponse?.contract?.value?.learningControl);
  const followUp = FOLLOW_UP_MESSAGE_TYPES.has(String(messageType || ""));

  // Deterministic keypoint detection from Greenfield lifecycle facts.
  const keypoints = [];
  const add = (keypoint, trigger) => {
    if (!keypoints.some((row) => row.keypoint === keypoint)) keypoints.push({ keypoint, trigger });
  };
  if (BOUNDARY_MESSAGE_TYPES.has(String(messageType || ""))) {
    add(LEARNING_KEYPOINTS.START_RESUME_AFTER_OWNER_BOOTSTRAP, `MESSAGE_TYPE_${messageType}`);
  } else if (ctx && Number(ctx.interactionCount || 0) === 0) {
    add(LEARNING_KEYPOINTS.START_RESUME_AFTER_OWNER_BOOTSTRAP, "NEW_QUEUE_QUANTUM");
  }
  const priorDisposition = String(previousDisposition || "").toUpperCase();
  const protocolDisposition = String(analysisEvidence?.protocol?.disposition || "").toUpperCase();
  const nanoStatus = String(analysisEvidence?.nanoTask?.status || "").toUpperCase();
  const sourceState = String(sessionRotation?.sourceResponseState || "");
  if (FAILURE_DISPOSITIONS.has(priorDisposition)) {
    add(LEARNING_KEYPOINTS.POST_FAILURE_FALSE_BLOCKER_UNKNOWN_EFFECT_RECOVERY, `PREVIOUS_DISPOSITION_${priorDisposition}`);
  } else if (protocolDisposition === "BLOCKED") {
    add(LEARNING_KEYPOINTS.POST_FAILURE_FALSE_BLOCKER_UNKNOWN_EFFECT_RECOVERY, "PREVIOUS_RESPONSE_BLOCKED");
  } else if (UNKNOWN_EFFECT_SOURCE_STATES.has(sourceState)) {
    add(LEARNING_KEYPOINTS.POST_FAILURE_FALSE_BLOCKER_UNKNOWN_EFFECT_RECOVERY, sourceState);
  } else if (["UNKNOWN_EFFECT", "FAILED"].includes(nanoStatus)) {
    add(LEARNING_KEYPOINTS.POST_FAILURE_FALSE_BLOCKER_UNKNOWN_EFFECT_RECOVERY, `NANO_TASK_${nanoStatus}`);
  }
  const lastBlockers = process?.lastResponse?.contract?.value?.blockers;
  const lastReportedBlockers = (Array.isArray(lastBlockers) && lastBlockers.length > 0) || protocolDisposition === "BLOCKED";
  const blockerStreak = followUp && lastReportedBlockers
    ? Number(previousContext?.trace?.blockerStreak || 0) + 1
    : (lastReportedBlockers ? 1 : 0);
  if (blockerStreak >= 2) {
    add(LEARNING_KEYPOINTS.RECURRING_SOFT_BLOCKER_OR_FAILURE_FAMILY, `BLOCKERS_IN_${blockerStreak}_CONSECUTIVE_RESPONSES`);
  }
  if (operatorInstruction?.text) {
    add(LEARNING_KEYPOINTS.MAJOR_REPLAN_OR_SCOPE_DRIFT_RISK, "OPERATOR_INSTRUCTION_PRESENT");
  }
  if (checkpointRequired === true) {
    add(LEARNING_KEYPOINTS.CHECKPOINT_HANDOFF_STOP_OR_TERMINAL_CLOSE, "FINAL_INTERACTION_IN_QUANTUM");
  }

  // Previous-prompt obligations the previous response did not report.
  const previousRequired = previousContext && followUp
    ? Object.entries(previousContext.obligations || {})
        .filter(([, value]) => value === OBLIGATION.REQUIRED)
        .map(([key]) => key)
    : [];
  const reported = reportedLearningObligations(previousResult);
  const carriedOverObligations = previousRequired.filter((key) => !reported.has(key));

  const atKeypoint = keypoints.length > 0;
  const sameWorkBlock = followUp && previousContext?.workBlockId === workBlockId;
  const discoveryFresh = sameWorkBlock &&
    Boolean(previousResult && !previousResult.malformed && previousResult.aik.discovery);
  const closureRequired = checkpointRequired === true;
  const obligations = {
    AIK_DISCOVERY: discoveryFresh && !carriedOverObligations.includes("AIK_DISCOVERY")
      ? OBLIGATION.FRESH_RESULT_REUSABLE
      : OBLIGATION.REQUIRED,
    KAIZEN_RETRIEVAL: atKeypoint || carriedOverObligations.includes("KAIZEN_RETRIEVAL")
      ? OBLIGATION.REQUIRED
      : OBLIGATION.REQUIRED_AT_DECLARED_KEYPOINT,
    AIK_CONTINUITY_CHECK: closureRequired || carriedOverObligations.includes("AIK_CONTINUITY_CHECK")
      ? OBLIGATION.REQUIRED
      : OBLIGATION.REQUIRED_ON_TRIGGER,
    SELF_LEARN_CLOSURE: closureRequired || carriedOverObligations.includes("SELF_LEARN_CLOSURE")
      ? OBLIGATION.REQUIRED
      : OBLIGATION.REQUIRED_WHEN_ENDING_WORK_BLOCK,
    OWNER_TRUTH_REFRESH: OBLIGATION.REQUIRED_BEFORE_ACTING_ON_RETAINED_LEARNING
  };

  return {
    schema: LEARNING_CONTEXT_SCHEMA,
    block: "EIC_LEARNING_CONTEXT",
    workBlockId,
    project: {
      id: scope.projectId,
      name: scope.projectName,
      subject: scope.subject,
      scopeSource: scope.source,
      aikScope: scope.projectId !== null ? `project:${scope.projectId}` : "RESOLVE_EXACT_PROJECT_SCOPE_FROM_OWNER_STATE_FIRST"
    },
    origin: "GREENFIELD_AUTONOMOUS",
    ...(operatorInstruction?.text ? { operatorInstructionOrigin: "HUMAN_OPERATOR" } : {}),
    keypoints,
    obligations,
    carriedOverObligations,
    freshChecksReusable: {
      aikDiscovery: obligations.AIK_DISCOVERY === OBLIGATION.FRESH_RESULT_REUSABLE
    },
    previousResult: previousResultSummary(previousResult),
    trace: { blockerStreak }
  };
}

export const LEARNING_CONTROL_COMPACT_REMINDER = "The EIC Learning & Continuity Control Contract from the most recent FULL prompt remains fully in force. control.learningControl lists this prompt's REQUIRED checks; execute them (or report the scoped unavailable outcome), report results in learningControl, and never let retained learning replace fresh factual-owner truth.";
