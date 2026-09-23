# Greenfield 1.7.5 — Autonomous Storage Retention

## Goal

Keep Greenfield autonomous under sustained local-state churn without turning the nominal Chrome local-storage percentage into a dispatch safety gate.

## Retention contract

- High-water trigger: `0.80`.
- Cleanup target: `0.70`.
- A ratio at or above `0.90` is operational telemetry, not a prompt-dispatch blocker.
- `unlimitedStorage` is requested so an already-full installation still has room to complete cleanup.

## Cleanup order

1. Compact durable checkpoints.
   - During a checkpoint write both alternating slots may exist.
   - After the new slot and primary value have been verified, the older slot is removed.
   - Steady state is primary value + one checksummed checkpoint slot.
2. Re-measure storage.
3. When still above target, enumerate process/queue worker bundles.
4. Exclude every worker with a current reverse worker binding in `chrome.storage.session`.
5. Sort remaining unbound workers by last persisted activity, oldest first.
6. Remove process + queue primary/checkpoint keys for the oldest unbound worker.
7. Re-measure after every removal and stop when the target is reached.
8. Re-check the live session binding immediately before each worker deletion.

## Non-goals

Retention does not disable provider quota handling, model/reasoning verification, exact-once dispatch ownership, or recovery integrity for data that is still retained.

The change removes the storage-percentage dispatch stop; it does not treat a failed storage write as success.

## Queue history

`MAX_QUEUE_HISTORY` is 30 in v1.7.5. Terminal queue history is bounded; active work items remain separate and are not discarded by the history cap.

## Observability

`fleetStatus.storageRetention` exposes the latest retention receipt. The side panel shows nominal storage percentage with `auto` to distinguish automatic retention from the old manual-cleanup model.
