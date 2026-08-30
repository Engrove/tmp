# Changelog v0.10.13

Nano/storage recovery hotfix. v0.10.12 delivered and ACKed the canonical
`eic.main-task-baseline.v1` request, observed the adversarial baseline response
and created a `CONTINUATION_ANALYSIS` request. A one-shot
`CONTINUITY_PRIMARY_READBACK_MISMATCH` then sent the run through generic lifecycle
recovery. Recovery restored `WAITING_FOR_RESPONSE` while preserving
`sessionContextInit=NANO_ANALYZING` and an unclaimed `PENDING` Nano request.
The sidepanel only claimed requests while `run.state===ASSESSING`, so Nano could
never start and the initialization could never reach `READY`.

## Fixed

- Added `lib/nano-analysis-recovery.mjs`, the owner of the cross-state invariant
  for session-initialization Nano requests.
- A pending unclaimed request in `NANO_ANALYZING` is now claimable from its
  semantic initialization state, not only from the redundant run state.
- Generic storage/lifecycle recovery restores such a request to `ASSESSING`
  before it can fall through to `WAITING_FOR_RESPONSE`.
- The illegal combination
  `NANO_ANALYZING + PENDING/unclaimed + WAITING_FOR_RESPONSE` is explicitly
  detected as `NANO_ANALYZING_PENDING_REQUEST_FALSE_WAIT`.
- Added a 45-second unclaimed-request watchdog. A request that still cannot be
  claimed becomes `NANO_REQUEST_UNCLAIMED_TIMEOUT`, moves session initialization
  to `FAILED`, and exposes the existing operator retry path instead of waiting
  indefinitely.
- A baseline response identity is no longer recorded as processed before its
  Nano analysis is claimed and completed. Local storage or lifecycle failure can
  therefore preserve/re-arm the source instead of burning the only response that
  can advance initialization.
- Continuity readback verification now performs one bounded rewrite/readback
  before entering fail-closed recovery. A successful second read is audited as
  `runtime.write.readback-recovered`.
- If the retry also fails, the run receives a source-bound
  `storagePersistenceFailure` receipt containing expected/observed digests,
  runtime revision, writer and the semantic state to restore.
- Automatic Session Capture no longer reschedules continuously while an
  initialization Nano request is pending or running. The initialization chain
  owns that interval and schedules the next capture after Nano completion.

## Observability

Continuity readback failures now retain:

- expected and observed primary and backup digests;
- primary/backup validity;
- runtime revision and writer;
- request ID and session-initialization phase;
- recovery disposition and semantic resume state.

## Tests

- Added `tests/v01013-nano-storage-recovery.test.mjs`.
- Extended the executable fake-Chrome runtime with deterministic corruption of
  the next runtime readbacks.
- The integration fixture drives:
  `baseline response → pending Nano request → two readback mismatches →
  fail-closed recovery → ASSESSING restore → NANO_CLAIM`.
- The fixture also proves there is no duplicate baseline prompt and that the
  baseline response is not prematurely consumed.
