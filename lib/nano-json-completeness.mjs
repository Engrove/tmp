/**
 * Schema-bound Nano JSON completeness.
 *
 * The host may end a Prompt API request normally before producing a complete
 * top-level JSON object. For schema-bound calls that is not a successful
 * inference result: the provider/result boundary owns an explicit completeness
 * postcondition and returns a typed, bounded failure to the caller.
 */

export class NanoIncompleteJsonError extends Error {
  constructor(message = "Nano avslutade schema-bunden inferens utan ett komplett JSON-objekt.") {
    super(message);
    this.name = "NanoIncompleteJsonError";
    this.code = "NANO_INCOMPLETE_JSON";
    this.parseStage = "SCHEMA_COMPLETENESS_POSTCONDITION";
  }
}

export function extractFirstCompleteNanoJsonObject(value) {
  const text = String(value ?? "");
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
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const candidate = text.slice(start, index + 1);
        try {
          JSON.parse(candidate);
          return candidate;
        } catch {
          // Balanced text is not sufficient; continue looking for a later
          // complete object rather than claiming schema completion.
          start = -1;
        }
      }
    }
  }
  return "";
}

export function enforceNanoJsonCompleteness(value, {
  stopOnCompleteJson = false,
  responseSchemaId = "",
  transport = "",
  chunkCount = 0
} = {}) {
  const text = String(value ?? "");
  if (!stopOnCompleteJson) {
    return { text, complete: false };
  }

  const completed = extractFirstCompleteNanoJsonObject(text);
  if (completed) {
    return { text: completed, complete: true };
  }

  const error = new NanoIncompleteJsonError();
  error.nanoOutputText = text;
  error.nanoOutputChars = text.length;
  error.nanoChunkCount = Math.max(0, Number(chunkCount || 0));
  error.responseSchemaId = String(responseSchemaId || "");
  error.transport = String(transport || "");
  throw error;
}
