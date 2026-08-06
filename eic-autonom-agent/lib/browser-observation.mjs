import {
  nowIso,
  randomId,
  sha256Hex,
  stableStringify
} from "./common.mjs";
import {
  EVIDENCE_LIMITS,
  redactEvidenceText,
  sanitizeEvidenceUrl
} from "./evidence-contract.mjs";

export const BROWSER_OBSERVATION_PROTOCOL = "EIC_BROWSER_OBSERVATION/1";
export const BROWSER_OBSERVATION_SCHEMA = "eic.autonom.browser-observation.v1";
export const BROWSER_OBSERVATION_TTL_MS = 30_000;
export const MAX_OBSERVATION_ELEMENTS = 200;

const INTERACTIVE_ROLES = new Set([
  "button", "link", "textbox", "searchbox", "checkbox", "radio", "switch",
  "combobox", "listbox", "option", "menuitem", "tab", "slider", "spinbutton"
]);

function axValue(property) {
  return property && typeof property === "object" && "value" in property
    ? property.value
    : property;
}

function axProperty(node, name) {
  const property = (node?.properties || []).find((entry) => entry?.name === name);
  return axValue(property?.value);
}

function bool(value) {
  return value === true || value === "true" || value === "mixed";
}

function canonicalObservation(value) {
  return {
    protocol: value.protocol,
    schemaVersion: value.schemaVersion,
    observationId: value.observationId,
    capturedAt: value.capturedAt,
    expiresAt: value.expiresAt,
    target: value.target,
    page: value.page,
    elements: value.elements,
    evidenceRefs: value.evidenceRefs
  };
}

export async function createBrowserObservation({
  surface,
  axResult,
  evidenceRefs = [],
  now = Date.now()
} = {}) {
  if (!Number.isInteger(Number(surface?.tabId)) ||
      !surface?.surfaceId ||
      !surface?.documentEpoch ||
      !surface?.origin) {
    throw new Error("BROWSER_OBSERVATION_TARGET_REQUIRED");
  }
  const nodes = Array.isArray(axResult?.nodes) ? axResult.nodes : [];
  const elements = [];
  for (const node of nodes) {
    if (elements.length >= MAX_OBSERVATION_ELEMENTS) break;
    const backendNodeId = Number(node.backendDOMNodeId);
    const role = String(axValue(node.role) || "").toLowerCase();
    if (!Number.isInteger(backendNodeId) || !INTERACTIVE_ROLES.has(role) || node.ignored) continue;
    const rawName = redactEvidenceText(axValue(node.name), 240);
    const sensitive = /password|passcode|secret|token|credential/i.test(`${role} ${rawName}`);
    const refDigest = await sha256Hex(
      `${surface.surfaceId}|${surface.documentEpoch}|${backendNodeId}`
    );
    elements.push({
      ref: `el-${refDigest.slice(0, 20)}`,
      backendNodeId,
      role,
      name: sensitive ? "[REDACTED_FIELD_NAME]" : rawName,
      disabled: bool(axProperty(node, "disabled")),
      checked: axProperty(node, "checked") ?? null,
      selected: bool(axProperty(node, "selected")),
      focusable: bool(axProperty(node, "focusable")) || INTERACTIVE_ROLES.has(role),
      editable: ["textbox", "searchbox", "spinbutton"].includes(role) ||
        bool(axProperty(node, "editable")),
      sensitive
    });
  }
  const observation = {
    schema: BROWSER_OBSERVATION_SCHEMA,
    version: 1,
    protocol: BROWSER_OBSERVATION_PROTOCOL,
    schemaVersion: 1,
    observationId: randomId("browser-observation"),
    observationDigest: "",
    capturedAt: nowIso(now),
    expiresAt: nowIso(now + BROWSER_OBSERVATION_TTL_MS),
    target: {
      tabId: Number(surface.tabId),
      surfaceId: String(surface.surfaceId),
      documentEpoch: String(surface.documentEpoch),
      origin: String(surface.origin)
    },
    page: {
      url: sanitizeEvidenceUrl(surface.url || surface.origin),
      title: redactEvidenceText(surface.title, 300)
    },
    elements,
    elementCount: elements.length,
    truncated: elements.length >= MAX_OBSERVATION_ELEMENTS &&
      nodes.some((node) => {
        const backendNodeId = Number(node?.backendDOMNodeId);
        const role = String(axValue(node?.role) || "").toLowerCase();
        return Number.isInteger(backendNodeId) && INTERACTIVE_ROLES.has(role) && !node?.ignored;
      }),
    evidenceRefs: evidenceRefs.map(String).slice(0, 12)
  };
  observation.observationDigest = await sha256Hex(stableStringify(canonicalObservation(observation)));
  return observation;
}

export async function verifyBrowserObservation(value) {
  if (!value || value.protocol !== BROWSER_OBSERVATION_PROTOCOL ||
      value.schema !== BROWSER_OBSERVATION_SCHEMA ||
      Number(value.schemaVersion) !== 1 ||
      !/^[a-f0-9]{64}$/i.test(String(value.observationDigest || ""))) return false;
  const expected = await sha256Hex(stableStringify(canonicalObservation(value)));
  return expected === String(value.observationDigest).toLowerCase();
}

export function observationElementByRef(observation, ref) {
  return (observation?.elements || []).find((element) => element.ref === ref) || null;
}
