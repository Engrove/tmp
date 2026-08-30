# v0.11.12 Desktop Chrome acceptance

Status: **PENDING**

## Primary operator-action dominance oracle

1. Load the exact v0.11.12 BROWSER candidate and start one fresh linked-session mission.
2. Reach a target response whose valid EIC-AA footer is:
   - `EIC_NEXT_ACTOR: OPERATOR_ACTION`
   - `EIC_AUTONOMY: OPERATOR_ACTION_REQUIRED`.
3. The controller must transition directly to `AWAITING_OPERATOR_ACTION`.
4. Before operator evidence is submitted, verify:
   - no Nano request is created or claimed;
   - no protocol-repair or chat-control continuation is prepared;
   - no deferred mission starts;
   - no prepared target effect dispatches;
   - response timeout stays suspended;
   - repeated watchdog/service-worker ticks remain in operator wait.
5. Reload/reopen the extension service worker and verify the durable wait remains.
6. Submit the exact operator-action evidence receipt.
7. Verify one controlled resume occurs and the already-processed operator-action assistant response is not re-latched as a new event.

## Preserved live oracles

After operator-action dominance passes, continue the v0.11.11 one-shot `diagnostics.localState` oracle, v0.11.10 cross-boundary bridge oracle, baseline-correction fence, dispatch lifecycle, Nano completeness/output-bound, actor/capability, Capture/Memory and reload acceptance.

Automated source/package verification does not satisfy Desktop Chrome acceptance.
