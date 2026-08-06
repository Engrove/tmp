import { deepClone, nowIso, sanitizeText } from "./common.mjs";

export const FORWARD_ONLY_POLICY_SCHEMA = "eic.autonom.forward-only-policy.v1";
export const FORWARD_ONLY_SINCE = "0.9.3";
export const FORWARD_ONLY_REASON = "Operator policy: no backward compatibility is required for v0.9.3 or later.";

export function forwardOnlyPolicy() {
  return Object.freeze({
    schema: FORWARD_ONLY_POLICY_SCHEMA,
    version: 1,
    since: FORWARD_ONLY_SINCE,
    mode: "CURRENT_VERSION_ONLY",
    migrateOlderState: false,
    acceptOlderExports: false,
    acceptSchemaAliases: false,
    preserveDeprecatedCommands: false,
    preserveRemovedFields: false,
    regressionObligationForRemovedBehavior: false
  });
}

export function assertCurrentSchema(value, {
  schema,
  version,
  label = "STATE"
} = {}) {
  const actualSchema = sanitizeText(value?.schema, 240);
  const actualVersion = Number(value?.version);
  if (actualSchema !== schema || actualVersion !== Number(version)) {
    const error = new Error(
      `FORWARD_ONLY_SCHEMA_REQUIRED:${label}:expected=${schema}@${version}:actual=${actualSchema || "NONE"}@${Number.isFinite(actualVersion) ? actualVersion : "NONE"}`
    );
    error.code = "FORWARD_ONLY_SCHEMA_REQUIRED";
    error.expectedSchema = schema;
    error.expectedVersion = Number(version);
    error.actualSchema = actualSchema;
    error.actualVersion = Number.isFinite(actualVersion) ? actualVersion : null;
    throw error;
  }
  return true;
}

export function currentStateOrFresh(value, {
  schema,
  version,
  factory,
  label = "STATE",
  now = Date.now()
} = {}) {
  if (value?.schema === schema && Number(value?.version) === Number(version)) {
    return { value: deepClone(value), reset: false, reason: "CURRENT_SCHEMA" };
  }
  const fresh = factory();
  fresh.forwardOnlyReset = {
    schema: FORWARD_ONLY_POLICY_SCHEMA,
    reason: "OLDER_OR_UNKNOWN_STATE_REJECTED",
    priorSchema: sanitizeText(value?.schema, 240),
    priorVersion: Number.isFinite(Number(value?.version)) ? Number(value.version) : null,
    at: nowIso(now),
    label
  };
  return { value: fresh, reset: Boolean(value), reason: value ? "FORWARD_ONLY_RESET" : "FRESH_INSTALL" };
}

export function assertCurrentExport(payload, {
  schema,
  version
} = {}) {
  assertCurrentSchema(payload, { schema, version, label: "EXPORT" });
  return true;
}
