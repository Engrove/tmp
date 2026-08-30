/**
 * Pure output-budget helpers for Nano response contracts.
 *
 * The hard character ceiling is derived from the closed JSON schema instead of
 * from a historical field observation. String bounds use a conservative worst JSON escape expansion: one Unicode scalar may
 * be represented as a surrogate pair (`\\uXXXX\\uXXXX` = twelve characters).
 * Raw-chunk and wall/idle limits remain independent liveness controls.
 */

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function jsonStringUpperBoundFromMaxLength(maxLength) {
  const length = finiteNonNegative(maxLength);
  if (length === null) return Infinity;
  return 2 + (length * 12);
}

function enumSerializedUpperBound(values) {
  if (!Array.isArray(values) || values.length === 0) return Infinity;
  return Math.max(...values.map((value) => JSON.stringify(value).length));
}

function integerSerializedUpperBound(schema) {
  const minimum = Number(schema?.minimum);
  const maximum = Number(schema?.maximum);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return Infinity;
  return Math.max(String(Math.trunc(minimum)).length, String(Math.trunc(maximum)).length);
}

export function boundedJsonSchemaSerializedUpperBound(schema) {
  if (!schema || typeof schema !== "object") return Infinity;
  if (Array.isArray(schema.enum)) return enumSerializedUpperBound(schema.enum);

  switch (schema.type) {
    case "string":
      return jsonStringUpperBoundFromMaxLength(schema.maxLength);
    case "integer":
    case "number":
      return integerSerializedUpperBound(schema);
    case "boolean":
      return 5; // "false"
    case "null":
      return 4;
    case "array": {
      const maxItems = finiteNonNegative(schema.maxItems);
      const itemBound = boundedJsonSchemaSerializedUpperBound(schema.items);
      if (maxItems === null || !Number.isFinite(itemBound)) return Infinity;
      if (maxItems === 0) return 2;
      return 2 + (maxItems * itemBound) + Math.max(0, maxItems - 1);
    }
    case "object": {
      if (schema.additionalProperties !== false) return Infinity;
      const properties = schema.properties && typeof schema.properties === "object"
        ? schema.properties
        : {};
      const entries = Object.entries(properties);
      let total = 2;
      for (let index = 0; index < entries.length; index += 1) {
        const [key, propertySchema] = entries[index];
        const valueBound = boundedJsonSchemaSerializedUpperBound(propertySchema);
        if (!Number.isFinite(valueBound)) return Infinity;
        total += JSON.stringify(key).length + 1 + valueBound;
        if (index + 1 < entries.length) total += 1;
      }
      return total;
    }
    default:
      return Infinity;
  }
}

export function deriveSchemaHardOutputChars(schema, {
  minimum = 12_000,
  margin = 2_048,
  maximum = 512_000
} = {}) {
  const contractBound = boundedJsonSchemaSerializedUpperBound(schema);
  if (!Number.isFinite(contractBound)) {
    throw new Error("Nano response schema is not closed and fully bounded.");
  }
  const floor = Math.max(512, Number(minimum || 0));
  const extra = Math.max(0, Number(margin || 0));
  const ceiling = Math.max(floor, Math.ceil(contractBound + extra));
  if (ceiling > maximum) {
    throw new Error(`Nano response schema bound ${ceiling} exceeds configured safety maximum ${maximum}.`);
  }
  return ceiling;
}


/**
 * Derive a runtime streaming safety budget from a closed schema without requiring
 * the runtime cap to cover the schema's theoretical worst-case JSON escape expansion.
 *
 * A response schema describes semantic field lengths after JSON decoding. The
 * serialized transport may be much larger if every scalar is escaped as \uXXXX
 * or surrogate-pair escapes. That theoretical transport bound is useful telemetry,
 * but it must not be confused with the independent runtime safety cap.
 *
 * `hardOutputChars` is therefore clamped to `maximum`; `schemaSerializedUpperBound`
 * remains available for diagnostics. A complete response that exceeds
 * `hardOutputChars` is still rejected by the stream/request boundary.
 */
export function deriveSchemaRuntimeOutputBudget(schema, {
  minimum = 6_000,
  margin = 1_024,
  maximum = 32_000
} = {}) {
  const schemaSerializedUpperBound = boundedJsonSchemaSerializedUpperBound(schema);
  if (!Number.isFinite(schemaSerializedUpperBound)) {
    throw new Error("Nano response schema is not closed and fully bounded.");
  }
  const floor = Math.max(512, Number(minimum || 0));
  const extra = Math.max(0, Number(margin || 0));
  const configuredMaximum = Math.max(floor, Number(maximum || 0));
  const schemaRequested = Math.max(floor, Math.ceil(schemaSerializedUpperBound + extra));
  return Object.freeze({
    schemaSerializedUpperBound,
    schemaRequestedOutputChars: schemaRequested,
    hardOutputChars: Math.min(schemaRequested, configuredMaximum),
    configuredMaximum,
    schemaExceedsRuntimeCap: schemaRequested > configuredMaximum
  });
}

export function classifyNanoOutputBounds({
  outputChars,
  chunkCount,
  softOutputChars,
  hardOutputChars,
  maxRawChunks
}) {
  const chars = Math.max(0, Number(outputChars || 0));
  const chunks = Math.max(0, Number(chunkCount || 0));
  const soft = Math.max(0, Number(softOutputChars || 0));
  const hard = Math.max(512, Number(hardOutputChars || 0));
  const raw = Math.max(1, Number(maxRawChunks || 0));
  return {
    softThresholdExceeded: soft > 0 && chars > soft,
    hardOutputExceeded: chars > hard,
    rawChunkExceeded: chunks > raw
  };
}
