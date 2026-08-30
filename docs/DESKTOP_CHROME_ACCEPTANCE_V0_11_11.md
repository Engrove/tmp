# v0.11.11 Desktop Chrome acceptance

Status: **PENDING**

## Primary diagnostic oracle

1. Load the exact v0.11.11 BROWSER candidate and start one fresh linked-session mission.
2. Obtain and ACK the canonical baseline.
3. When local rearm reaches `LOCAL_STATE_UNCHANGED`, the first AI-visible no-delta control turn for that unchanged generation must contain `diagnostics.localState`.
4. Verify the payload exposes the bounded prior/current bridge receipt fields, parsed structured target result, material-control generation, session-init identity, material-effect identity and chat-control receipt state.
5. The diagnostic itself must not cause `MATERIAL_DELTA`, Nano rearm, or a new diagnostic generation.
6. A repeat of the same unchanged generation must not emit another local-state diagnostic/chat-control wake.
7. If a structured target field such as `completionState` changed, that material delta may legitimately re-arm; the diagnostic must make the changed field observable.
8. A genuinely new material generation may emit one new local-state diagnostic after it later reaches no-delta.

## Preserved live oracles

- v0.11.10 cross-boundary bridge semantics remain in force.
- v0.11.8 baseline correction: `ACCEPT -> READY`; first non-ACCEPT -> one correction; second same-episode non-ACCEPT -> `BASELINE_CORRECTION_EXHAUSTED` / `PROGRAM_BLOCKED` with no third baseline request.
- Dispatch lifecycle: every admitted baseline/correction leaves `BASELINE_REQUEST_DISPATCHED` within the bounded transport window or fails explicitly as `BASELINE_DISPATCH_STALLED`.
- v0.11.7 `NANO_INCOMPLETE_JSON`.
- v0.11.6 6,000-soft/schema-hard output behavior.
- actor/capability separation, Capture/Memory, normal reload and hard reload after init/control liveness is clean.

Automated source/package verification does not satisfy live acceptance.
