# v0.11.14 Desktop Chrome Acceptance

Status: **PENDING**

Use one fresh linked-session mission on the exact packaged v0.11.14 candidate.

## False-block regression

1. Deliver a `CONTINUE` baseline whose next action explicitly mentions testing
   `USER_PAUSE/AWAITING_OPERATOR_DECISION`.
2. Nano/controller must not enter `PROGRAM_BLOCKED` with `TARGET_REQUESTED_PAUSE` solely from
   that marker text.
3. Session initialization must reach `READY` and continue to the intended bounded test.

## Structured user-pause preservation

1. Produce a valid `EIC_AUTONOMY: USER_PAUSE` + `EIC_NEXT_ACTOR: OPERATOR_DECISION`.
2. Runtime must enter `AWAITING_OPERATOR_DECISION`.
3. Generic Pause/Resume, Nano, recovery, watchdog/reload and delayed callbacks must not cross it.
4. Only the exact decision receipt may resume once.

## Operator-action preservation

Repeat the v0.11.13 `OPERATOR_ACTION_REQUIRED/AWAITING_OPERATOR_ACTION` owner-boundary oracle.

No production claim is allowed until these live checks pass.
