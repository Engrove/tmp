import { deepClone, nowIso, sanitizeText } from "./common.mjs";
import { CAUSAL_EVENT, commitCausalControl } from "./causal-transition-authority.mjs";
import { PAUSE_ORIGINS, STATES, transitionRun } from "./state-machine.mjs";

export const V0126_LEGACY_NANO_FENCE_MIGRATION_SCHEMA =
  "eic.autonom.v0126-legacy-nano-fence-migration.v1";

/**
 * v0.12.5 could persist PROGRAM_BLOCKED solely because Nano failed the
 * model-expression/discrimination meta-gate. That fence is not a safety owner
 * and is obsolete under the v0.12.6 advisory architecture.
 *
 * This migration is intentionally exact: it matches only the old typed
 * NANO_DISCRIMINATION_FAILED state + causal policy fence, clears no material
 * generation, and reopens the still-unprocessed observation through RECOVERING.
 */
export function migrateLegacyNanoDiscriminationFence(runValue, {
  now = Date.now(),
  responseTimeoutMs = 7_200_000
} = {}) {
  let run = deepClone(runValue || {});
  const legacy =
    run.state === STATES.PROGRAM_BLOCKED &&
    sanitizeText(run.runtimeDecisionStatus, 120) === "NANO_DISCRIMINATION_FAILED" &&
    sanitizeText(run.causalControl?.policyFence?.code, 120) === "NANO_DISCRIMINATION_FAILED";

  if (!legacy) {
    return { run, migrated: false, reason: "NOT_LEGACY_NANO_DISCRIMINATION_FENCE", receipt: null };
  }

  const legacyFence = deepClone(run.causalControl.policyFence);
  const generationBefore = Number(run.causalControl?.materialGeneration || 0);
  const cleared = commitCausalControl(run, {
    type: CAUSAL_EVENT.POLICY_FENCE_CLEAR
  }, { now });
  if (!cleared.accepted) {
    return {
      run: cleared.run,
      migrated: false,
      reason: `POLICY_FENCE_CLEAR_REJECTED:${cleared.reason || "UNKNOWN"}`,
      receipt: null
    };
  }

  run = cleared.run;
  if (Number(run.causalControl?.materialGeneration || 0) !== generationBefore) {
    return {
      run,
      migrated: false,
      reason: "MATERIAL_GENERATION_CHANGED_DURING_FENCE_CLEAR",
      receipt: null
    };
  }

  run.nanoFailureFence = null;
  run.pendingNanoRequest = null;
  run.pendingObservation = null;
  run.waitingObservation = null;
  run.runtimeDecisionStatus = "V0126_LEGACY_NANO_FENCE_RELEASED";
  run.nanoTelemetry ||= {};
  run.nanoTelemetry.previousResultSummary = sanitizeText(run.nanoTelemetry.lastResultSummary, 2400);
  run.nanoTelemetry.previousCompletedAt = run.nanoTelemetry.lastCompletedAt || null;
  if (run.nanoTelemetry.lastDiscrimination) {
    run.nanoTelemetry.previousDiscrimination = deepClone(run.nanoTelemetry.lastDiscrimination);
    run.nanoTelemetry.lastDiscrimination = null;
  }
  run.nanoTelemetry.lastRuntimeBinding = null;
  run.nanoTelemetry.lastStatus = "LEGACY_NANO_FENCE_RELEASED";
  run.nanoTelemetry.lastError = "";
  run.nanoTelemetry.lastResultSummary =
    "v0.12.5 NANO_DISCRIMINATION_FAILED policy fence retired by v0.12.6 runtime-authority migration.";
  run.timeoutSuspended = false;
  run.responseDeadlineAt = now + Math.max(1_000, Number(responseTimeoutMs || 7_200_000));
  run = transitionRun(run, STATES.RECOVERING, {
    origin: PAUSE_ORIGINS.NONE,
    reason:
      "v0.12.6 released obsolete NANO_DISCRIMINATION_FAILED policy fence; " +
      "Nano advisory quality no longer owns mission liveness.",
    force: true
  });

  const receipt = {
    schema: V0126_LEGACY_NANO_FENCE_MIGRATION_SCHEMA,
    code: sanitizeText(legacyFence?.code, 120),
    generation: Number(legacyFence?.generation || 0),
    materialGeneration: generationBefore,
    migratedAt: nowIso(now)
  };
  run.legacyNanoFenceMigrationReceipt = receipt;

  return { run, migrated: true, reason: "LEGACY_NANO_FENCE_RELEASED", receipt };
}
