import {
  sanitizeText,
  sha256Hex,
  stableStringify
} from "./common.mjs";

export const AUTONOM_AGENT_LOCAL_SESSION_STATE = "AUTONOM_AGENT_LOCAL_SESSION_STATE";
export const LOCAL_AGENT_OWNER_RESOLUTION = "NONE_LOCAL_AGENT_STATE";
export const TARGET_SESSION_OWNER = "TARGET_SESSION_OWNER";
export const SESSION_INIT_PROMPT_MUTATED = "SESSION_INIT_PROMPT_MUTATED";
export const SESSION_INIT_PROTECTED_SCHEMA = "eic.autonom.session-init-protected-payload.v1";

function textList(values, maxItems = 16, maxLength = 2400) {
  return (Array.isArray(values) ? values : [])
    .map((value) => sanitizeText(
      typeof value === "string" ? value : value?.text || value?.claim || value?.statement,
      maxLength
    ))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function isProtectedSessionInitTurn({
  baselinePromptOnly = false,
  kind = "",
  sessionContextBaseline = false
} = {}) {
  return baselinePromptOnly === true ||
    sessionContextBaseline === true ||
    String(kind || "").toUpperCase() === "SESSION_CONTEXT_BASELINE_REQUEST";
}

export function genericControlRewriteAllowed(input = {}) {
  return !isProtectedSessionInitTurn(input);
}


export function applyAutonomyRoutingMetadata(decision, autonomy, {
  protectedSessionInit = false
} = {}) {
  if (!decision || typeof decision !== "object") return decision;
  if (protectedSessionInit) return decision;
  const exactTarget = sanitizeText(autonomy?.exactTarget, 1200);
  const ownerRoute = sanitizeText(autonomy?.ownerRoute, 1200);
  if (exactTarget) decision.exactTarget = exactTarget;
  if (ownerRoute) decision.ownerRoute = ownerRoute;
  return decision;
}

export function protectedSessionInitPayload({
  baselinePromptOnly = false,
  kind = "",
  decision = {},
  outboundWorkUnitOwnerSurface = TARGET_SESSION_OWNER
} = {}) {
  if (!isProtectedSessionInitTurn({ baselinePromptOnly, kind })) return null;
  const track = decision?.trackControl && typeof decision.trackControl === "object"
    ? decision.trackControl
    : {};
  return {
    schema: SESSION_INIT_PROTECTED_SCHEMA,
    kind: "SESSION_CONTEXT_BASELINE_REQUEST",
    baselinePromptOnly: true,
    requestedAction: sanitizeText(decision?.requestedAction, 5000),
    taskIntent: sanitizeText(decision?.taskIntent || decision?.intent, 2400),
    workUnit: sanitizeText(
      decision?.workUnit || decision?.boundedCurrentUnit || decision?.boundedWorkUnit,
      2400
    ),
    activeMilestone: sanitizeText(decision?.activeMilestone, 1200),
    requiredEvidence: textList(decision?.requiredEvidence),
    ownerRoute: sanitizeText(decision?.ownerRoute, 240) || AUTONOM_AGENT_LOCAL_SESSION_STATE,
    ownerResolution: sanitizeText(decision?.ownerResolution, 160) || LOCAL_AGENT_OWNER_RESOLUTION,
    outboundWorkUnitOwnerSurface: sanitizeText(outboundWorkUnitOwnerSurface, 240) || TARGET_SESSION_OWNER,
    exactTarget: sanitizeText(decision?.exactTarget, 1200),
    baseline: {
      schema: "eic.main-task-baseline.v3",
      trackStatus: sanitizeText(track?.status, 120),
      baselinePresent: track?.baselinePresent === true,
      correctionPrompt: sanitizeText(track?.correctionPrompt, 5000),
      currentActionRelation: sanitizeText(track?.currentActionRelation, 120)
    }
  };
}

export async function createSessionInitIntegritySeal(input = {}) {
  const canonicalPayload = protectedSessionInitPayload(input);
  if (!canonicalPayload) return null;
  return {
    schema: "eic.autonom.session-init-integrity.v1",
    expectedCanonicalDigest: await sha256Hex(stableStringify(canonicalPayload)),
    canonicalPayload
  };
}

export async function validateSessionInitIntegritySeal(seal, input = {}) {
  if (!seal) return { valid: true, code: "", expectedDigest: "", recomputedDigest: "" };
  const current = protectedSessionInitPayload(input);
  const recomputedDigest = current
    ? await sha256Hex(stableStringify(current))
    : "";
  const expectedDigest = sanitizeText(seal?.expectedCanonicalDigest, 128);
  const semanticInvariant = Boolean(current?.requestedAction) &&
    current?.kind === "SESSION_CONTEXT_BASELINE_REQUEST" &&
    current?.baselinePromptOnly === true &&
    current?.ownerRoute === AUTONOM_AGENT_LOCAL_SESSION_STATE &&
    current?.ownerResolution === LOCAL_AGENT_OWNER_RESOLUTION &&
    current?.outboundWorkUnitOwnerSurface === TARGET_SESSION_OWNER &&
    current?.outboundWorkUnitOwnerSurface !== current?.ownerRoute;
  const valid = Boolean(expectedDigest) &&
    recomputedDigest === expectedDigest &&
    semanticInvariant;
  return {
    valid,
    code: valid ? "" : SESSION_INIT_PROMPT_MUTATED,
    expectedDigest,
    recomputedDigest,
    currentPayload: current
  };
}

export async function validateSessionInitEffectIntegrity(effect = {}) {
  if (effect?.sessionContextBaseline !== true) {
    return { valid: true, code: "", expectedDigest: "", recomputedDigest: "" };
  }
  const integrity = effect?.sessionInitIntegrity || {};
  const expectedCanonicalDigest = sanitizeText(integrity?.expectedCanonicalDigest, 128);
  const canonicalPayload = integrity?.canonicalPayload || null;
  const recomputedCanonicalDigest = canonicalPayload
    ? await sha256Hex(stableStringify(canonicalPayload))
    : "";
  const expectedPromptDigest = sanitizeText(integrity?.expectedCompiledPromptDigest, 128);
  const recomputedPromptDigest = await sha256Hex(String(effect?.prompt || ""));
  const observedOutboundWorkUnitOwnerSurface = sanitizeText(
    integrity?.observedOutboundWorkUnitOwnerSurface,
    240
  );
  const semanticInvariant = canonicalPayload?.kind === "SESSION_CONTEXT_BASELINE_REQUEST" &&
    canonicalPayload?.baselinePromptOnly === true &&
    canonicalPayload?.ownerRoute === AUTONOM_AGENT_LOCAL_SESSION_STATE &&
    canonicalPayload?.ownerResolution === LOCAL_AGENT_OWNER_RESOLUTION &&
    canonicalPayload?.outboundWorkUnitOwnerSurface === TARGET_SESSION_OWNER &&
    canonicalPayload?.outboundWorkUnitOwnerSurface !== canonicalPayload?.ownerRoute &&
    observedOutboundWorkUnitOwnerSurface === TARGET_SESSION_OWNER &&
    observedOutboundWorkUnitOwnerSurface !== canonicalPayload?.ownerRoute &&
    Boolean(canonicalPayload?.requestedAction);
  const valid = Boolean(expectedCanonicalDigest) &&
    recomputedCanonicalDigest === expectedCanonicalDigest &&
    semanticInvariant &&
    Boolean(expectedPromptDigest) &&
    recomputedPromptDigest === expectedPromptDigest;
  return {
    valid,
    code: valid ? "" : SESSION_INIT_PROMPT_MUTATED,
    expectedDigest: expectedCanonicalDigest,
    recomputedDigest: recomputedCanonicalDigest,
    expectedPromptDigest,
    recomputedPromptDigest
  };
}
