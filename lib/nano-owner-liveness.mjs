export const NANO_CONTINUATION_ANALYSIS_DEADLINE_MS = 180_000;
export const NANO_OWNER_INVALIDATED_CODE = "NANO_OWNER_INVALIDATED";

const OWNER_INVALIDATION_PATTERNS = Object.freeze([
  /NANO_OWNER_INVALIDATED:/u,
  /Nano heartbeat saknar aktiv request\./u,
  /Nano heartbeat är stale eller felclaimad\./u,
  /NANO_HEARTBEAT_REJECTED:(?:NOT_RUNNING|CLAIM_ID_MISSING|CLAIM_ID_MISMATCH|CLAIM_LEASE_EXPIRED)/u,
  /Ingen ASSESSING-körning väntar på Nano\./u,
  /Ingen körning väntar på Nano\./u,
  /Stale eller fel Nano request_id\./u,
  /Nano failure saknar aktiv request\./u,
  /Stale Nano failure request_id\./u
]);

function errorText(errorLike) {
  if (typeof errorLike === "string") return errorLike;
  const code = String(errorLike?.code || "");
  const message = String(errorLike?.message || "");
  if (code && message && code !== message) return `${code}: ${message}`;
  return code || message || String(errorLike || "");
}

export class NanoOwnerInvalidatedError extends Error {
  constructor(reason = "OWNER_STATE_CHANGED") {
    const detail = String(reason || "OWNER_STATE_CHANGED");
    super(`${NANO_OWNER_INVALIDATED_CODE}:${detail}`);
    this.name = "NanoOwnerInvalidatedError";
    this.code = NANO_OWNER_INVALIDATED_CODE;
    this.ownerReason = detail;
  }
}

export function classifyNanoOwnerHeartbeatFailure(errorLike) {
  const message = errorText(errorLike);
  const invalidated = OWNER_INVALIDATION_PATTERNS.some((pattern) => pattern.test(message));
  return Object.freeze({
    invalidated,
    code: invalidated ? NANO_OWNER_INVALIDATED_CODE : "NANO_HEARTBEAT_TRANSIENT",
    reason: message || "UNKNOWN_HEARTBEAT_FAILURE"
  });
}

export function nanoOwnerAbortReason(signal) {
  if (!signal?.aborted) return null;
  const reason = signal.reason;
  if (reason instanceof NanoOwnerInvalidatedError) return reason;
  if (reason instanceof Error && reason.code === NANO_OWNER_INVALIDATED_CODE) return reason;
  return new NanoOwnerInvalidatedError(errorText(reason) || "OWNER_STATE_CHANGED");
}

export async function withNanoOwnerAbort(promise, signal) {
  if (!signal) return promise;
  const already = nanoOwnerAbortReason(signal);
  if (already) throw already;

  return await new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      try { signal.removeEventListener?.("abort", onAbort); } catch {}
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onAbort = () => finish(reject, nanoOwnerAbortReason(signal));
    signal.addEventListener?.("abort", onAbort, { once: true });

    Promise.resolve(promise).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error)
    );
  });
}
