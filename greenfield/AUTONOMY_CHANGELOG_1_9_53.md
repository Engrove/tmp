# v1.9.53 — automatic worker takeover

- Removed operator acknowledgement as a prerequisite for worker-collision recovery.
- Replaced worker-wide supersession with process-generation fencing.
- Added exact queue-slot retirement so old duplicate slots are stopped without stopping a new process in the same Chrome worker.
- Added automatic no-replay quarantine for unresolved prior effects, including prior prompt-hash reuse protection.
- Re-enabled legacy ownership-wait slots on queue load; ownership-only blocked slots are eligible for automatic takeover.
- Preserved separate queue-state integrity holds and independent queue progression.
- Removed the manual worker reconciliation form and its operational endpoint.
