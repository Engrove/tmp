import { deepClone, nowIso, sanitizeText } from "./common.mjs";

export const CAUSAL_CONTROL_SCHEMA = "eic.autonom.causal-control.v1";

export const CAUSAL_PLANES = Object.freeze({
  MISSION: "MISSION",
  CONTROL: "CONTROL",
  OBSERVATION: "OBSERVATION",
  ACCEPTANCE_HARNESS: "ACCEPTANCE_HARNESS"
});

export const CAUSAL_EFFECT_STATUS = Object.freeze({
  OPEN: "OPEN",
  DELIVERED: "DELIVERED",
  ACKED: "ACKED",
  RESPONSE_BOUND: "RESPONSE_BOUND",
  RESPONSE_CONSUMED: "RESPONSE_CONSUMED",
  CLOSED: "CLOSED",
  CANCELLED: "CANCELLED",
  FAILED: "FAILED"
});

export const CAUSAL_EVENT = Object.freeze({
  EFFECT_REGISTER: "EFFECT_REGISTER",
  EFFECT_STATUS: "EFFECT_STATUS",
  MATERIAL_EVENT: "MATERIAL_EVENT",
  RESPONSE_BIND: "RESPONSE_BIND",
  RESPONSE_CONSUME: "RESPONSE_CONSUME",
  WAIT_ENTER: "WAIT_ENTER",
  WAIT_WAKE: "WAIT_WAKE",
  POLICY_FENCE: "POLICY_FENCE",
  POLICY_FENCE_CLEAR: "POLICY_FENCE_CLEAR",
  TERMINALIZE: "TERMINALIZE"
});

const TERMINAL_EFFECT = new Set([
  CAUSAL_EFFECT_STATUS.CLOSED,
  CAUSAL_EFFECT_STATUS.CANCELLED,
  CAUSAL_EFFECT_STATUS.FAILED
]);

const LEGACY_EFFECT_STATUS = Object.freeze({
  PREPARED: CAUSAL_EFFECT_STATUS.OPEN,
  RETRY_PREPARED: CAUSAL_EFFECT_STATUS.OPEN,
  SUBMITTING: CAUSAL_EFFECT_STATUS.DELIVERED,
  SUBMITTED_UNCONFIRMED: CAUSAL_EFFECT_STATUS.DELIVERED,
  ACKED: CAUSAL_EFFECT_STATUS.ACKED,
  UNCERTAIN_EXHAUSTED: CAUSAL_EFFECT_STATUS.FAILED,
  CANCELLED_SUPERSEDED: CAUSAL_EFFECT_STATUS.CANCELLED,
  CANCELLED_OPERATOR_ACTION: CAUSAL_EFFECT_STATUS.CANCELLED,
  PAYLOAD_INTEGRITY_FAILED: CAUSAL_EFFECT_STATUS.FAILED,
  SESSION_INIT_PROMPT_INTEGRITY_FAILED: CAUSAL_EFFECT_STATUS.FAILED
});

function text(value, limit = 512) {
  return sanitizeText(value, limit);
}

function normalizeEffect(effect = {}) {
  return {
    effectId: text(effect.effectId, 180),
    turnId: text(effect.turnId, 180),
    plane: Object.values(CAUSAL_PLANES).includes(effect.plane) ? effect.plane : CAUSAL_PLANES.CONTROL,
    effectClass: text(effect.effectClass || effect.turnKind, 180),
    correlationId: text(effect.correlationId || effect.effectId, 180),
    responseContract: text(effect.responseContract, 80),
    sourceObservationIdentity: text(effect.sourceObservationIdentity, 512),
    generation: Math.max(0, Number(effect.generation || 0)),
    status: Object.values(CAUSAL_EFFECT_STATUS).includes(effect.status)
      ? effect.status
      : CAUSAL_EFFECT_STATUS.OPEN,
    registeredAt: effect.registeredAt || null,
    deliveredAt: effect.deliveredAt || null,
    ackedAt: effect.ackedAt || null,
    responseBoundAt: effect.responseBoundAt || null,
    responseConsumedAt: effect.responseConsumedAt || null,
    closedAt: effect.closedAt || null,
    closeReason: text(effect.closeReason, 240)
  };
}

export function createCausalControlState({ runId = "", now = Date.now() } = {}) {
  return {
    schema: CAUSAL_CONTROL_SCHEMA,
    revision: 0,
    runId: text(runId, 180),
    materialGeneration: 0,
    lastMaterialEventKey: "",
    lastMaterialEventPlane: "",
    activeEffectId: "",
    effects: [],
    responseBinding: null,
    wait: null,
    policyFence: null,
    terminal: null,
    updatedAt: nowIso(now)
  };
}

export function normalizeCausalControlState(value = {}, { runId = "", now = Date.now() } = {}) {
  const base = createCausalControlState({ runId, now });
  const effects = Array.isArray(value?.effects)
    ? value.effects.map(normalizeEffect).filter((item) => item.effectId)
    : [];
  return {
    ...base,
    ...(value && typeof value === "object" ? value : {}),
    schema: CAUSAL_CONTROL_SCHEMA,
    revision: Math.max(0, Number(value?.revision || 0)),
    runId: text(value?.runId || runId, 180),
    materialGeneration: Math.max(0, Number(value?.materialGeneration || 0)),
    lastMaterialEventKey: text(value?.lastMaterialEventKey, 512),
    lastMaterialEventPlane: text(value?.lastMaterialEventPlane, 48),
    activeEffectId: text(value?.activeEffectId, 180),
    effects,
    responseBinding: value?.responseBinding && typeof value.responseBinding === "object"
      ? deepClone(value.responseBinding)
      : null,
    wait: value?.wait && typeof value.wait === "object" ? deepClone(value.wait) : null,
    policyFence: value?.policyFence && typeof value.policyFence === "object" ? deepClone(value.policyFence) : null,
    terminal: value?.terminal && typeof value.terminal === "object" ? deepClone(value.terminal) : null,
    updatedAt: value?.updatedAt || nowIso(now)
  };
}

function effectIndex(state, effectId) {
  const id = text(effectId, 180);
  return state.effects.findIndex((item) => item.effectId === id);
}

function closeEffect(state, index, reason, now) {
  if (index < 0) return;
  const effect = normalizeEffect(state.effects[index]);
  if (!TERMINAL_EFFECT.has(effect.status)) {
    effect.status = CAUSAL_EFFECT_STATUS.CLOSED;
    effect.closedAt = nowIso(now);
    effect.closeReason = text(reason, 240);
  }
  state.effects[index] = effect;
  if (state.activeEffectId === effect.effectId) state.activeEffectId = "";
  if (state.responseBinding?.effectId === effect.effectId) state.responseBinding = null;
}

function commit(state, now) {
  state.revision = Math.max(0, Number(state.revision || 0)) + 1;
  state.updatedAt = nowIso(now);
  return state;
}

/**
 * Sole commit authority for the causal CONTROL aggregate.
 * Other subsystems may produce observations/classifications/requests only.
 */
export function reduceCausalControl(current = {}, event = {}, { runId = "", now = Date.now() } = {}) {
  const state = normalizeCausalControlState(current, { runId, now });
  const type = text(event?.type, 80);
  if (!type) return { state, accepted: false, reason: "MISSING_EVENT_TYPE" };
  if (state.terminal && type !== CAUSAL_EVENT.TERMINALIZE) {
    return { state, accepted: false, reason: "CAUSAL_UNIT_TERMINAL" };
  }

  if (type === CAUSAL_EVENT.EFFECT_REGISTER) {
    const id = text(event.effectId, 180);
    if (!id) return { state, accepted: false, reason: "MISSING_EFFECT_ID" };
    const oldActive = state.activeEffectId;
    if (oldActive && oldActive !== id) {
      closeEffect(state, effectIndex(state, oldActive), "SUPERSEDED_BY_NEW_CONTROL_EFFECT", now);
    }
    let idx = effectIndex(state, id);
    if (idx >= 0 && TERMINAL_EFFECT.has(state.effects[idx].status)) {
      return { state, accepted: false, reason: "EFFECT_ALREADY_TERMINAL", effect: deepClone(state.effects[idx]) };
    }
    const existing = idx >= 0 ? state.effects[idx] : {};
    const normalized = normalizeEffect({
      ...existing,
      effectId: id,
      turnId: event.turnId,
      plane: CAUSAL_PLANES.CONTROL,
      effectClass: event.effectClass,
      correlationId: event.correlationId || id,
      responseContract: event.responseContract,
      sourceObservationIdentity: event.sourceObservationIdentity,
      generation: Number.isFinite(Number(existing.generation))
        ? Number(existing.generation)
        : state.materialGeneration,
      status: existing.status || CAUSAL_EFFECT_STATUS.OPEN,
      registeredAt: existing.registeredAt || nowIso(now)
    });
    if (idx < 0) {
      state.effects.push(normalized);
      idx = state.effects.length - 1;
    } else {
      state.effects[idx] = normalized;
    }
    state.activeEffectId = id;
    return { state: commit(state, now), accepted: true, effect: deepClone(state.effects[idx]) };
  }

  if (type === CAUSAL_EVENT.EFFECT_STATUS) {
    const idx = effectIndex(state, event.effectId);
    if (idx < 0) return { state, accepted: false, reason: "UNKNOWN_EFFECT" };
    const status = Object.values(CAUSAL_EFFECT_STATUS).includes(event.status) ? event.status : "";
    if (!status) return { state, accepted: false, reason: "INVALID_EFFECT_STATUS" };
    const effect = normalizeEffect(state.effects[idx]);
    if (TERMINAL_EFFECT.has(effect.status) && effect.status !== status) {
      return { state, accepted: false, reason: "EFFECT_ALREADY_TERMINAL" };
    }
    effect.status = status;
    if (status === CAUSAL_EFFECT_STATUS.DELIVERED) effect.deliveredAt ||= nowIso(now);
    if (status === CAUSAL_EFFECT_STATUS.ACKED) effect.ackedAt ||= nowIso(now);
    if (status === CAUSAL_EFFECT_STATUS.RESPONSE_BOUND) effect.responseBoundAt ||= nowIso(now);
    if (status === CAUSAL_EFFECT_STATUS.RESPONSE_CONSUMED) effect.responseConsumedAt ||= nowIso(now);
    if (TERMINAL_EFFECT.has(status)) {
      effect.closedAt ||= nowIso(now);
      effect.closeReason = text(event.reason || status, 240);
      if (state.activeEffectId === effect.effectId) state.activeEffectId = "";
      if (state.responseBinding?.effectId === effect.effectId) state.responseBinding = null;
    }
    state.effects[idx] = effect;
    return { state: commit(state, now), accepted: true, effect: deepClone(effect) };
  }

  if (type === CAUSAL_EVENT.MATERIAL_EVENT) {
    const key = text(event.eventKey, 512);
    const plane = Object.values(CAUSAL_PLANES).includes(event.plane) ? event.plane : CAUSAL_PLANES.MISSION;
    if (!key) return { state, accepted: false, reason: "MISSING_MATERIAL_EVENT_KEY" };
    if (key === state.lastMaterialEventKey) {
      return { state, accepted: true, duplicate: true, materialGeneration: state.materialGeneration };
    }
    state.materialGeneration += 1;
    state.lastMaterialEventKey = key;
    state.lastMaterialEventPlane = plane;
    if (state.activeEffectId && event.preserveActiveEffectId !== state.activeEffectId) {
      closeEffect(state, effectIndex(state, state.activeEffectId), "SUPERSEDED_BY_NEW_MATERIAL_EVENT", now);
    }
    state.responseBinding = null;
    if (state.policyFence && Number(state.policyFence.generation) < state.materialGeneration) {
      state.policyFence = null;
    }
    return { state: commit(state, now), accepted: true, duplicate: false, materialGeneration: state.materialGeneration };
  }

  if (type === CAUSAL_EVENT.RESPONSE_BIND) {
    const idx = effectIndex(state, event.effectId || state.activeEffectId);
    if (idx < 0) return { state, accepted: false, reason: "NO_ACTIVE_EFFECT" };
    const effect = normalizeEffect(state.effects[idx]);
    const responseIdentity = text(event.responseIdentity, 512);
    if (!responseIdentity) return { state, accepted: false, reason: "MISSING_RESPONSE_IDENTITY" };
    if (state.activeEffectId !== effect.effectId) return { state, accepted: false, reason: "EFFECT_NOT_ACTIVE" };
    if (effect.status !== CAUSAL_EFFECT_STATUS.ACKED) return { state, accepted: false, reason: "EFFECT_NOT_ACKED" };
    if (effect.generation !== state.materialGeneration) return { state, accepted: false, reason: "STALE_CAUSAL_GENERATION" };
    if (!effect.responseContract) return { state, accepted: false, reason: "MISSING_RESPONSE_CONTRACT" };
    state.responseBinding = {
      schema: "eic.autonom.response-binding.v1",
      plane: CAUSAL_PLANES.CONTROL,
      effectId: effect.effectId,
      turnId: effect.turnId,
      correlationId: effect.correlationId,
      generation: effect.generation,
      responseContract: effect.responseContract,
      responseIdentity,
      responseHash: text(event.responseHash, 128),
      boundAt: nowIso(now),
      consumedAt: null
    };
    effect.status = CAUSAL_EFFECT_STATUS.RESPONSE_BOUND;
    effect.responseBoundAt = nowIso(now);
    state.effects[idx] = effect;
    return { state: commit(state, now), accepted: true, binding: deepClone(state.responseBinding), effect: deepClone(effect) };
  }

  if (type === CAUSAL_EVENT.RESPONSE_CONSUME) {
    const responseIdentity = text(event.responseIdentity, 512);
    const binding = state.responseBinding;
    if (!binding || binding.responseIdentity !== responseIdentity) {
      return { state, accepted: false, reason: "RESPONSE_BINDING_MISMATCH" };
    }
    const idx = effectIndex(state, binding.effectId);
    if (idx < 0) return { state, accepted: false, reason: "BOUND_EFFECT_MISSING" };
    const effect = normalizeEffect(state.effects[idx]);
    if (effect.status !== CAUSAL_EFFECT_STATUS.RESPONSE_BOUND) {
      return { state, accepted: false, reason: "EFFECT_NOT_RESPONSE_BOUND" };
    }
    effect.status = CAUSAL_EFFECT_STATUS.RESPONSE_CONSUMED;
    effect.responseConsumedAt = nowIso(now);
    state.effects[idx] = effect;
    const consumedBinding = { ...binding, consumedAt: nowIso(now) };
    closeEffect(state, idx, "RESPONSE_CONSUMED", now);
    return { state: commit(state, now), accepted: true, binding: consumedBinding, effect: deepClone(state.effects[idx]) };
  }

  if (type === CAUSAL_EVENT.WAIT_ENTER) {
    const waitKind = text(event.waitKind, 80);
    const predicateKey = text(event.predicateKey, 320);
    if (!waitKind || !predicateKey) return { state, accepted: false, reason: "INVALID_WAIT" };
    state.wait = {
      schema: "eic.autonom.causal-wait.v1",
      waitKind,
      causalUnitId: text(event.causalUnitId || runId, 180),
      predicateKey,
      baselineDigest: text(event.baselineDigest, 512),
      allowedWakeSources: Array.isArray(event.allowedWakeSources)
        ? event.allowedWakeSources.map((x) => text(x, 80)).filter(Boolean)
        : [],
      enteredGeneration: state.materialGeneration,
      enteredAt: nowIso(now)
    };
    return { state: commit(state, now), accepted: true, wait: deepClone(state.wait) };
  }

  if (type === CAUSAL_EVENT.WAIT_WAKE) {
    if (!state.wait) return { state, accepted: false, reason: "NO_ACTIVE_WAIT" };
    const source = text(event.source, 80);
    const predicateKey = text(event.predicateKey, 320);
    const digest = text(event.currentDigest, 512);
    if (predicateKey !== state.wait.predicateKey) return { state, accepted: false, reason: "WAIT_PREDICATE_MISMATCH" };
    if (state.wait.allowedWakeSources.length && !state.wait.allowedWakeSources.includes(source)) {
      return { state, accepted: false, reason: "WAKE_SOURCE_NOT_ALLOWED" };
    }
    if (!digest || digest === state.wait.baselineDigest) {
      return { state, accepted: false, reason: "WAIT_PREDICATE_UNCHANGED" };
    }
    if (state.activeEffectId) {
      closeEffect(state, effectIndex(state, state.activeEffectId), "SUPERSEDED_BY_WAIT_WAKE", now);
    }
    state.wait = null;
    state.materialGeneration += 1;
    state.lastMaterialEventKey = `wait-wake:${predicateKey}:${digest}`;
    state.lastMaterialEventPlane = CAUSAL_PLANES.OBSERVATION;
    if (state.policyFence && Number(state.policyFence.generation) < state.materialGeneration) state.policyFence = null;
    return { state: commit(state, now), accepted: true, materialGeneration: state.materialGeneration };
  }

  if (type === CAUSAL_EVENT.POLICY_FENCE) {
    state.policyFence = {
      schema: "eic.autonom.policy-fence.v1",
      code: text(event.code, 120),
      generation: state.materialGeneration,
      causalUnitId: text(event.causalUnitId || runId, 180),
      reason: text(event.reason, 500),
      createdAt: nowIso(now)
    };
    return { state: commit(state, now), accepted: true, policyFence: deepClone(state.policyFence) };
  }

  if (type === CAUSAL_EVENT.POLICY_FENCE_CLEAR) {
    state.policyFence = null;
    return { state: commit(state, now), accepted: true };
  }

  if (type === CAUSAL_EVENT.TERMINALIZE) {
    for (let i = 0; i < state.effects.length; i += 1) {
      closeEffect(state, i, `CAUSAL_TERMINAL:${text(event.reason, 160) || "TERMINAL"}`, now);
    }
    state.activeEffectId = "";
    state.responseBinding = null;
    state.wait = null;
    state.policyFence = null;
    state.terminal = {
      state: text(event.terminalState, 80) || "TERMINAL",
      reason: text(event.reason, 500),
      generation: state.materialGeneration,
      committedAt: nowIso(now)
    };
    return { state: commit(state, now), accepted: true, terminal: deepClone(state.terminal) };
  }

  return { state, accepted: false, reason: `UNKNOWN_EVENT:${type}` };
}

export function ensureCausalControl(run = {}, { now = Date.now() } = {}) {
  run.causalControl = normalizeCausalControlState(run.causalControl, { runId: run.runId, now });
  return run;
}

export function commitCausalControl(run = {}, event = {}, { now = Date.now() } = {}) {
  const result = reduceCausalControl(run.causalControl, event, { runId: run.runId, now });
  if (result.accepted) run.causalControl = result.state;
  return { run, ...result };
}

export function mapLegacyEffectStatus(status = "") {
  return LEGACY_EFFECT_STATUS[String(status || "").trim().toUpperCase()] || "";
}

export function activeCausalEffect(run = {}) {
  const state = normalizeCausalControlState(run.causalControl, { runId: run.runId });
  if (!state.activeEffectId) return null;
  return state.effects.find((item) => item.effectId === state.activeEffectId) || null;
}

export function activeResponseBinding(run = {}) {
  const state = normalizeCausalControlState(run.causalControl, { runId: run.runId });
  return state.responseBinding ? deepClone(state.responseBinding) : null;
}

export function responseContractForBoundControl(run = {}, responseIdentity = "") {
  const binding = activeResponseBinding(run);
  const identity = text(responseIdentity, 512);
  if (!binding || !identity || binding.responseIdentity !== identity) return "";
  if (binding.plane !== CAUSAL_PLANES.CONTROL) return "";
  return text(binding.responseContract, 80);
}

export function causalWaitIsQuiescent(run = {}) {
  const state = normalizeCausalControlState(run.causalControl, { runId: run.runId });
  return Boolean(state.wait);
}

export function causalPolicyFenceActive(run = {}) {
  const state = normalizeCausalControlState(run.causalControl, { runId: run.runId });
  return Boolean(
    state.policyFence &&
    Number(state.policyFence.generation) === Number(state.materialGeneration)
  );
}

export function causalRecoveryBlocked(run = {}) {
  return causalPolicyFenceActive(run);
}

export function latestUserOwnsControlPrompt(page = {}, effect = null) {
  if (!effect) return false;
  const turnId = text(effect.turnId, 180);
  const latestUser = text(page?.latestUser, 12000);
  if (turnId && latestUser.includes(`EIC_AGENT_TURN_ID: ${turnId}`)) return true;
  if (turnId && latestUser.includes(`EIC_TURN_ID: ${turnId}`)) return true;
  if (turnId && latestUser.includes(`EIC_TURN: ${turnId}`)) return true;

  // v0.12.3 compatibility: canonical EIC-AA/5 prompts carried turnId only
  // inside the compact JSON envelope. A prompt submitted by the extension
  // must never be reclassified as a new human/material user event merely
  // because promptAckDigest is not yet available.
  if (turnId) {
    const escaped = turnId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const jsonTurn = new RegExp(`["']turnId["']\\s*:\\s*["']${escaped}["']`, "u");
    if (jsonTurn.test(latestUser)) return true;
  }

  const digest = text(effect.promptAckDigest, 256);
  return Boolean(digest && digest === text(page?.latestUserHash, 256));
}
