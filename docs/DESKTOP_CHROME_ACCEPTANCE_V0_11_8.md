# v0.11.8 Desktop Chrome acceptance

Status: **PENDING**

## Live oracle

1. Load the exact v0.11.8 BROWSER candidate in Desktop Chrome.
2. Start one fresh linked-session mission and obtain the canonical baseline request.
3. If Nano accepts the baseline, session initialization reaches durable READY and ordinary processing continues.
4. If Nano rejects the first baseline, exactly one corrective baseline request may be sent.
5. If Nano rejects that correction again without a genuinely new init episode, the Agent must enter `PROGRAM_BLOCKED` with `sessionContextInit.failureCode=BASELINE_CORRECTION_EXHAUSTED`.
6. No third `SESSION_CONTEXT_BASELINE_REQUEST` may be materialized for that same init episode.
7. Starting a new mission/new init episode may re-arm one correction.
8. Re-run the v0.11.7 typed `NANO_INCOMPLETE_JSON` live oracle and v0.11.6 6,000-soft/schema-hard output oracle.
9. Continue actor/capability, Capture/Memory and normal/hard reload checks only after session-init/Nano liveness is clean.

Automated package verification does not by itself satisfy this checklist.
