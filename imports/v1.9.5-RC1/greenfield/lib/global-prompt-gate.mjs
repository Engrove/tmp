import { randomId } from "./common.mjs";
import { normalizePostDelaySeconds } from "./operator-settings.mjs";

export const GLOBAL_PROMPT_GATE_KEY = "eic.gf.global-prompt-post-gate.v1";
export const GLOBAL_PROMPT_GATE_SCHEMA = "eic.greenfield.global-prompt-post-gate.v2";
export const PROMPT_SEND_LEASE_MS = 120_000;

export const GLOBAL_RATE_LIMIT_STATES = Object.freeze({
  NORMAL: "NORMAL",
  COOLDOWN: "COOLDOWN",
  SERIAL_RECOVERY: "SERIAL_RECOVERY"
});

export const RATE_LIMIT_COOLDOWN_SECONDS = Object.freeze([180, 360, 720, 900]);
export const RATE_LIMIT_SERIAL_DELAYS_SECONDS = Object.freeze([180, 150, 120, 90, 90, 90]);
export const RATE_LIMIT_REQUIRED_SUCCESS_COUNT = RATE_LIMIT_SERIAL_DELAYS_SECONDS.length;
export const RATE_LIMIT_LATE_PREFLIGHT_MIN_DELAY_SECONDS = 90;
export const RATE_LIMIT_LEVEL_RESET_MS = 30 * 60 * 1000;
export const RATE_LIMIT_MAX_PROCESS_IDS = 128;

let gateQueue = Promise.resolve();

function serialize(work) {
  const next = gateQueue.then(work, work);
  gateQueue = next.catch(() => undefined);
  return next;
}

function finiteMs(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

function uniqueProcessIds(values = []) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const id = String(raw || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= RATE_LIMIT_MAX_PROCESS_IDS) break;
  }
  return out;
}

function normalizeRateLimit(value = {}) {
  const allowedStates = new Set(Object.values(GLOBAL_RATE_LIMIT_STATES));
  const state = allowedStates.has(String(value.state || ""))
    ? String(value.state)
    : GLOBAL_RATE_LIMIT_STATES.NORMAL;
  const epoch = Math.max(0, Number(value.epoch || 0) | 0);
  const level = Math.max(0, Math.min(RATE_LIMIT_COOLDOWN_SECONDS.length, Number(value.level || 0) | 0));
  const affectedProcessIds = uniqueProcessIds(value.affectedProcessIds);
  const preparedProcessIds = uniqueProcessIds(value.preparedProcessIds)
    .filter((id) => affectedProcessIds.includes(id));
  const recoveredProcessIds = uniqueProcessIds(value.recoveredProcessIds)
    .filter((id) => affectedProcessIds.includes(id));
  return {
    state: epoch > 0 ? state : GLOBAL_RATE_LIMIT_STATES.NORMAL,
    epoch,
    level,
    incidentKey: String(value.incidentKey || ""),
    lastWarningSignature: String(value.lastWarningSignature || ""),
    lastDetectedAtMs: finiteMs(value.lastDetectedAtMs),
    cooldownUntilMs: finiteMs(value.cooldownUntilMs),
    currentRecoveryProcessId: String(value.currentRecoveryProcessId || ""),
    currentRecoveryWindowId: Number.isInteger(Number(value.currentRecoveryWindowId))
      ? Number(value.currentRecoveryWindowId)
      : null,
    currentRecoveryClaimedAtMs: finiteMs(value.currentRecoveryClaimedAtMs),
    nextSerialNotBeforeAtMs: finiteMs(value.nextSerialNotBeforeAtMs),
    serialSuccessCount: Math.max(0, Number(value.serialSuccessCount || 0) | 0),
    affectedProcessIds,
    preparedProcessIds,
    recoveredProcessIds,
    lastSuccessfulProcessId: String(value.lastSuccessfulProcessId || ""),
    lastSuccessfulAtMs: finiteMs(value.lastSuccessfulAtMs)
  };
}

export function normalizeGlobalPromptGate(value = {}) {
  const lease = value.activeLease && typeof value.activeLease === "object"
    ? {
        reservationId: String(value.activeLease.reservationId || ""),
        processId: String(value.activeLease.processId || ""),
        windowId: Number.isInteger(Number(value.activeLease.windowId))
          ? Number(value.activeLease.windowId)
          : null,
        claimedAtMs: finiteMs(value.activeLease.claimedAtMs),
        expiresAtMs: finiteMs(value.activeLease.expiresAtMs)
      }
    : null;
  return {
    schema: GLOBAL_PROMPT_GATE_SCHEMA,
    reservationSeq: Math.max(0, Number(value.reservationSeq || 0) | 0),
    nextPromptNotBeforeAtMs: finiteMs(value.nextPromptNotBeforeAtMs),
    lastPromptPostedAtMs: finiteMs(value.lastPromptPostedAtMs),
    lastPromptProcessId: String(value.lastPromptProcessId || ""),
    lastPromptWindowId: Number.isInteger(Number(value.lastPromptWindowId))
      ? Number(value.lastPromptWindowId)
      : null,
    lastPromptHash: String(value.lastPromptHash || ""),
    lastReservation: value.lastReservation && typeof value.lastReservation === "object"
      ? {
          reservationId: String(value.lastReservation.reservationId || ""),
          processId: String(value.lastReservation.processId || ""),
          windowId: Number.isInteger(Number(value.lastReservation.windowId))
            ? Number(value.lastReservation.windowId)
            : null,
          promptHash: String(value.lastReservation.promptHash || ""),
          delaySeconds: normalizePostDelaySeconds(value.lastReservation.delaySeconds),
          reservedAtMs: finiteMs(value.lastReservation.reservedAtMs),
          notBeforeAtMs: finiteMs(value.lastReservation.notBeforeAtMs)
        }
      : null,
    activeLease: lease?.reservationId ? lease : null,
    rateLimit: normalizeRateLimit(value.rateLimit || {}),
    updatedAt: String(value.updatedAt || "")
  };
}

async function readRaw(storage) {
  const stored = await storage.get(GLOBAL_PROMPT_GATE_KEY);
  return normalizeGlobalPromptGate(stored?.[GLOBAL_PROMPT_GATE_KEY] || {});
}

async function writeReadback(next, storage) {
  const normalized = normalizeGlobalPromptGate(next);
  await storage.set({ [GLOBAL_PROMPT_GATE_KEY]: normalized });
  return readRaw(storage);
}

export async function readGlobalPromptGate(storage = chrome.storage.local) {
  return readRaw(storage);
}

export async function reserveGlobalPromptSlot({
  processId,
  windowId,
  promptHash,
  delaySeconds,
  now = Date.now(),
  storage = chrome.storage.local
}) {
  return serialize(async () => {
    const current = await readRaw(storage);
    const nowMs = finiteMs(now);
    const delay = normalizePostDelaySeconds(delaySeconds);
    const baseMs = Math.max(
      nowMs,
      finiteMs(current.nextPromptNotBeforeAtMs),
      finiteMs(current.lastPromptPostedAtMs)
    );
    const notBeforeAtMs = baseMs + delay * 1000;
    const reservationId = randomId("prompt-slot");
    const reservationSeq = Number(current.reservationSeq || 0) + 1;
    const next = {
      ...current,
      reservationSeq,
      nextPromptNotBeforeAtMs: notBeforeAtMs,
      lastReservation: {
        reservationId,
        processId: String(processId || ""),
        windowId: Number.isInteger(Number(windowId)) ? Number(windowId) : null,
        promptHash: String(promptHash || ""),
        delaySeconds: delay,
        reservedAtMs: nowMs,
        notBeforeAtMs
      },
      updatedAt: new Date(nowMs).toISOString()
    };
    const readback = await writeReadback(next, storage);
    if (readback.lastReservation?.reservationId !== reservationId ||
        readback.nextPromptNotBeforeAtMs !== notBeforeAtMs) {
      throw new Error("GLOBAL_PROMPT_SLOT_READBACK_MISMATCH");
    }
    return {
      ...readback.lastReservation,
      reservationSeq,
      waitMs: Math.max(0, notBeforeAtMs - nowMs),
      globalNextPromptNotBeforeAtMs: readback.nextPromptNotBeforeAtMs
    };
  });
}

export async function markGlobalRateLimitWarning({
  processId,
  windowId,
  incidentKey,
  warningSignature = "",
  activeProcessIds = [],
  now = Date.now(),
  storage = chrome.storage.local
}) {
  return serialize(async () => {
    const current = await readRaw(storage);
    const nowMs = finiteMs(now);
    const key = String(incidentKey || "").trim();
    if (!key) throw new Error("GLOBAL_RATE_LIMIT_INCIDENT_KEY_REQUIRED");

    const processIds = uniqueProcessIds([
      ...(current.rateLimit?.affectedProcessIds || []),
      ...activeProcessIds,
      processId
    ]);

    if (current.rateLimit?.incidentKey === key && current.rateLimit?.epoch > 0) {
      const same = {
        ...current,
        rateLimit: {
          ...current.rateLimit,
          affectedProcessIds: processIds,
          lastWarningSignature: String(warningSignature || current.rateLimit.lastWarningSignature || "")
        },
        updatedAt: new Date(nowMs).toISOString()
      };
      const readback = await writeReadback(same, storage);
      return {
        newIncident: false,
        rateLimit: readback.rateLimit,
        gate: readback
      };
    }

    const recent = current.rateLimit?.lastDetectedAtMs > 0 &&
      nowMs - current.rateLimit.lastDetectedAtMs <= RATE_LIMIT_LEVEL_RESET_MS;
    const priorLevel = recent ? Math.max(0, Number(current.rateLimit?.level || 0)) : 0;
    const level = Math.min(RATE_LIMIT_COOLDOWN_SECONDS.length, Math.max(1, priorLevel + 1));
    const cooldownSeconds = RATE_LIMIT_COOLDOWN_SECONDS[level - 1];
    const cooldownUntilMs = nowMs + cooldownSeconds * 1000;
    const epoch = Math.max(0, Number(current.rateLimit?.epoch || 0)) + 1;
    const rateLimit = {
      state: GLOBAL_RATE_LIMIT_STATES.COOLDOWN,
      epoch,
      level,
      incidentKey: key,
      lastWarningSignature: String(warningSignature || ""),
      lastDetectedAtMs: nowMs,
      cooldownUntilMs,
      currentRecoveryProcessId: "",
      currentRecoveryWindowId: null,
      currentRecoveryClaimedAtMs: 0,
      nextSerialNotBeforeAtMs: cooldownUntilMs,
      serialSuccessCount: 0,
      affectedProcessIds: uniqueProcessIds([...activeProcessIds, processId]),
      preparedProcessIds: [],
      recoveredProcessIds: [],
      lastSuccessfulProcessId: "",
      lastSuccessfulAtMs: 0
    };
    const next = {
      ...current,
      activeLease: null,
      nextPromptNotBeforeAtMs: Math.max(
        finiteMs(current.nextPromptNotBeforeAtMs),
        cooldownUntilMs
      ),
      rateLimit,
      updatedAt: new Date(nowMs).toISOString()
    };
    const readback = await writeReadback(next, storage);
    if (readback.rateLimit?.epoch !== epoch ||
        readback.rateLimit?.cooldownUntilMs !== cooldownUntilMs ||
        readback.rateLimit?.state !== GLOBAL_RATE_LIMIT_STATES.COOLDOWN) {
      throw new Error("GLOBAL_RATE_LIMIT_WARNING_READBACK_MISMATCH");
    }
    return {
      newIncident: true,
      cooldownSeconds,
      rateLimit: readback.rateLimit,
      gate: readback
    };
  });
}

function rateLimitClaimContext(rateLimit, processId, normalDelaySeconds, nowMs) {
  const rate = normalizeRateLimit(rateLimit || {});
  const affected = rate.affectedProcessIds.includes(String(processId || ""));
  const prepared = rate.preparedProcessIds.includes(String(processId || ""));
  const preflightRequired = affected && !prepared;
  let state = rate.state;
  if (state === GLOBAL_RATE_LIMIT_STATES.COOLDOWN && nowMs >= rate.cooldownUntilMs) {
    state = GLOBAL_RATE_LIMIT_STATES.SERIAL_RECOVERY;
  }

  let effectiveDelaySeconds = normalDelaySeconds;
  let nextSerialNotBeforeAtMs = 0;
  if (state === GLOBAL_RATE_LIMIT_STATES.SERIAL_RECOVERY) {
    const index = Math.min(
      Math.max(0, Number(rate.serialSuccessCount || 0)),
      RATE_LIMIT_SERIAL_DELAYS_SECONDS.length - 1
    );
    effectiveDelaySeconds = Math.max(
      normalDelaySeconds,
      RATE_LIMIT_SERIAL_DELAYS_SECONDS[index]
    );
    nextSerialNotBeforeAtMs = rate.nextSerialNotBeforeAtMs;
  } else if (state === GLOBAL_RATE_LIMIT_STATES.NORMAL && preflightRequired) {
    effectiveDelaySeconds = Math.max(
      normalDelaySeconds,
      RATE_LIMIT_LATE_PREFLIGHT_MIN_DELAY_SECONDS
    );
  }

  return {
    rate,
    state,
    affected,
    prepared,
    preflightRequired,
    effectiveDelaySeconds,
    nextSerialNotBeforeAtMs
  };
}

export async function claimGlobalPromptSend({
  reservationId,
  processId,
  windowId,
  promptHash,
  delaySeconds,
  reservationNotBeforeAtMs = 0,
  now = Date.now(),
  storage = chrome.storage.local
}) {
  return serialize(async () => {
    const current = await readRaw(storage);
    const nowMs = finiteMs(now);
    const normalDelay = normalizePostDelaySeconds(delaySeconds);
    const rateContext = rateLimitClaimContext(current.rateLimit, processId, normalDelay, nowMs);
    const lease = current.activeLease;
    if (lease?.reservationId &&
        lease.reservationId !== String(reservationId || "") &&
        lease.expiresAtMs > nowMs) {
      return {
        allowed: false,
        reason: "GLOBAL_PROMPT_SEND_LEASE_BUSY",
        retryAfterMs: Math.min(1000, Math.max(100, lease.expiresAtMs - nowMs)),
        notBeforeAtMs: Math.max(finiteMs(reservationNotBeforeAtMs), nowMs),
        rateLimit: rateContext.rate
      };
    }

    if (rateContext.rate.state === GLOBAL_RATE_LIMIT_STATES.COOLDOWN &&
        nowMs < rateContext.rate.cooldownUntilMs) {
      return {
        allowed: false,
        reason: "GLOBAL_RATE_LIMIT_COOLDOWN",
        retryAfterMs: Math.min(30_000, Math.max(100, rateContext.rate.cooldownUntilMs - nowMs)),
        notBeforeAtMs: Math.max(
          finiteMs(reservationNotBeforeAtMs),
          rateContext.rate.cooldownUntilMs
        ),
        rateLimit: rateContext.rate
      };
    }

    const actualSpacingFloor = current.lastPromptPostedAtMs > 0
      ? current.lastPromptPostedAtMs + rateContext.effectiveDelaySeconds * 1000
      : 0;
    const notBeforeAtMs = Math.max(
      finiteMs(reservationNotBeforeAtMs),
      actualSpacingFloor,
      finiteMs(rateContext.nextSerialNotBeforeAtMs)
    );
    if (nowMs < notBeforeAtMs) {
      return {
        allowed: false,
        reason: rateContext.state === GLOBAL_RATE_LIMIT_STATES.SERIAL_RECOVERY
          ? "GLOBAL_RATE_LIMIT_SERIAL_PAUSE"
          : "GLOBAL_PROMPT_POST_PAUSE",
        retryAfterMs: Math.min(30_000, Math.max(100, notBeforeAtMs - nowMs)),
        notBeforeAtMs,
        rateLimit: {
          ...rateContext.rate,
          state: rateContext.state
        }
      };
    }

    const activeLease = {
      reservationId: String(reservationId || ""),
      processId: String(processId || ""),
      windowId: Number.isInteger(Number(windowId)) ? Number(windowId) : null,
      claimedAtMs: nowMs,
      expiresAtMs: nowMs + PROMPT_SEND_LEASE_MS
    };
    const nextRateLimit = {
      ...rateContext.rate,
      state: rateContext.state,
      currentRecoveryProcessId:
        rateContext.state !== GLOBAL_RATE_LIMIT_STATES.NORMAL || rateContext.preflightRequired
          ? String(processId || "")
          : "",
      currentRecoveryWindowId:
        rateContext.state !== GLOBAL_RATE_LIMIT_STATES.NORMAL || rateContext.preflightRequired
          ? (Number.isInteger(Number(windowId)) ? Number(windowId) : null)
          : null,
      currentRecoveryClaimedAtMs:
        rateContext.state !== GLOBAL_RATE_LIMIT_STATES.NORMAL || rateContext.preflightRequired
          ? nowMs
          : 0
    };
    const next = {
      ...current,
      activeLease,
      rateLimit: nextRateLimit,
      updatedAt: new Date(nowMs).toISOString()
    };
    const readback = await writeReadback(next, storage);
    if (readback.activeLease?.reservationId !== activeLease.reservationId) {
      throw new Error("GLOBAL_PROMPT_SEND_LEASE_READBACK_MISMATCH");
    }
    return {
      allowed: true,
      reason: "GLOBAL_PROMPT_SEND_LEASE_ACQUIRED",
      notBeforeAtMs,
      lease: readback.activeLease,
      promptHash: String(promptHash || ""),
      effectiveDelaySeconds: rateContext.effectiveDelaySeconds,
      recovery: {
        state: readback.rateLimit.state,
        epoch: readback.rateLimit.epoch,
        level: readback.rateLimit.level,
        preflightRequired: rateContext.preflightRequired,
        affected: rateContext.affected,
        prepared: rateContext.prepared,
        serialSuccessCount: readback.rateLimit.serialSuccessCount
      },
      rateLimit: readback.rateLimit
    };
  });
}

export async function markGlobalRateLimitPreflightComplete({
  processId,
  windowId,
  epoch,
  now = Date.now(),
  storage = chrome.storage.local
}) {
  return serialize(async () => {
    const current = await readRaw(storage);
    const nowMs = finiteMs(now);
    const expectedEpoch = Math.max(0, Number(epoch || 0) | 0);
    if (!expectedEpoch || current.rateLimit?.epoch !== expectedEpoch) {
      return {
        ok: false,
        reason: "GLOBAL_RATE_LIMIT_EPOCH_CHANGED",
        rateLimit: current.rateLimit,
        gate: current
      };
    }
    const id = String(processId || "");
    if (!current.rateLimit.affectedProcessIds.includes(id)) {
      return {
        ok: false,
        reason: "GLOBAL_RATE_LIMIT_PROCESS_NOT_AFFECTED",
        rateLimit: current.rateLimit,
        gate: current
      };
    }
    const preparedProcessIds = uniqueProcessIds([
      ...current.rateLimit.preparedProcessIds,
      id
    ]);
    const next = {
      ...current,
      rateLimit: {
        ...current.rateLimit,
        preparedProcessIds,
        currentRecoveryProcessId: id,
        currentRecoveryWindowId: Number.isInteger(Number(windowId)) ? Number(windowId) : null,
        currentRecoveryClaimedAtMs: nowMs
      },
      updatedAt: new Date(nowMs).toISOString()
    };
    const readback = await writeReadback(next, storage);
    if (!readback.rateLimit.preparedProcessIds.includes(id)) {
      throw new Error("GLOBAL_RATE_LIMIT_PREFLIGHT_READBACK_MISMATCH");
    }
    return {
      ok: true,
      reason: "GLOBAL_RATE_LIMIT_PREFLIGHT_COMMITTED",
      rateLimit: readback.rateLimit,
      gate: readback
    };
  });
}

export async function commitGlobalPromptPost({
  reservationId,
  processId,
  windowId,
  promptHash,
  postedAtMs = Date.now(),
  storage = chrome.storage.local
}) {
  return serialize(async () => {
    const current = await readRaw(storage);
    const postedMs = Math.max(finiteMs(postedAtMs), finiteMs(current.lastPromptPostedAtMs));
    const clearLease = !current.activeLease?.reservationId ||
      current.activeLease.reservationId === String(reservationId || "");

    const rate = normalizeRateLimit(current.rateLimit || {});
    const id = String(processId || "");
    const prepared = rate.preparedProcessIds.includes(id);
    const affected = rate.affectedProcessIds.includes(id);
    const recoveredProcessIds = affected && prepared
      ? uniqueProcessIds([...rate.recoveredProcessIds, id])
      : rate.recoveredProcessIds;

    let nextRateLimit = {
      ...rate,
      recoveredProcessIds,
      currentRecoveryProcessId: rate.currentRecoveryProcessId === id ? "" : rate.currentRecoveryProcessId,
      currentRecoveryWindowId: rate.currentRecoveryProcessId === id ? null : rate.currentRecoveryWindowId,
      currentRecoveryClaimedAtMs: rate.currentRecoveryProcessId === id ? 0 : rate.currentRecoveryClaimedAtMs,
      lastSuccessfulProcessId: id,
      lastSuccessfulAtMs: postedMs
    };

    if (rate.state === GLOBAL_RATE_LIMIT_STATES.SERIAL_RECOVERY) {
      const serialSuccessCount = Math.max(0, Number(rate.serialSuccessCount || 0)) + 1;
      if (serialSuccessCount >= RATE_LIMIT_REQUIRED_SUCCESS_COUNT) {
        nextRateLimit = {
          ...nextRateLimit,
          state: GLOBAL_RATE_LIMIT_STATES.NORMAL,
          serialSuccessCount,
          nextSerialNotBeforeAtMs: 0
        };
      } else {
        const nextIndex = Math.min(
          serialSuccessCount,
          RATE_LIMIT_SERIAL_DELAYS_SECONDS.length - 1
        );
        nextRateLimit = {
          ...nextRateLimit,
          state: GLOBAL_RATE_LIMIT_STATES.SERIAL_RECOVERY,
          serialSuccessCount,
          nextSerialNotBeforeAtMs:
            postedMs + RATE_LIMIT_SERIAL_DELAYS_SECONDS[nextIndex] * 1000
        };
      }
    }

    const next = {
      ...current,
      lastPromptPostedAtMs: postedMs,
      lastPromptProcessId: id,
      lastPromptWindowId: Number.isInteger(Number(windowId)) ? Number(windowId) : null,
      lastPromptHash: String(promptHash || ""),
      activeLease: clearLease ? null : current.activeLease,
      rateLimit: nextRateLimit,
      updatedAt: new Date(postedMs).toISOString()
    };
    const readback = await writeReadback(next, storage);
    if (readback.lastPromptPostedAtMs !== postedMs ||
        readback.lastPromptProcessId !== id) {
      throw new Error("GLOBAL_PROMPT_POST_READBACK_MISMATCH");
    }
    return readback;
  });
}

export async function releaseGlobalPromptLease({
  reservationId,
  now = Date.now(),
  storage = chrome.storage.local
}) {
  return serialize(async () => {
    const current = await readRaw(storage);
    if (!current.activeLease?.reservationId ||
        current.activeLease.reservationId !== String(reservationId || "")) {
      return current;
    }
    const leaseProcessId = String(current.activeLease.processId || "");
    const rateLimit = current.rateLimit?.currentRecoveryProcessId === leaseProcessId
      ? {
          ...current.rateLimit,
          currentRecoveryProcessId: "",
          currentRecoveryWindowId: null,
          currentRecoveryClaimedAtMs: 0
        }
      : current.rateLimit;
    const next = {
      ...current,
      activeLease: null,
      rateLimit,
      updatedAt: new Date(finiteMs(now)).toISOString()
    };
    const readback = await writeReadback(next, storage);
    if (readback.activeLease) throw new Error("GLOBAL_PROMPT_LEASE_RELEASE_READBACK_MISMATCH");
    return readback;
  });
}
