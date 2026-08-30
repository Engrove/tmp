# Changelog v0.10.10

## Fixed

- Replays the first automatic Nano/EIC core-surface review after universal session initialization reaches `READY`.
- Replaces the unbound v0.10.9 deferral with `eic.autonom.core-review-deferral.v2`, bound to the exact application session, capture and memory.
- Removes `activeMissionId` as a false proxy for Nano model ownership.
- Consumes a deferred review exactly once and prevents duplicate review creation for the same application session.
- Rechecks replay when mission Nano completes and when the Nano host becomes idle.
- Gives the initial automatic review one local model turn before ordinary mission Nano after session initialization.
- Clarifies the UI dependency on both an open panel and an available local LanguageModel.

## Preserved

- Universal catch → baseline → Nano → `READY` initialization.
- Deterministic `eic.main-task-baseline.v1` dispatch.
- Full-audit permission/write/readback verification.
- Operator approval for mandate/profile/autonomy changes.
- Five-minute low-risk local-context auto-apply.
- Transcript and owner-route trust boundaries.
