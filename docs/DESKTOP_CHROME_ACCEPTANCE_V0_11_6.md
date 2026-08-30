# v0.11.6 Desktop Chrome acceptance

Status: NOT RUN

Required live oracle:

1. Load the exact v0.11.6 BROWSER package.
2. Confirm fresh baseline/Nano readiness on the current response identity.
3. Exercise a normal Nano decision path. A result above 6,000 characters must not fail solely with
   `NANO_OUTPUT_OVERRUN` while still below the derived hard limit.
4. If JSON repair is needed, the repair pass uses the same two-tier policy and remains one-shot.
5. A genuine hard-cap/raw-chunk/idle/wall failure remains bounded.
6. If a terminal Nano failure occurs, exactly one `NANO_FAILURE_DIAGNOSTIC` is allowed for that
   failure generation and no same-generation wake may repeat.
7. Continue the existing actor/capability, Capture/Memory, normal reload and hard reload acceptance
   oracles only after the Nano path is clean.

No Desktop Chrome live PASS is claimed by this file.
