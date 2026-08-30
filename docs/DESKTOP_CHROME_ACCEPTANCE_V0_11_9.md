# v0.11.9 Desktop Chrome acceptance

Status: **PENDING**

## Live oracle

1. Load the exact v0.11.9 BROWSER candidate in Desktop Chrome and start one fresh linked-session mission.
2. Obtain and ACK the canonical baseline request.
3. A first `LOCAL_STATE_UNCHANGED` side-band wake may be observed, but an EIC reply with unchanged local facts/semantics must not itself cause a second wake.
4. A material accepted Core Surface Review generation may re-arm exactly one local analysis; after that, fresh side-band response identity alone must not re-arm.
5. A substantive EIC control-semantic change may re-arm once.
6. Preserve the v0.11.8 baseline correction oracle: ACCEPT -> READY; first non-ACCEPT -> one correction; second same-episode non-ACCEPT -> `BASELINE_CORRECTION_EXHAUSTED` / `PROGRAM_BLOCKED` with no third baseline request.
7. Preserve the separate dispatch/lifecycle oracle: each admitted baseline/correction must leave `BASELINE_REQUEST_DISPATCHED` within its bounded transport window or fail explicitly as `BASELINE_DISPATCH_STALLED`.
8. Re-run the v0.11.7 `NANO_INCOMPLETE_JSON` and v0.11.6 6,000-soft/schema-hard output oracles.
9. Continue actor/capability, Capture/Memory, normal reload and hard reload checks only after session-init/Nano/control liveness is clean.

Automated source/package verification does not satisfy live acceptance.
