import { NANO_SCHEMA } from "./contracts.mjs";
import { text } from "./common.mjs";
import { GREENFIELD_MIXED_LANGUAGE_PROMPT_RULE } from "./language-contract.mjs";

export const NANO_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "schema",
    "summary",
    "intent",
    "materialFacts",
    "uncertainties",
    "continuityRisk",
    "recommendedFocus",
    "confidence"
  ],
  properties: {
    schema: { type: "string", enum: [NANO_SCHEMA] },
    summary: { type: "string", minLength: 1, maxLength: 4000 },
    intent: { type: "string", minLength: 1, maxLength: 1000 },
    materialFacts: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 1200 }
    },
    uncertainties: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 1200 }
    },
    continuityRisk: { type: "string", enum: ["NONE", "LOW", "MATERIAL"] },
    recommendedFocus: { type: "string", minLength: 1, maxLength: 3000 },
    confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] }
  }
});

export function normalizeNanoResult(value) {
  return {
    schema: NANO_SCHEMA,
    summary: text(value?.summary, 4000),
    intent: text(value?.intent, 1000),
    materialFacts: Array.isArray(value?.materialFacts)
      ? value.materialFacts.slice(0, 20).map((item) => text(item, 1200)).filter(Boolean)
      : [],
    uncertainties: Array.isArray(value?.uncertainties)
      ? value.uncertainties.slice(0, 20).map((item) => text(item, 1200)).filter(Boolean)
      : [],
    continuityRisk: String(value?.continuityRisk || "MATERIAL").toUpperCase(),
    recommendedFocus: text(value?.recommendedFocus, 3000),
    confidence: String(value?.confidence || "LOW").toUpperCase()
  };
}

export function validateNanoResult(value) {
  const n = value && typeof value === "object" ? value : {};
  const errors = [];
  if (n.schema !== NANO_SCHEMA) errors.push("SCHEMA");
  if (!String(n.summary || "").trim()) errors.push("SUMMARY");
  if (!String(n.intent || "").trim()) errors.push("INTENT");
  if (!Array.isArray(n.materialFacts)) errors.push("MATERIAL_FACTS");
  if (!Array.isArray(n.uncertainties)) errors.push("UNCERTAINTIES");
  if (!["NONE", "LOW", "MATERIAL"].includes(n.continuityRisk)) errors.push("CONTINUITY_RISK");
  if (!String(n.recommendedFocus || "").trim()) errors.push("RECOMMENDED_FOCUS");
  if (!["HIGH", "MEDIUM", "LOW"].includes(n.confidence)) errors.push("CONFIDENCE");
  return { ok: errors.length === 0, errors };
}

function compactTargetResponse(value) {
  if (!value || typeof value !== "object") return null;
  return {
    status: String(value.status || "UNKNOWN").toUpperCase(),
    summary: text(value.summary, 180),
    blockers: Array.isArray(value.blockers)
      ? value.blockers.slice(0, 2).map((item) => text(item, 60)).filter(Boolean)
      : [],
    nextSuggestedAction: text(value.nextSuggestedAction, 260),
    schemaDegraded: value.schemaDegraded === true
  };
}

function compactNanoTask(value) {
  if (!value?.requested) return null;
  return {
    requestId: text(value.requestId, 120),
    status: String(value.status || "UNKNOWN").toUpperCase(),
    semanticStatus: String(value.semanticStatus || "UNVERIFIED").toUpperCase(),
    sourceTask: text(value.sourceTask || value.task, 180),
    result: text(value.result, 220),
    error: text(value.error, 100),
    promptLanguage: text(value.promptLanguage, 20),
    promptPolicy: text(value.promptPolicy, 80),
    knowledgeBoundary: text(value.knowledgeBoundary, 32) || "PROMPT_ONLY",
    promptClosure: value.promptClosure && typeof value.promptClosure === "object"
      ? {
          ok: value.promptClosure.ok === true,
          format: text(value.promptClosure.format, 32),
          reasons: Array.isArray(value.promptClosure.reasons)
            ? value.promptClosure.reasons.slice(0, 3).map((item) => text(item, 60)).filter(Boolean)
            : []
        }
      : null
  };
}

export function buildNanoPrompt({
  goal,
  turn,
  targetDisposition = "UNKNOWN",
  targetResponse = null,
  responseExcerpt = "",
  runtimeSafety = null,
  nanoTask = null,
  operatorInstruction = ""
}) {
  const target = compactTargetResponse(targetResponse);
  const task = compactNanoTask(nanoTask);
  return `EIC Nano Observer. Advisory only; you do not own runtime state; you do not decide the final action. Return compact English JSON matching ${NANO_SCHEMA}.
PROMPT_ONLY boundary: this prompt is your entire knowledge. No EIC/project state, files, tools, web/API, chat history, prior turns, or hidden context exists for you. Never infer omitted/truncated facts.\nLanguage context: internal=en; ambient=en,sv,fi; raw labels preserved; structural/local-language context precedes lexical meaning.\nGreenfield schedules bounded work in an EIC custom GPT chat; EIC owns domain facts and effects. The runtime requires a selected deep Thinking model. UI labels are observations, not proof of the server model. Nano cannot authorize a lower model, clear holds or override budgets.
Rules:
- materialFacts: only explicit supplied fields; uncertainties: name material missing context.
- continuityRisk/recommendedFocus: local judgments over this prompt only, never external-state claims.
- TARGET_DISPOSITION is advisory metadata, not a continuation gate.
- If A2A is absent/invalid, use only RESPONSE_EXCERPT.
- Nano Task is separate exact-once evidence; use only its supplied status/result/error/closure metadata.
- Never invent execution, owner state, completion or evidence.

KNOWLEDGE_BOUNDARY=PROMPT_ONLY\nRUNTIME_MODEL_GATE=${JSON.stringify(runtimeSafety ? {code:text(runtimeSafety.code,60),model:text(runtimeSafety.model,60),effort:text(runtimeSafety.effort,30),assurance:"VISIBLE_UI_ONLY"} : {code:"NOT_SUPPLIED"})}
MISSION=${text(goal, 150)}
TURN=${Number(turn || 0)}
TARGET_DISPOSITION=${String(targetDisposition || "UNKNOWN").toUpperCase()}
TARGET=${target ? JSON.stringify(target) : "NONE"}
RESPONSE_EXCERPT=${target ? "NONE" : (text(responseExcerpt, 500) || "NONE")}
NANO_TASK=${task ? JSON.stringify(task) : "NOT_REQUESTED"}
OPERATOR_INSTRUCTION=${text(operatorInstruction, 160) || "NONE"}`;
}
