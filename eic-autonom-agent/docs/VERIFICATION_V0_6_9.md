# VERIFICATION — v0.6.9

## Required local gates

1. Incident-focused tests:
   `node --test tests/v069-no-progress-recovery.test.mjs`
2. Full Node suite:
   `npm test`
3. Static validator:
   `npm run validate`
4. Background service-worker smoke:
   `node scripts/background-smoke.mjs`
5. Syntax check for every `.js` and `.mjs` source file.
6. Packaging:
   `npm run package`
7. CRC check for install and source ZIP.
8. Compare install members with the corresponding source-tree bytes.

## Incident acceptance

- Eight zero-progress cycles emit `NO_PROGRESS_CHECKPOINT`.
- Max Autonomous Mode does not enter `SOFT_PAUSED` only because the no-progress
  budget was exhausted.
- The incident action sequence classifies Workspace as the recurring subsystem
  and creates `SUBSYSTEM:WORKSPACE`.
- The pivot resets the retry budget while the latest progress delta remains 0 and
  productive action count does not increase.
- Exhausted alternatives enter `RECOVERING` with an exact unlock event.
- Resume resets both no-progress counters.
- Invalid grounding does not overwrite the safe fallback.
- `eic.autonom.export.v8` imports.
- Malformed Nano output receives at most one schema-constrained format repair.
- Deterministic recovery preserves the actual parse/validation failure reason.

## Evidence boundary

Passing local gates supports only the exact source/package candidate and recorded
local commands. It does not prove installation, desktop Chrome behavior, live
ChatGPT DOM compatibility, actual Nano inference, service-worker long-run
behavior, repository persistence, CI, deployment or Workbench execution.
