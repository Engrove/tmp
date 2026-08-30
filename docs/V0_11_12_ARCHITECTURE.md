# v0.11.12 Architecture — dominant operator-action boundary

## Defect

v0.11.11 parsed `EIC_AUTONOMY: OPERATOR_ACTION_REQUIRED` correctly and already had a durable `AWAITING_OPERATOR_ACTION` state, but the state was entered only late inside `applyNanoDecisionCommandUnlocked()`. `protocolFastPathEligible()` did not classify operator action as a deterministic human boundary. Baseline/session-init, Nano, recovery, protocol-repair or deferred-mission branches could therefore run or return before the operator wait was installed.

## Dominant latch

v0.11.12 makes the operator boundary an immediate invariant.

After a stable assistant response is parsed, `operatorActionBoundaryEligible()` requires:

- valid EIC-AA protocol;
- `status = OPERATOR_ACTION_REQUIRED`;
- `nextActor = OPERATOR_ACTION`;
- non-empty `EIC_NEXT`;
- non-empty completion evidence;
- completion state `UNIT_DONE` or `MILESTONE_CONTINUE`.

If true, `tickWindowUnlocked()` does not construct an observation or choose a Nano/protocol path. It first records the assistant response as processed, then enters `AWAITING_OPERATOR_ACTION`.

`enterOperatorActionWait()`:

- persists the typed operator action;
- clears `pendingNanoRequest`, `pendingObservation`, response candidate and local waiting projection;
- clears the response deadline and suspends timeout;
- cancels only still-undispatched `PREPARED` / `RETRY_PREPARED` effects;
- leaves ACKED/submitted effect history intact;
- transitions to `AWAITING_OPERATOR_ACTION`.

`tickWindowUnlocked()` already returns immediately in that state. `executePreparedEffectUnlocked()` now independently refuses dispatch while the state is active, closing delayed callback races.

## Resume contract

The same assistant response is marked processed before latching. A successful `submitOperatorActionEvidence()` receipt is therefore the only normal resume path and does not cause the unchanged operator-action response to be parsed as fresh again.

## Defensive recovery contract

`protocolFastPathEligible()` includes valid `OPERATOR_ACTION_REQUIRED` tuples. A preserved/recovered pending observation entering `applyNanoDecisionCommandUnlocked()` is checked again before Nano/session-init commit logic and is latched to operator wait.

## UI boundary

`pauseRequiresHuman()` and `boundaryRequiresOperator` explicitly recognize `AWAITING_OPERATOR_ACTION`, so UI resume affordances cannot represent the state as an ordinary resumable pause.

## Claim boundary

Source/package verification proves the v0.11.12 candidate implements these invariants. Desktop Chrome runtime behavior, installed-byte identity and end-to-end operator-action pause/resume still require live acceptance.
