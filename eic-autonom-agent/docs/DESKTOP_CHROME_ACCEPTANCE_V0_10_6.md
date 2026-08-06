# EIC Autonom Agent v0.10.6 — Desktop Chrome acceptance

Record exact Chrome version, unpacked extension ID, package SHA-256, test time and operator.

## A. Identity

1. Load the extracted v0.10.6 browser package as unpacked.
2. Verify side panel and content bridge report `0.10.6`.
3. Reload the target ChatGPT tab after extension update.
4. Export state and verify app/build/config/runtime identities.

## B. Autostart regression

For every Autostart preset:

1. Start from an unlinked supported ChatGPT tab.
2. Verify config persists.
3. Verify selected tab and `CHATGPT_CONTROLLER` are read back.
4. Verify mission starts once.

For D1/D2:

1. First click arms the bounded confirmation.
2. Second click starts `LanguageModel.create()`.
3. Verify `userActivationActiveAtStart=true`.
4. Verify no `NanoUserActivationRequiredError` or unhandled rejection.

## C. Continuity and backup

1. Export immediately after start.
2. Complete at least two autonomous turns.
3. Export again.
4. Verify continuity contains active binding, target project, active phase, current turn and next direction.
5. Verify backup digest equals the prior valid primary digest after each semantic change.
6. Verify the continuity write receipt matches storage readback.
7. Corrupt a disposable test copy only; verify backup recovery or fail-closed behavior.

## D. Nano lifecycle

1. Observe a running request and heartbeat.
2. Verify telemetry lease matches pending request lease after heartbeat.
3. Complete/fail/abort the request.
4. Verify `busy=false` and current `runtimeDecisionStatus`.
5. Verify clone telemetry cannot report used without supported.
6. Compare target `EIC_NEXT` with Nano discrimination record.
7. Run a controlled negative twin where target next is materially invalid; Nano must reject/change it for independent discrimination to be claimed.

## E. Capture and review arbitration

1. Start Nano and trigger automatic capture conditions.
2. Verify capture is deferred and no active Nano request is lost.
3. Verify automatic core review is deferred with `MISSION_NANO_HAS_PRIORITY`.
4. After Nano settles, verify one retry.
5. Virtualize/reload/expand the transcript and capture repeatedly.
6. Verify stored turn count never decreases for the same conversation/task.
7. Verify no duplicate capture from assistant-count-only changes.
8. Verify stable known gaps permit delta and changed gaps force full.

## F. Project and mission projection

1. Use a target transcript with explicit project ID different from control project.
2. Verify both IDs are retained and mismatch is visible.
3. Verify the control project is not silently switched.
4. Verify mission current step, next action, risk and execution status match the active run.

## G. Strong claim gate

1. Feed a completion result with Workspace/source/file/owner-readback claims and no receipts.
2. Verify final completion is downgraded and `OWNER_RECEIPT_REQUIRED` is visible.
3. Add exact fresh owner receipts.
4. Verify the gate becomes `VERIFIED`.

## H. Full audit to C:\temp

1. Confirm audit is OFF after fresh install/reset.
2. Confirm `C:\temp` already exists; the extension must not create it.
3. Use **Välj C:\temp** and select that exact directory.
4. Enable audit and exercise start, Nano, capture, failure and readback paths.
5. Verify redacted NDJSON segments appear.
6. Verify no raw token, credential, prompt body or signed URL.
7. Exceed 4 MiB in a test run and verify rotation with at most eight segments.
8. Revoke permission or make the sink unwritable.
9. Verify visible audit error while the mission/runtime continues.

## I. Mjölnar M2

1. Produce an exact registered D2 action satisfying all controls at level 9.
2. Verify an `EIC_M2_MANDATE/1` object with authority level `9.9999`.
3. Verify target/action/owner/effect/rollback/readback/idempotency/expiry binding.
4. Verify audit/export distinguishes it from actual operator approval.
5. Produce a level-10 case and verify no M2 substitution; actual operator remains required.

## Acceptance verdict

`PASS` requires all sections A–I with attached exports/log hashes. Source/package verification alone remains `NOT_RUNTIME_ACCEPTED`.
