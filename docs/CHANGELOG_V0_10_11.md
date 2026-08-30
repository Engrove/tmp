# Changelog v0.10.11

Incident-driven release. Root cause: the v0.10.10 live run stalled permanently after the
session catch, because the deterministic baseline decision was applied from a detached
callback whose exception reached only the service-worker console, and no surface in the
system had a liveness bound that could observe the resulting stall.

## Fixed

- Applies deterministic baseline/protocol decisions **in-band**, inside the same serialized
  operation that persisted `deterministicDispatchState = DISPATCHED`. The prompt-critical path
  no longer depends on a detached `setTimeout` callback surviving.
- Persists every deterministic dispatch exception as `run.deterministicDispatchFailure`
  (`errorCode`, `errorDetail`, `stackDigest`, `rearms`, `disposition`), writes it to the audit
  and to the application log. `console.warn` is no longer the only record of a failed delivery.
- Re-arms a failed dispatch generation up to `DETERMINISTIC_CALLBACK_MAX_REARMS` times before
  bounded reconciliation. Each re-arm rebuilds the decision and re-reads the page, instead of
  replaying an identical invisible failure twice.
- Records an observation as processed only when it produced an effect that left `PREPARED`.
  v0.10.10 marked an undelivered observation as processed and then demanded a *changed* response
  identity to retry, which closed a circular wait the agent alone could not break.
- Gives the transient session-context initialization phases (`CATCH_CAPTURED`,
  `BASELINE_REQUEST_DISPATCHED`) a liveness bound, and assigns the `FAILED` state that v0.10.10
  defined but never produced anywhere in the codebase.
- Holds a failed initialization in `PROGRAM_BLOCKED` as human-required, clears the burned
  deterministic source, and exposes a bounded operator retry
  (`RETRY_SESSION_CONTEXT_INIT`, max `SESSION_CONTEXT_INIT_MAX_OPERATOR_RETRIES`).
- Routes a failed initialization to the attention surface as `SESSION_CONTEXT_INIT_FAILED`
  (CRITICAL) with a dedicated **Försök igen / Visa fel** card. v0.10.10 excluded `FAILED` from
  attention routing entirely.
- Backs off the deferred automatic Session Capture retry chain exponentially to 30 s. The
  v0.10.10 fixed 2.5 s retry produced 20 cancelled cycles in 50 s, each costing three storage
  writes and one content-script page read.
- Corrects the initialization overlay: `CATCH_CAPTURED` is titled "Sessions-catch mottagen" and
  states that transcript capture and Session Memory are not yet complete. Phase numbering is
  unique and ordered `1/6`–`6/6`; v0.10.10 labelled two different phases `3/5`.

## Added

- `tests/v01011-deterministic-dispatch-liveness.test.mjs` — unit coverage for the re-arm gate,
  the stall verdict, the failure transition, the delivered-turn invariant and capture backoff.
- `tests/v01011-runtime-integration.test.mjs` — the first test that **executes** `background.js`
  against a fake `chrome`/`indexedDB` runtime and drives the real chain
  `START_WAITING → catch → deterministic dispatch → effect journal → EIC_SUBMIT_PROMPT → ACK`,
  including the failure and liveness paths.

## Preserved

- `DETERMINISTIC_CALLBACK_LEASE_MS` (15 s) and `DETERMINISTIC_CALLBACK_MAX_ATTEMPTS` (2) are
  unchanged. With in-band application the lease is now only a service-worker-death safety net,
  which is the semantics it was written for; the v0.6.3 revision-spin regression coverage stays
  valid.
- The established bounded-reconciliation path (`Deterministic callback-spin avbruten`,
  `DETERMINISTIC_CALLBACK_RECONCILE`, `Deterministic source exhausted`) is unchanged and remains
  the terminal fallback after the re-arm budget.
- Universal catch → baseline → Nano → `READY` initialization, deterministic
  `eic.main-task-baseline.v1` dispatch, exactly-once core-surface review replay, full-audit
  permission/write/readback verification, operator approval for mandate/profile/autonomy
  changes, five-minute low-risk auto-apply, and the transcript/owner-route trust boundaries.
