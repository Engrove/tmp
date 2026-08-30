# v0.11.5 Desktop Chrome acceptance

Status: NOT RUN

Required live oracle:

1. Load the exact v0.11.5 BROWSER package.
2. Confirm normal baseline/Nano readiness.
3. If a terminal Nano failure occurs, inspect the first control envelope:
   - reason `NANO_FAILURE_DIAGNOSTIC`;
   - bounded `diagnostics.nanoFailure` present;
   - root `errorCode` and request identity visible.
4. ACK/respond once. With unchanged failed material, verify there is no second diagnostic/wake for
   the same diagnostic key and the Agent reaches `PROGRAM_BLOCKED`.
5. If Nano succeeds normally, continue the existing v0.11.4 actor/capability and
   Capture/Memory/reload acceptance oracles.

No live PASS is claimed by this file.
