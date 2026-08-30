# v0.11.13 Desktop Chrome Acceptance

Status: **PENDING**

Use one fresh linked-session mission on the exact packaged v0.11.13 candidate.

## Primary operator-action oracle

1. Produce a valid `EIC_AUTONOMY: OPERATOR_ACTION_REQUIRED` +
   `EIC_NEXT_ACTOR: OPERATOR_ACTION` response.
2. Runtime must immediately enter `AWAITING_OPERATOR_ACTION`.
3. Pause and generic Resume must be disabled.
4. No Nano claim/request, chat-control/protocol-repair prompt, prepared target dispatch,
   deferred mission launch or recovery transition may occur while waiting.
5. Watchdog and service-worker reload must preserve the same wait.
6. Submit the exact operator-action evidence receipt.
7. Exactly one transition to `RECOVERING` is allowed; the same assistant response must not re-latch.

## Operator-decision oracle

Repeat the same boundary test for `USER_PAUSE` / `AWAITING_OPERATOR_DECISION`; only the exact
decision receipt may resume the run.

## Preserved acceptance

After the owner-boundary oracle passes, continue the previously defined one-shot local-state
diagnostic, cross-boundary bridge, baseline-correction, dispatch-lifecycle, Nano, actor/capability,
Capture/Memory and reload checks.

No production claim is permitted before these live checks pass.
