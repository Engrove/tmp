# v0.12.6

## Nano / controller boundary

- Replaces ordinary `eic.nano.microdecision.v3` output with compact
  `eic.nano.advisory.v4`.
- Reduces required model output from 25 top-level controller fields to two:
  `selectedActionId` and free `analysis`.
- Makes `proposal`, `confidence`, `uncertainty` and `evidenceNeed` optional.
- Runtime owns actor, progress, completion, waits, safety and terminal commits.
- Removes `NANO_DISCRIMINATION_REQUIRED` as a model-quality liveness gate.
- Model mismatch/weak rationale is telemetry; only a real runtime action-catalog
  contradiction can fail the binding gate.
- STOP is not a standing ordinary-Nano action.

## Fresh-target / capability routing

- Suppresses repeated no-delta `READ_LOCAL_SESSION_STATE` for the same
  side-band causal generation.
- Explicitly states that AGENT cannot create/select/attest an independent fresh
  ChatGPT evaluator session.
- Routes that capability gap through `WAIT_OWNER_EVENT` instead of another
  local read.
- Allows `EIC_AI_SESSION` to establish/select the target only when a real
  browser/session owner route is actually exposed; otherwise requires
  `OPERATOR_ACTION_REQUIRED` / `EIC_NEXT_ACTOR: OPERATOR_ACTION`.

## Safety and terminality

- Nano free analysis is not treated as an effect for local/passive routes.
- Explanatory destructive language cannot manufacture a human boundary for a
  no-effect advisory route.
- Real target/operator safety boundaries remain owner-dominant.
- Adds deterministic migration from the obsolete persisted v0.12.5
  `NANO_DISCRIMINATION_FAILED` policy fence.

## Consistency

- Active baseline contract is `eic.main-task-baseline.v3`.
- Built-in profiles advance to `nano-core-v11` and `target-core-v9`.
- NANO_TASK remains a separate one-prompt acceptance-harness lane.

## Nano prompt budget

- Removes duplicated per-request policy prose already owned by the stable Nano
  core mandate.
- Adds structured prompt-compaction tiers that preserve complete JSON.
- Prohibits raw final-prompt slicing.
- Guarantees bounded complete prompts for regression ceilings at 2,400, 3,000,
  4,000 and 8,000 characters.

