# v0.11.10 Desktop Chrome acceptance

Status: **PENDING**

## Primary cross-boundary oracle

1. Load the exact v0.11.10 BROWSER candidate and start one fresh linked-session mission.
2. Obtain and ACK the canonical baseline.
3. A first `LOCAL_STATE_UNCHANGED` wake may occur.
4. Reply to that wake without changing local owner facts or structured executor/completion semantics.
5. The first side-band child must not re-arm Nano/local-read as `MATERIAL_DELTA` solely because raw observation identity became side-band semantic identity.
6. No second `LOCAL_STATE_UNCHANGED` wake may be materialized for that same local/material generation.
7. A genuine accepted Core Surface Review (`materialControlGeneration` increment), structured actor/completion change, new task/init episode or new material effect may re-arm exactly once.

## Preserved live oracles

- v0.11.8 baseline correction: `ACCEPT -> READY`; first non-ACCEPT -> one correction; second same-episode non-ACCEPT -> `BASELINE_CORRECTION_EXHAUSTED` / `PROGRAM_BLOCKED` with no third baseline request.
- Dispatch lifecycle: every admitted baseline/correction leaves `BASELINE_REQUEST_DISPATCHED` within the bounded transport window or fails explicitly as `BASELINE_DISPATCH_STALLED`.
- v0.11.7 `NANO_INCOMPLETE_JSON`.
- v0.11.6 6,000-soft/schema-hard output behavior.
- actor/capability separation, Capture/Memory, normal reload and hard reload after init/control liveness is clean.

Automated source/package verification does not satisfy live acceptance.
