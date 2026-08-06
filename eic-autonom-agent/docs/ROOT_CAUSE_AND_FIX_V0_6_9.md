# ROOT CAUSE AND FIX — v0.6.9

## Incident basis

The supplied v0.6.8 export ended in `SOFT_PAUSED` with pause origin
`NO_PROGRESS_BUDGET_EXHAUSTED`. Eight continuation decisions had deterministic
progress delta 0, `verifiedFacts` was empty, and the recovery exclusions list was
empty. The active work unit explicitly required a route independent of the failing
subsystem, but successive actions continued through Workspace/work-package,
artifact-binding and Hjalmar/control paths.

The final Nano invocation also returned malformed output without a complete JSON
object. Deterministic recovery recovered a valid target `CONTINUE`, but the
no-progress terminal branch paused the run before the recovered action could be
delivered.

## Root causes

1. `detectLoopCorrection()` mapped eight stagnant cycles to
   `HUMAN_HANDOFF_REQUIRED`.
2. `background.js` converted either that code or an exhausted recovery counter
   directly to `SOFT_PAUSED`, even in Max Autonomous Mode and below
   EIC_DESTRUCTIVENESS level 10.
3. `RESUME` preserved both `run.recovery.consecutiveNoProgress` and
   `continuity.antiLoop.stagnationCycles`, so the next cycle could immediately
   pause again.
4. Recovery recorded generic ladder steps but did not classify or exclude the
   recurring failing subsystem.
5. The invalid-grounding recovery action was immediately overwritten by the
   ungrounded selected action.
6. v0.6.8 exported `eic.autonom.export.v8` but `importState()` accepted only
   v3–v7.
7. Nano output parsing used a greedy brace expression and had no bounded
   format-only repair.

## Fix

- Eight stagnant cycles now produce `NO_PROGRESS_CHECKPOINT`, not a human-handoff
  verdict.
- In Max Autonomous Mode, exhaustion selects one deterministic subsystem pivot.
  The recurring subsystem is added as `SUBSYSTEM:<NAME>` to recovery exclusions,
  its counter is reset without fabricating progress, and the next instruction must
  produce a patch/diff, test log or exact blocker receipt through an independent
  route.
- If all observed subsystems are already excluded, the run enters bounded
  `RECOVERING` and waits for an exact unlock event instead of requiring a person.
- Manual Resume clears the two no-progress counters before re-assessment.
- Invalid grounding preserves its safe owner-read fallback.
- v8 exports can be imported by v0.6.9.
- Nano JSON extraction is balanced and string-aware. One schema-constrained,
  format-only repair is allowed; a second failure still enters deterministic
  recovery.
- Deterministic recovery carries the actual Nano failure reason instead of
  reporting every failure as a host timeout.

## Claim boundary

This document describes the v0.6.9 source candidate. Source tests, validator,
syntax, packaging and ZIP integrity must be executed and recorded separately.
Desktop Chrome, current ChatGPT DOM, Chrome Prompt API/Nano runtime and installed
extension behavior remain separate runtime-owner claims.
