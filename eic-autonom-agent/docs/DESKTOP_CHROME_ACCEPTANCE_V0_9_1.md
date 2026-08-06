# Desktop Chrome acceptance — EIC Autonom Agent v0.9.1

Status: candidate checklist, not executed by source/package verification.

Use a separate Chrome profile/user-data directory and the v0.9.1 browser package.

## WP25.3-like bounded grounding replay

1. Start one trusted agent session with a stable goal and one bounded work unit.
2. Present a grounding observation whose owner evidence and claim boundary remain unchanged.
3. Repeat the observation with only case, whitespace, punctuation, ordering, timestamp or receipt-id changes.
4. Verify that the same observation/context/Twin/receipt references are reused.
5. Verify that no new context, Twin Case or receipt is created for the duplicate.
6. Run two consecutive cycles with no fresh owner evidence, artifact, state transition or delivery delta.
7. Verify `NON_PROGRESSING_LOOP` after the second cycle.
8. Verify exactly one bounded owner-read, subsystem pivot or stop.
9. Verify that the same observation identity cannot launch a third grounding cycle.
10. Supply fresh owner evidence and verify that the matched emit path continues.

## Terminality replay

1. Complete the active subtask while leaving one concrete program action.
2. Verify `SUBTASK_DONE`, `PROGRAM_CONTINUE` and `EIC_AUTONOMY: CONTINUE`.
3. Complete the entire stable mandate with completion evidence and no next action.
4. Verify terminal `PROGRAM_DONE` and `EIC_AUTONOMY: DONE`.

## Regression boundaries

Verify that trusted-session failure, owner-route denial, approval consumption, external-effect
gates, browser recovery and install/release/deployment boundaries remain fail-closed.

A source/package PASS does not satisfy this Desktop Chrome checklist.
