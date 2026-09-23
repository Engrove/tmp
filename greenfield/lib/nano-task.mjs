import { randomId, text } from "./common.mjs";
import { GREENFIELD_MIXED_LANGUAGE_PROMPT_RULE } from "./language-contract.mjs";

export const NANO_TASK_SCHEMA = "eic.greenfield.nano-task.v1";
export const NANO_TASK_REQUEST_SCHEMA = "eic.greenfield.nano-task.request.v2";
export const NANO_KNOWLEDGE_BOUNDARY = "PROMPT_ONLY";
export const NANO_TASK_LANGUAGE = "en";
export const NANO_TASK_PROMPT_POLICY = "PROMPT_CLOSED_EXECUTION_V2";
export const NANO_CONTEXT_REQUIRED_PREFIX = "NANO_CONTEXT_REQUIRED:";
export const NANO_TASK_STATUS = Object.freeze({
  NOT_REQUESTED: "NOT_REQUESTED",
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  CONTEXT_REQUIRED: "CONTEXT_REQUIRED",
  FAILED: "FAILED",
  UNKNOWN_EFFECT: "UNKNOWN_EFFECT"
});

export const NANO_TASK_SEMANTIC_STATUS = Object.freeze({
  UNVERIFIED: "UNVERIFIED",
  SATISFIED: "SATISFIED",
  UNSATISFIED: "UNSATISFIED"
});

function compactString(value, limit) {
  return text(value, limit).trim();
}

function compactPromptData(value, limit) {
  if (value == null) return "";
  if (typeof value === "string") return compactString(value, limit);
  try {
    return compactString(JSON.stringify(value), limit);
  } catch {
    return compactString(value, limit);
  }
}

export function splitNanoTaskDirective(value) {
  const source = String(value ?? "");
  const pattern = /(^|\n)[\t ]*NANO_TASK[\t ]*:[\t ]*/gi;
  let match = null;
  let current;
  while ((current = pattern.exec(source)) !== null) match = current;
  if (!match) return { found: false, task: "", remainder: source.trim(), sourceText: source };

  const taskStart = match.index + match[0].length;
  const lineEnd = source.indexOf("\n", taskStart);
  const taskEnd = lineEnd >= 0 ? lineEnd : source.length;
  let task = source.slice(taskStart, taskEnd).trim();

  // Historical releases accepted NANO_TASK: {plain text}. Keep that wrapper
  // behavior only when the braces are not valid JSON. v1.3.0 uses a one-line
  // JSON object for richer prompt-closed tasks, so valid JSON braces must stay.
  if (task.startsWith("{") && task.endsWith("}") && task.length >= 2) {
    try {
      JSON.parse(task);
    } catch {
      task = task.slice(1, -1).trim();
    }
  }
  if (!task) return { found: false, task: "", remainder: source.trim(), sourceText: source };

  const before = source.slice(0, match.index).trim();
  const after = lineEnd >= 0 ? source.slice(lineEnd + 1).trim() : "";
  const remainder = [before, after].filter(Boolean).join("\n").trim();

  return {
    found: true,
    task: text(task, 12000),
    remainder: text(remainder, 12000),
    sourceText: source
  };
}

export function parseNanoTaskRequest(sourceTask) {
  const source = compactString(sourceTask, 12000);
  if (!source) {
    return {
      ok: false,
      format: "EMPTY",
      sourceTask: "",
      instruction: "",
      context: "",
      output: "",
      knowledgeBoundary: NANO_KNOWLEDGE_BOUNDARY,
      errors: ["TASK_EMPTY"]
    };
  }

  if (source.startsWith("{") && source.endsWith("}")) {
    try {
      const value = JSON.parse(source);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const schema = String(value.schema || "");
        const boundary = String(value.knowledgeBoundary || "").toUpperCase();
        const instruction = compactString(value.instruction, 7000);
        const context = compactPromptData(value.context, 7000);
        const output = compactString(value.output, 2500);
        const errors = [];
        if (schema !== NANO_TASK_REQUEST_SCHEMA) errors.push("REQUEST_SCHEMA");
        if (boundary !== NANO_KNOWLEDGE_BOUNDARY) errors.push("KNOWLEDGE_BOUNDARY");
        if (!instruction) errors.push("INSTRUCTION");
        return {
          ok: errors.length === 0,
          format: "STRUCTURED_V2",
          sourceTask: source,
          instruction,
          context,
          output,
          knowledgeBoundary: boundary || NANO_KNOWLEDGE_BOUNDARY,
          errors
        };
      }
    } catch {
      // Non-JSON plain-text tasks remain supported for backward compatibility.
    }
  }

  return {
    ok: true,
    format: "LEGACY_PLAIN",
    sourceTask: source,
    instruction: source,
    context: "",
    output: "",
    knowledgeBoundary: NANO_KNOWLEDGE_BOUNDARY,
    errors: []
  };
}

const EXTERNAL_ACTION_PATTERNS = Object.freeze([
  /\b(?:read|open|search|query|fetch|retrieve|load|access|download)\b[^.\n]{0,120}\b(?:file|files|path|directory|folder|zip|archive|repo|repository|project|artifact|database|mail|mailbox|staging|workspace|owner[- ]?route|api|endpoint)\b/i,
  /\b(?:extract|enumerate|list)\b[^.\n]{0,100}\bfrom\b[^.\n]{0,80}\b(?:file|files|path|directory|folder|zip|archive|repo|repository|project|artifact|database|mail|mailbox|staging|workspace)\b/i,
  /\b(?:use|call|invoke)\b[^.\n]{0,80}\b(?:eic|owner[- ]?route|api|tool|browser|web|internet|filesystem|file system)\b/i,
  /\b(?:inspect|analy[sz]e)\b[^.\n]{0,80}\b(?:under|inside|at)\s+(?:\/|https?:\/\/)/i
]);

const MISSING_REFERENCE_PATTERNS = Object.freeze([
  /\b(?:attached|uploaded)\s+(?:file|files|document|documents|archive|zip|image|data)\b/i,
  /\b(?:previous|earlier)\s+(?:turn|message|response|prompt|conversation|chat)\b/i,
  /\b(?:the|this)\s+(?:current|existing|latest)\s+(?:project|repo|repository|artifact|workspace|staging|mailbox|database|file|files|metadata)\b/i,
  /\b(?:existing|current|latest)\s+(?:csv|json|metadata|manifest|manifests|files|archive|zip|project|repo|artifact|mail|mailbox|staging)\b/i,
  /\b(?:from|under)\s+\/(?:srv|mnt|home|var|tmp)\//i
]);

export function assessNanoTaskPromptClosure(sourceTask) {
  const request = parseNanoTaskRequest(sourceTask);
  const reasons = [...request.errors];

  if (!request.ok) {
    return {
      ok: false,
      policy: NANO_TASK_PROMPT_POLICY,
      knowledgeBoundary: NANO_KNOWLEDGE_BOUNDARY,
      format: request.format,
      reasons,
      instruction: request.instruction,
      contextChars: request.context.length
    };
  }

  // For structured v2, CONTEXT is data already inside the prompt. Only inspect
  // the instruction/output for requests to access something outside that data.
  // Legacy tasks have no separate inline-context field, so their full text is
  // the only available input and is checked conservatively.
  const controlText = request.format === "STRUCTURED_V2"
    ? `${request.instruction}\n${request.output}`
    : request.sourceTask;

  for (const pattern of EXTERNAL_ACTION_PATTERNS) {
    if (pattern.test(controlText)) reasons.push("EXTERNAL_ACCESS_REQUEST");
  }

  const contextProvided = request.format === "STRUCTURED_V2" && Boolean(request.context);
  for (const pattern of MISSING_REFERENCE_PATTERNS) {
    if (!pattern.test(controlText)) continue;
    // "this/these" style references may be satisfied by an explicit structured
    // CONTEXT field, but current/existing external-object locators may not.
    const isInlineReferent = /\b(?:this|these|those)\b/i.test(controlText);
    if (!(contextProvided && isInlineReferent)) reasons.push("UNRESOLVED_EXTERNAL_REFERENCE");
  }

  return {
    ok: reasons.length === 0,
    policy: NANO_TASK_PROMPT_POLICY,
    knowledgeBoundary: NANO_KNOWLEDGE_BOUNDARY,
    format: request.format,
    reasons: [...new Set(reasons)],
    instruction: request.instruction,
    contextChars: request.context.length
  };
}

export function buildNanoExecutionPrompt(sourceTask) {
  const request = parseNanoTaskRequest(sourceTask);
  if (!request.ok) return "";

  const lines = [
    "You are executing one isolated local Nano task.",
    "Knowledge boundary: this single prompt is your entire world for this task.",
    "You have no EIC/project state, files, tools, browser, web, API access, chat history, previous turns, or hidden context.",
    `If the task requires any fact or data not explicitly present in this prompt, return exactly "${NANO_CONTEXT_REQUIRED_PREFIX} <brief missing information>" and nothing else.`,
    "Do not guess, reconstruct, or pretend to access missing external state.",
    "Language policy: use English for Nano control/reasoning output. Execute now; do not describe a plan or restate the assignment.",
    "Mixed-language context: English, Swedish and Finnish may coexist in supplied evidence. Preserve raw labels; resolve structural/local-language context before lexical meaning; e.g. Swedish \"nåla fast\" is not English Fast effort.",
    "Return only the requested result unless explanation is explicitly requested.",
    "Do not output source code unless the task explicitly asks for source code.",
    "Follow any requested output format exactly."
  ];

  if (request.format === "STRUCTURED_V2") {
    lines.push(
      "Instruction:",
      request.instruction,
      "Supplied context:",
      request.context || "NONE",
      "Output requirement:",
      request.output || "Return the requested result."
    );
  } else {
    lines.push("Task:", request.instruction);
  }

  return lines.join("\n");
}

export function extractNanoContextRequirement(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^NANO_CONTEXT_REQUIRED\s*:\s*(.*)$/is);
  if (!match) return null;
  return {
    required: true,
    reason: compactString(match[1], 2000) || "Required information is absent from the prompt."
  };
}

function exactPlainTextLiteral(sourceTask) {
  const source = String(sourceTask || "").trim();
  const oneLineContaining = source.match(
    /^Return exactly one line of plain text containing\s+([^\s.]+)\.?(?:\s|$)/i
  );
  if (oneLineContaining) return oneLineContaining[1];

  const exactlyNothingElse = source.match(
    /^Return exactly\s+([^\s.]+)\s+and nothing else\.?(?:\s|$)/i
  );
  return exactlyNothingElse ? exactlyNothingElse[1] : "";
}

function canonicalExactLineResult(value) {
  const raw = String(value ?? "");
  if (raw.endsWith("\r\n")) return raw.slice(0, -2);
  if (raw.endsWith("\n")) return raw.slice(0, -1);
  return raw;
}

export function evaluateNanoTaskSemanticStatus(task) {
  if (!task?.requested) return NANO_TASK_SEMANTIC_STATUS.UNVERIFIED;
  if (String(task.status || "").toUpperCase() !== NANO_TASK_STATUS.COMPLETED) {
    return NANO_TASK_SEMANTIC_STATUS.UNVERIFIED;
  }
  const expected = exactPlainTextLiteral(task.sourceTask || task.task || "");
  if (!expected) return NANO_TASK_SEMANTIC_STATUS.UNVERIFIED;

  // Preserve raw result byte-for-byte in state/Audit. For an exact-one-line
  // presentation contract, only a single terminal line ending is transport
  // framing and may be removed before deterministic comparison. Do not trim
  // arbitrary leading/trailing whitespace.
  const canonical = canonicalExactLineResult(task.result);
  const oneLine = !/[\r\n]/.test(canonical);
  return oneLine && canonical === expected
    ? NANO_TASK_SEMANTIC_STATUS.SATISFIED
    : NANO_TASK_SEMANTIC_STATUS.UNSATISFIED;
}

export function createNanoTask({ task, sourceResponseHash = "", at = Date.now() } = {}) {
  const sourceTask = text(task, 12000).trim();
  if (!sourceTask) return null;
  const admission = assessNanoTaskPromptClosure(sourceTask);
  const executionPrompt = buildNanoExecutionPrompt(sourceTask);
  const admitted = admission.ok === true && Boolean(executionPrompt);
  return {
    schema: NANO_TASK_SCHEMA,
    requested: true,
    requestId: randomId("nano-task"),
    status: admitted ? NANO_TASK_STATUS.PENDING : NANO_TASK_STATUS.CONTEXT_REQUIRED,
    semanticStatus: NANO_TASK_SEMANTIC_STATUS.UNVERIFIED,
    // `task` remains the source directive for exact-once identity/backward compatibility.
    task: sourceTask,
    sourceTask,
    executionPrompt,
    promptLanguage: NANO_TASK_LANGUAGE,
    promptPolicy: NANO_TASK_PROMPT_POLICY,
    knowledgeBoundary: NANO_KNOWLEDGE_BOUNDARY,
    promptClosure: admission,
    result: "",
    error: admitted
      ? ""
      : `${NANO_CONTEXT_REQUIRED_PREFIX} ${admission.reasons.join(",") || "Prompt is not self-contained."}`,
    sourceResponseHash: text(sourceResponseHash, 128),
    isolation: "FRESH_ONE_PROMPT_SESSION",
    promptCalls: 0,
    createdAt: new Date(at).toISOString(),
    completedAt: admitted ? null : new Date(at).toISOString()
  };
}
