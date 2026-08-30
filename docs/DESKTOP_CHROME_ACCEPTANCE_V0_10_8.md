# Desktop Chrome acceptance — v0.10.8

This checklist verifies installed runtime behavior. Source/package PASS is not installed-runtime proof.

## A. Full audit picker/write/readback

1. Load the v0.10.8 browser package as an unpacked extension.
2. Open Settings and enable full audit.
3. Select an existing writable folder whose basename is not `temp`.
4. Expected:
   - no `FULL_AUDIT_DIRECTORY_MUST_BE_EXISTING_TEMP_FOLDER`;
   - sink becomes `REDO` or `AKTIV`;
   - tooltip shows a verified write probe;
   - no `.eic-full-audit-probe-*` file remains.
5. Trigger at least one audit event and press flush.
6. Expected:
   - an `eic-autonom-agent-v0.10.8-*.ndjson` segment is appended;
   - queue ACK occurs only after write succeeds.
7. Reload the sidepanel and flush again.
8. Expected:
   - the persisted directory handle is re-permissioned and write-probed in the new panel session.
9. Create more than eight valid v0.10.7/v0.10.8 segment files and flush.
10. Expected: only the newest eight matching audit segments remain.

## B. Main-task baseline intake

1. Start a continuation in a conversation without `eic.main-task-baseline.v1`.
2. Expected first Nano result:
   - `trackControl.status=BASELINE_REQUESTED`;
   - `directProgramDelta=0`;
   - `requiredControl=true`;
   - requested action is the canonical `HUVUDUPPGIFTSKONTROLL` prompt.
3. Verify the sent target prompt requests:
   - main task and measurable completion;
   - active milestone/work unit;
   - scope, owners and blockers;
   - 80/20 vital few/deferred many;
   - active/required/gap global skills;
   - detour return condition.
4. Return a valid baseline plus EIC-AA/5.
5. Export state.
6. Expected:
   - `continuity.mainTaskBaseline.schema=eic.main-task-baseline.v1`;
   - baseline evidence class is `ROUTING_CONTEXT`;
   - the next Nano prompt includes the baseline.

## C. Track twins

### Emit: on-track
Return a next action that directly advances `current.nextHighLeverageAction`.

Expected:
- `trackControl.status=ON_TRACK`;
- relation `DIRECT`;
- leverage `HIGH_LEVERAGE` or `NECESSARY_ENABLER`.

### Emit: justified detour
Return a required owner read that blocks the high-leverage action.

Expected:
- `JUSTIFIED_DETOUR`;
- `REQUIRED_DETOUR`;
- concrete reason and return condition;
- detour remains bounded by the baseline policy.

### Block: drift
Return an unrelated refactor, broad research sweep or extra receipt with no omission failure.

Expected:
- `DRIFT`;
- `UNRELATED` or low leverage;
- concrete correction back to the main task;
- unrelated action is not dispatched.

## Claim boundary

PASS requires export/readback from the installed v0.10.8 runtime. This document alone is specification, not execution evidence.
