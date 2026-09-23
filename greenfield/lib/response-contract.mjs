import { A2A_RESPONSE_SCHEMA } from "./contracts.mjs";
import { text } from "./common.mjs";
import {
  MISSION_PAUSE_ACTION,
  normalizeMissionPauseSeconds,
  validateMissionPauseRequest
} from "./mission-pause.mjs";
import { validateMissionDelegationRequests } from "./mission-delegation.mjs";
import { RUNTIME_CONTROL_FIELD, parseRuntimeControlRequest } from "./runtime-control.mjs";

const REQUIRED = Object.freeze([
  "schema",
  "status",
  "summary",
  "workPerformed",
  "evidence",
  "blockers",
  "nextSuggestedAction"
]);
// runtimeControl is admitted structurally here and validated per action by
// runtime-control.mjs, so a malformed control block yields INVALID receipts
// instead of hiding the response's status/sessionAction from Greenfield.
const ALLOWED = new Set([...REQUIRED, "sessionAction", "sessionReason", "pauseSeconds", "missionDelegations", "greenfieldStatusRequest", RUNTIME_CONTROL_FIELD]);
const STATUSES = new Set(["CONTINUE", "DONE", "BLOCKED"]);
const SESSION_ACTIONS = new Set(["KEEP", "ROTATE_SESSION_NOW", MISSION_PAUSE_ACTION, "BACKGROUND_SLEEP", "YIELD_TO_QUEUE", "STOP_PROCESS"]);
const PARSE_MODE = Object.freeze({
  STRICT: "STRICT",
  REPAIRED_UNESCAPED_QUOTES: "REPAIRED_UNESCAPED_QUOTES",
  CONTROL_PLANE_SALVAGE: "CONTROL_PLANE_SALVAGE"
});

const CONTROL_PREFIX_SCAN_CHARS = 1600;
const CONTROL_NEXT_ACTION_MAX_CHARS = 12000;

function boundedString(value, max) {
  return typeof value === "string" && value.length <= max;
}

function boundedStringArray(value, maxItems, maxChars) {
  return Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((item) => typeof item === "string" && item.length >= 1 && item.length <= maxChars);
}

export function validateTargetResponse(value) {
  const v = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const errors = [];
  if (v.schema !== A2A_RESPONSE_SCHEMA) errors.push("SCHEMA");
  if (!STATUSES.has(String(v.status || "").toUpperCase())) errors.push("STATUS");
  if (!boundedString(v.summary, 12000) || !v.summary.trim()) errors.push("SUMMARY");
  if (!boundedStringArray(v.workPerformed, 50, 4000)) errors.push("WORK_PERFORMED");
  if (!boundedStringArray(v.evidence, 50, 4000)) errors.push("EVIDENCE");
  if (!boundedStringArray(v.blockers, 20, 4000)) errors.push("BLOCKERS");
  if (!boundedString(v.nextSuggestedAction, 12000)) errors.push("NEXT_SUGGESTED_ACTION");
  if ("sessionAction" in v && !SESSION_ACTIONS.has(String(v.sessionAction || "").toUpperCase())) errors.push("SESSION_ACTION");
  if ("sessionReason" in v && !boundedString(v.sessionReason, 2000)) errors.push("SESSION_REASON");
  if ("greenfieldStatusRequest" in v &&
      String(v.greenfieldStatusRequest || "").toUpperCase() !== "FULL_NEXT_PROMPT") {
    errors.push("GREENFIELD_STATUS_REQUEST");
  }
  const delegationValidation = validateMissionDelegationRequests(v.missionDelegations);
  errors.push(...delegationValidation.errors);
  if (Array.isArray(v.missionDelegations) && v.missionDelegations.length > 0 &&
      String(v.status || "").toUpperCase() === "DONE") {
    errors.push("MISSION_DELEGATION_DONE_CONFLICT");
  }
  const pauseValidation = validateMissionPauseRequest({
    sessionAction: v.sessionAction || "KEEP",
    status: v.status,
    pauseSeconds: v.pauseSeconds,
    nextSuggestedAction: v.nextSuggestedAction
  });
  errors.push(...pauseValidation.errors);
  if (String(v.sessionAction || "KEEP").toUpperCase() === "BACKGROUND_SLEEP") {
    if (String(v.status || "").toUpperCase() !== "CONTINUE") errors.push("BACKGROUND_SLEEP_REQUIRES_CONTINUE_STATUS");
    if (!String(v.nextSuggestedAction || "").trim()) errors.push("BACKGROUND_SLEEP_NEXT_ACTION_REQUIRED");
    const seconds = Number(v.pauseSeconds);
    if (!Number.isInteger(seconds) || seconds < 300 || seconds > 86400) errors.push("BACKGROUND_SLEEP_SECONDS_RANGE");
  }
  if (String(v.sessionAction || "KEEP").toUpperCase() === "YIELD_TO_QUEUE") {
    if (String(v.status || "").toUpperCase() !== "CONTINUE") errors.push("QUEUE_YIELD_REQUIRES_CONTINUE_STATUS");
    if (!String(v.nextSuggestedAction || "").trim()) errors.push("QUEUE_YIELD_NEXT_ACTION_REQUIRED");
  }
  if (String(v.status || "").toUpperCase() === "DONE" &&
      ["ROTATE_SESSION_NOW", MISSION_PAUSE_ACTION, "BACKGROUND_SLEEP", "YIELD_TO_QUEUE"].includes(String(v.sessionAction || "KEEP").toUpperCase())) {
    errors.push("SESSION_ACTION_STATUS_CONFLICT");
  }
  for (const key of Object.keys(v)) {
    if (!ALLOWED.has(key)) errors.push(`ADDITIONAL_PROPERTY:${key}`);
  }
  for (const key of REQUIRED) {
    if (!(key in v)) errors.push(`MISSING:${key}`);
  }
  return { ok: errors.length === 0, errors };
}

function nextNonWhitespaceIndex(source, from) {
  for (let i = from; i < source.length; i += 1) {
    if (!/\s/.test(source[i])) return i;
  }
  return -1;
}

function nextNonWhitespace(source, from) {
  const index = nextNonWhitespaceIndex(source, from);
  return index >= 0 ? source[index] : "";
}

function scanQuotedTokenEnd(source, quoteIndex) {
  let escaped = false;
  for (let i = quoteIndex + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "\"") return i;
  }
  return -1;
}

function looksLikeObjectKeyAfterComma(source, commaIndex) {
  const keyStart = nextNonWhitespaceIndex(source, commaIndex + 1);
  if (keyStart < 0 || source[keyStart] !== "\"") return false;
  const keyEnd = scanQuotedTokenEnd(source, keyStart);
  if (keyEnd < 0) return false;
  return nextNonWhitespace(source, keyEnd + 1) === ":";
}

function looksLikeArrayValueAfterComma(source, commaIndex) {
  const valueStart = nextNonWhitespaceIndex(source, commaIndex + 1);
  if (valueStart < 0) return false;
  const rest = source.slice(valueStart);
  const first = source[valueStart];

  if (first === "\"") {
    const valueEnd = scanQuotedTokenEnd(source, valueStart);
    if (valueEnd < 0) return false;
    const after = nextNonWhitespace(source, valueEnd + 1);
    return after === "," || after === "]";
  }

  return first === "{" ||
    first === "[" ||
    first === "-" ||
    /[0-9]/.test(first) ||
    rest.startsWith("true") ||
    rest.startsWith("false") ||
    rest.startsWith("null");
}

function quoteLooksStructuralClose(source, index, role, container) {
  const nextIndex = nextNonWhitespaceIndex(source, index + 1);
  if (nextIndex < 0) return true;

  const next = source[nextIndex];
  if (role === "KEY") return next === ":";

  if (next === "}" || next === "]") return true;
  if (next !== ",") return false;

  return container === "ARRAY"
    ? looksLikeArrayValueAfterComma(source, nextIndex)
    : looksLikeObjectKeyAfterComma(source, nextIndex);
}

function isEscapedQuote(source, index) {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && source[i] === "\\"; i -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function decodeBoundedRenderedString(value, max = CONTROL_NEXT_ACTION_MAX_CHARS) {
  return String(value || "")
    .slice(0, max)
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\");
}

function extractLastTopLevelLikeStringField(source, field, fromIndex) {
  const s = String(source || "");
  const keyPattern = new RegExp(`"${field}"\\s*:`, "g");
  keyPattern.lastIndex = Math.max(0, Number(fromIndex || 0));

  let match = null;
  let current;
  while ((current = keyPattern.exec(s)) !== null) match = current;
  if (!match) return "";

  let start = nextNonWhitespaceIndex(s, match.index + match[0].length);
  if (start < 0 || s[start] !== "\"") return "";
  start += 1;

  for (let i = start; i < Math.min(s.length, start + CONTROL_NEXT_ACTION_MAX_CHARS + 2048); i += 1) {
    if (s[i] !== "\"" || isEscapedQuote(s, i)) continue;
    const next = nextNonWhitespace(s, i + 1);
    // nextSuggestedAction is the final canonical property. A quote followed by
    // the top-level close is therefore a structural close even when other
    // rendered string escapes were lost earlier in the object.
    if (next === "}") {
      return decodeBoundedRenderedString(s.slice(start, i));
    }
  }
  return "";
}

export function extractRendererSafeControl(source) {
  const s = String(source || "");
  const schemaPattern = new RegExp(
    `"schema"\\s*:\\s*"${A2A_RESPONSE_SCHEMA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
    "g"
  );
  const schemaMatch = schemaPattern.exec(s);
  if (!schemaMatch) {
    return {
      ok: false,
      status: "UNKNOWN",
      nextSuggestedAction: "",
      errors: ["CONTROL_SCHEMA_ANCHOR_NOT_FOUND"]
    };
  }

  const prefix = s.slice(
    schemaMatch.index,
    Math.min(s.length, schemaMatch.index + CONTROL_PREFIX_SCAN_CHARS)
  );
  const summaryIndex = prefix.search(/"summary"\s*:/);
  const statusRegion = summaryIndex >= 0
    ? prefix.slice(0, summaryIndex)
    : prefix.slice(0, Math.min(prefix.length, 640));
  const statusMatches = [...statusRegion.matchAll(/"status"\s*:\s*"([^"\r\n]{1,32})"/g)];

  if (statusMatches.length !== 1) {
    return {
      ok: false,
      status: "UNKNOWN",
      nextSuggestedAction: "",
      errors: [statusMatches.length === 0
        ? "CONTROL_STATUS_NOT_FOUND"
        : "CONTROL_STATUS_AMBIGUOUS"]
    };
  }

  const status = String(statusMatches[0][1] || "").toUpperCase();
  if (!STATUSES.has(status)) {
    return {
      ok: false,
      status: "UNKNOWN",
      nextSuggestedAction: "",
      errors: ["CONTROL_STATUS_INVALID"]
    };
  }

  const sessionMatches = [...statusRegion.matchAll(/"sessionAction"\s*:\s*"([^"\r\n]{1,64})"/g)];
  let sessionAction = "KEEP";
  if (sessionMatches.length > 1) {
    return {
      ok: false,
      status,
      sessionAction: "KEEP",
      nextSuggestedAction: "",
      errors: ["CONTROL_SESSION_ACTION_AMBIGUOUS"]
    };
  }
  if (sessionMatches.length === 1) {
    sessionAction = String(sessionMatches[0][1] || "").toUpperCase();
    if (!SESSION_ACTIONS.has(sessionAction)) {
      return {
        ok: false,
        status,
        sessionAction: "KEEP",
        nextSuggestedAction: "",
        errors: ["CONTROL_SESSION_ACTION_INVALID"]
      };
    }
  }

  const pauseMatches = [...statusRegion.matchAll(/"pauseSeconds"\s*:\s*([0-9]{1,6})/g)];
  let pauseSeconds = null;
  if (pauseMatches.length > 1) {
    return {
      ok: false,
      status,
      sessionAction,
      pauseSeconds: null,
      nextSuggestedAction: "",
      errors: ["CONTROL_PAUSE_SECONDS_AMBIGUOUS"]
    };
  }
  if (pauseMatches.length === 1) {
    pauseSeconds = normalizeMissionPauseSeconds(Number(pauseMatches[0][1]));
    if (pauseSeconds === null) {
      return {
        ok: false,
        status,
        sessionAction,
        pauseSeconds: null,
        nextSuggestedAction: "",
        errors: ["CONTROL_PAUSE_SECONDS_INVALID"]
      };
    }
  }

  if (status === "DONE" && ["ROTATE_SESSION_NOW", MISSION_PAUSE_ACTION, "BACKGROUND_SLEEP", "YIELD_TO_QUEUE"].includes(sessionAction)) {
    return {
      ok: false,
      status,
      sessionAction,
      pauseSeconds,
      nextSuggestedAction: "",
      errors: ["CONTROL_SESSION_ACTION_STATUS_CONFLICT"]
    };
  }

  const nextSuggestedAction = extractLastTopLevelLikeStringField(
    s,
    "nextSuggestedAction",
    schemaMatch.index
  );
  if (sessionAction === MISSION_PAUSE_ACTION) {
    if (status !== "CONTINUE") {
      return {
        ok: false,
        status,
        sessionAction,
        pauseSeconds,
        nextSuggestedAction,
        errors: ["CONTROL_PAUSE_REQUIRES_CONTINUE_STATUS"]
      };
    }
    if (pauseSeconds === null) {
      return {
        ok: false,
        status,
        sessionAction,
        pauseSeconds: null,
        nextSuggestedAction,
        errors: ["CONTROL_PAUSE_SECONDS_MISSING"]
      };
    }
    if (!nextSuggestedAction.trim()) {
      return {
        ok: false,
        status,
        sessionAction,
        pauseSeconds,
        nextSuggestedAction,
        errors: ["CONTROL_PAUSE_NEXT_ACTION_REQUIRED"]
      };
    }
  } else if (pauseSeconds !== null) {
    return {
      ok: false,
      status,
      sessionAction,
      pauseSeconds,
      nextSuggestedAction,
      errors: ["CONTROL_PAUSE_SECONDS_WITHOUT_ACTION"]
    };
  }

  if (sessionAction === "YIELD_TO_QUEUE") {
    if (status !== "CONTINUE") {
      return {
        ok: false,
        status,
        sessionAction,
        pauseSeconds,
        nextSuggestedAction,
        errors: ["CONTROL_QUEUE_YIELD_REQUIRES_CONTINUE_STATUS"]
      };
    }
    if (!nextSuggestedAction.trim()) {
      return {
        ok: false,
        status,
        sessionAction,
        pauseSeconds,
        nextSuggestedAction,
        errors: ["CONTROL_QUEUE_YIELD_NEXT_ACTION_REQUIRED"]
      };
    }
  }

  return {
    ok: true,
    status,
    sessionAction,
    pauseSeconds,
    nextSuggestedAction,
    errors: []
  };
}

function findSchemaAnchoredCandidates(source) {
  const s = String(source || "");
  const out = [];
  const marker = `"${A2A_RESPONSE_SCHEMA}"`;
  let markerIndex = s.indexOf(marker);

  while (markerIndex >= 0) {
    const start = s.lastIndexOf("{", markerIndex);
    if (start >= 0) {
      let end = s.lastIndexOf("}");
      let emitted = 0;
      while (end > markerIndex && emitted < 24) {
        out.push(s.slice(start, end + 1));
        emitted += 1;
        end = s.lastIndexOf("}", end - 1);
      }
    }
    markerIndex = s.indexOf(marker, markerIndex + marker.length);
  }

  return [...new Set(out)];
}

function findBalancedJsonObjects(source, tolerantQuotes = false) {
  const out = [];
  const s = String(source || "");
  for (let start = 0; start < s.length; start += 1) {
    if (s[start] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < s.length; i += 1) {
      const ch = s[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === "\"") {
          if (!tolerantQuotes || quoteLooksStructuralClose(s, i)) inString = false;
        }
        continue;
      }
      if (ch === "\"") {
        inString = true;
        continue;
      }
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          out.push(s.slice(start, i + 1));
          start = i;
          break;
        }
      }
    }
  }
  return out;
}

export function repairLikelyUnescapedStringQuotes(source) {
  const s = String(source || "");
  let out = "";
  let inString = false;
  let escaped = false;
  let repairs = 0;
  let stringRole = "VALUE";
  let stringContainer = "OBJECT";
  const stack = [];

  function top() {
    return stack[stack.length - 1] || null;
  }

  function markValueComplete() {
    const frame = top();
    if (!frame) return;
    frame.expect = "COMMA_OR_END";
  }

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];

    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        out += ch;
        escaped = true;
        continue;
      }

      if (ch === "\"") {
        if (quoteLooksStructuralClose(s, i, stringRole, stringContainer)) {
          out += ch;
          inString = false;
          const frame = top();
          if (stringRole === "KEY" && frame?.type === "OBJECT") {
            frame.expect = "COLON";
          } else {
            markValueComplete();
          }
        } else {
          out += "\\\"";
          repairs += 1;
        }
        continue;
      }

      out += ch;
      continue;
    }

    out += ch;

    if (ch === "{") {
      stack.push({ type: "OBJECT", expect: "KEY_OR_END" });
      continue;
    }
    if (ch === "[") {
      stack.push({ type: "ARRAY", expect: "VALUE_OR_END" });
      continue;
    }
    if (ch === "}") {
      if (top()?.type === "OBJECT") stack.pop();
      markValueComplete();
      continue;
    }
    if (ch === "]") {
      if (top()?.type === "ARRAY") stack.pop();
      markValueComplete();
      continue;
    }
    if (ch === ":") {
      const frame = top();
      if (frame?.type === "OBJECT") frame.expect = "VALUE";
      continue;
    }
    if (ch === ",") {
      const frame = top();
      if (frame?.type === "OBJECT") frame.expect = "KEY_OR_END";
      if (frame?.type === "ARRAY") frame.expect = "VALUE_OR_END";
      continue;
    }
    if (ch === "\"") {
      const frame = top();
      stringContainer = frame?.type || "OBJECT";
      stringRole = frame?.type === "OBJECT" && frame.expect === "KEY_OR_END"
        ? "KEY"
        : "VALUE";
      inString = true;
      escaped = false;
    }
  }

  return {
    text: out,
    repairs,
    changed: repairs > 0
  };
}

function normalizeTargetResponse(value) {
  return {
    schema: A2A_RESPONSE_SCHEMA,
    status: String(value.status || "").toUpperCase(),
    sessionAction: SESSION_ACTIONS.has(String(value.sessionAction || "").toUpperCase())
      ? String(value.sessionAction || "").toUpperCase()
      : "KEEP",
    sessionReason: text(value.sessionReason, 2000),
    pauseSeconds: normalizeMissionPauseSeconds(value.pauseSeconds),
    summary: text(value.summary, 12000),
    workPerformed: value.workPerformed.map((item) => text(item, 4000)),
    evidence: value.evidence.map((item) => text(item, 4000)),
    blockers: value.blockers.map((item) => text(item, 4000)),
    nextSuggestedAction: text(value.nextSuggestedAction, 12000),
    greenfieldStatusRequest: String(value.greenfieldStatusRequest || "").toUpperCase() === "FULL_NEXT_PROMPT"
      ? "FULL_NEXT_PROMPT"
      : "",
    missionDelegations: Array.isArray(value.missionDelegations)
      ? value.missionDelegations.slice(0, 3).map((item) => ({
          requestId: text(item.requestId, 200).trim(),
          label: text(item.label || "", 200).trim(),
          mission: text(item.mission, 120000).trim(),
          priority: String(item.priority || "NORMAL").trim().toUpperCase(),
          relation: String(item.relation || "SUPPORTS_CURRENT").trim().toUpperCase()
        }))
      : [],
    runtimeControl: parseRuntimeControlRequest(value.runtimeControl)
  };
}

function evaluateCandidates(candidates, parseMode) {
  let firstSchemaObject = null;
  let firstSchemaText = "";
  for (const candidate of candidates) {
    const repaired = parseMode === PARSE_MODE.REPAIRED_UNESCAPED_QUOTES
      ? repairLikelyUnescapedStringQuotes(candidate)
      : { text: candidate, repairs: 0, changed: false };
    if (parseMode === PARSE_MODE.REPAIRED_UNESCAPED_QUOTES && !repaired.changed) continue;

    let value;
    try {
      value = JSON.parse(repaired.text);
    } catch {
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    if (value.schema !== A2A_RESPONSE_SCHEMA) continue;
    if (!firstSchemaObject) {
      firstSchemaObject = value;
      firstSchemaText = repaired.text;
    }

    const validation = validateTargetResponse(value);
    if (validation.ok) {
      const normalized = normalizeTargetResponse(value);
      return {
        found: true,
        ok: true,
        controlOk: true,
        status: normalized.status,
        value: normalized,
        control: {
          ok: true,
          status: normalized.status,
          sessionAction: normalized.sessionAction || "KEEP",
          pauseSeconds: normalized.pauseSeconds,
          nextSuggestedAction: normalized.nextSuggestedAction || "",
          errors: []
        },
        errors: [],
        jsonText: repaired.text,
        parseMode,
        repairApplied: repaired.changed,
        repairCount: repaired.repairs
      };
    }
  }

  if (firstSchemaObject) {
    const validation = validateTargetResponse(firstSchemaObject);
    return {
      found: true,
      ok: false,
      status: "UNKNOWN",
      value: null,
      errors: validation.errors,
      jsonText: firstSchemaText,
      parseMode,
      repairApplied: parseMode === PARSE_MODE.REPAIRED_UNESCAPED_QUOTES,
      repairCount: 0
    };
  }
  return null;
}

export function parseTargetResponse(source) {
  const raw = String(source || "");

  // Duplicate/conflicting control fields are ambiguous even if JSON.parse
  // would silently keep the last duplicate key. Reject before any full-object
  // parsing can collapse that ambiguity.
  const earlyControl = extractRendererSafeControl(raw);
  if ((earlyControl.errors || []).includes("CONTROL_STATUS_AMBIGUOUS") ||
      (earlyControl.errors || []).includes("CONTROL_STATUS_INVALID") ||
      (earlyControl.errors || []).includes("CONTROL_SESSION_ACTION_AMBIGUOUS") ||
      (earlyControl.errors || []).includes("CONTROL_SESSION_ACTION_INVALID") ||
      (earlyControl.errors || []).includes("CONTROL_SESSION_ACTION_STATUS_CONFLICT") ||
      (earlyControl.errors || []).includes("CONTROL_PAUSE_SECONDS_AMBIGUOUS") ||
      (earlyControl.errors || []).includes("CONTROL_PAUSE_SECONDS_INVALID") ||
      (earlyControl.errors || []).includes("CONTROL_PAUSE_SECONDS_WITHOUT_ACTION") ||
      (earlyControl.errors || []).includes("CONTROL_PAUSE_REQUIRES_CONTINUE_STATUS") ||
      (earlyControl.errors || []).includes("CONTROL_QUEUE_YIELD_REQUIRES_CONTINUE_STATUS") ||
      (earlyControl.errors || []).includes("CONTROL_QUEUE_YIELD_NEXT_ACTION_REQUIRED")) {
    return {
      found: true,
      ok: false,
      controlOk: false,
      status: "UNKNOWN",
      value: null,
      control: earlyControl,
      errors: earlyControl.errors,
      jsonText: "",
      parseMode: "NONE",
      repairApplied: false,
      repairCount: 0
    };
  }

  const strictCandidates = [];
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) strictCandidates.push(trimmed);
  strictCandidates.push(...findBalancedJsonObjects(raw, false));

  const strictResult = evaluateCandidates(strictCandidates, PARSE_MODE.STRICT);
  if (strictResult?.ok || strictResult?.found) return strictResult;

  // ChatGPT's rendered DOM plaintext can remove the escape character from quotes
  // that were valid inside a JSON string. Repair only this narrowly recognizable
  // rendering defect, then require the complete canonical response schema.
  const tolerantCandidates = findSchemaAnchoredCandidates(raw);
  const repairedResult = evaluateCandidates(
    tolerantCandidates,
    PARSE_MODE.REPAIRED_UNESCAPED_QUOTES
  );
  if (repairedResult?.ok || repairedResult?.found) return repairedResult;

  // Renderer plaintext is not a lossless JSON transport. If non-control
  // descriptive strings lost escaping, preserve the strong full-schema
  // failure but recover only the minimal control plane needed for liveness:
  // schema anchor, one canonical status, and the final nextSuggestedAction
  // string when its structural close is still observable.
  const control = extractRendererSafeControl(raw);
  if (control.ok) {
    return {
      found: true,
      ok: false,
      controlOk: true,
      status: control.status,
      value: null,
      control,
      errors: ["RENDERER_SCHEMA_DEGRADED"],
      jsonText: "",
      parseMode: PARSE_MODE.CONTROL_PLANE_SALVAGE,
      repairApplied: false,
      repairCount: 0
    };
  }

  return {
    found: false,
    ok: false,
    controlOk: false,
    status: "UNKNOWN",
    value: null,
    control,
    errors: ["A2A_RESPONSE_NOT_FOUND", ...(control.errors || [])],
    jsonText: "",
    parseMode: "NONE",
    repairApplied: false,
    repairCount: 0
  };
}

export function targetResponseEvidence(value, responseHash = "") {
  const parsed = value?.ok === true ? value : null;
  const control = value?.controlOk === true ? value?.control : null;
  return {
    schemaValid: Boolean(parsed),
    controlValid: Boolean(parsed || control),
    degraded: !parsed && Boolean(control),
    status: parsed?.status || control?.status || "UNKNOWN",
    sessionAction: parsed?.value?.sessionAction || control?.sessionAction || "KEEP",
    sessionReason: text(parsed?.value?.sessionReason || "", 1200),
    pauseSeconds: normalizeMissionPauseSeconds(parsed?.value?.pauseSeconds ?? control?.pauseSeconds),
    responseHash: text(responseHash, 128),
    summary: text(parsed?.value?.summary || "", 1200),
    blockers: Array.isArray(parsed?.value?.blockers)
      ? parsed.value.blockers.slice(0, 5).map((item) => text(item, 1000))
      : [],
    nextSuggestedAction: text(
      parsed?.value?.nextSuggestedAction || control?.nextSuggestedAction || "",
      3000
    ),
    greenfieldStatusRequest: parsed?.value?.greenfieldStatusRequest || "",
    parseMode: value?.parseMode || "NONE",
    repairApplied: value?.repairApplied === true,
    repairCount: Number(value?.repairCount || 0)
  };
}
