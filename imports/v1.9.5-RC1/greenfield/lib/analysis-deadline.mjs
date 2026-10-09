import { ANALYSIS_WALL_MS } from "./contracts.mjs";

function timeoutError(stage) {
  return Object.assign(new Error(`${stage} exceeded the shared analysis deadline.`), {
    code: "ANALYSIS_TIMEOUT"
  });
}

// An absolute deadline crosses the background/offscreen boundary and is never
// renewed by a model stage or compatibility fallback. Each request owns its
// budget; other windows can continue independently.
export function createAnalysisBudget(deadlineAtMs = Date.now() + ANALYSIS_WALL_MS) {
  if (!Number.isFinite(deadlineAtMs)) {
    throw Object.assign(new Error("Invalid analysis deadline."), { code: "ANALYSIS_DEADLINE_INVALID" });
  }
  const deadline = Math.min(deadlineAtMs, Date.now() + ANALYSIS_WALL_MS);
  return {
    deadlineAtMs: deadline,
    async wait(operation, stage, { onLateResolve = null } = {}) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw timeoutError(stage);
      let expired = false;
      const pending = Promise.resolve().then(() => {
        if (Date.now() >= deadline) throw timeoutError(stage);
        return operation();
      }).then(value => {
        if (expired || Date.now() >= deadline) {
          if (onLateResolve) {
            try { Promise.resolve(onLateResolve(value)).catch(() => undefined); } catch {}
          }
          throw timeoutError(stage);
        }
        return value;
      }, error => {
        if (Date.now() >= deadline) throw timeoutError(stage);
        throw error;
      });
      let timer;
      try {
        return await Promise.race([pending, new Promise((_, reject) => {
          timer = setTimeout(() => {
            expired = true;
            reject(timeoutError(stage));
          }, remaining);
        })]);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
