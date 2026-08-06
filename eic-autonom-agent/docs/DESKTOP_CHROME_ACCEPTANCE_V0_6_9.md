# DESKTOP CHROME ACCEPTANCE — v0.6.9

## Preconditions

- Load the unpacked v0.6.9 install tree in the intended desktop Chrome profile.
- Reload the linked ChatGPT tab.
- Preserve the supplied v0.6.8 export before importing it.

## A. Self-import and Resume recovery

1. Import the supplied `eic.autonom.export.v8` file.
2. Confirm the run and continuity are restored without schema rejection.
3. Click Resume.
4. Confirm the next assessment does not immediately return to
   `NO_PROGRESS_BUDGET_EXHAUSTED`.

Expected: both no-progress counters start a new bounded recovery cycle; prior
history remains visible.

## B. Incident subsystem pivot

Replay or continue from the imported state where the recent actions are
Workspace/work-package/Hjalmar-heavy and progress remains zero.

Expected:
- audit contains `NO_PROGRESS_SUBSYSTEM_PIVOT`;
- recovery exclusions contain `SUBSYSTEM:WORKSPACE`;
- state does not become human `SOFT_PAUSED` solely from no-progress;
- the next prompt explicitly forbids Workspace/work-package/twin/package-binding
  for that recovery cycle and requests a concrete patch/diff, test log or blocker
  receipt through an independent route.

## C. Exhausted alternatives

Provide a test state where every observed subsystem family is already excluded.

Expected:
- state becomes `RECOVERING`;
- UI names the exact unlock event;
- no prompt is dispatched and no human decision is claimed.

## D. Malformed Nano output

Use a controlled Nano response that first contains prose or incomplete JSON and
then a valid schema object on the format-repair call.

Expected:
- exactly one `JSON FORMAT REPAIR ONLY` attempt;
- valid repaired decision continues through owner validation;
- no false host-timeout reason.

Repeat with two invalid outputs.

Expected:
- the second failure enters deterministic recovery once;
- the original parse error is retained in telemetry/recovery reason.

## E. Hard boundaries

Verify that direct operator Stop/Pause and deterministic level-10 cases still
pause or block exactly as before.

## Evidence to return

Export the resulting state and capture:
- run state and pause origin;
- recovery attempts and exclusions;
- antiLoop counters and lastCorrection;
- Nano telemetry error/recovery reason;
- audit entries for subsystem pivot or bounded RECOVERING.

## Claim boundary

A PASS here supports only the tested desktop Chrome build/profile and exact
scenario. It does not imply repository, CI, deployment or other environment
status.
