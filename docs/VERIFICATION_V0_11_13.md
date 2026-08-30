# v0.11.13 Verification

Status: **LOCAL SOURCE/PACKAGE VERIFICATION — DESKTOP CHROME LIVE ACCEPTANCE PENDING**

## Required production invariants

1. Exact v0.11.12 preimage ZIP SHA-256 is verified before mutation.
2. `AWAITING_OPERATOR_ACTION` rejects every non-terminal exit without the exact accepted
   operator-action receipt, even with `force: true`.
3. `AWAITING_OPERATOR_DECISION` has the equivalent receipt-bound invariant.
4. `STOPPED` and `ERROR_TERMINAL` remain available fail-safe exits.
5. Generic `PAUSE` cannot convert either human wait to `SOFT_PAUSED`.
6. Generic `RESUME` cannot own either human wait.
7. The owner-specific action/decision receipt handlers can transition exactly once to
   `RECOVERING` with matching receipt identity.
8. Wrong/stale/missing receipts fail closed.
9. Watchdog/service-worker reconciliation returns before session-init/recovery work while either
   human wait is active.
10. Delayed prepared-effect and Nano callbacks cannot cross a human wait.
11. Nano request claim eligibility is false in both human waits.
12. Sidepanel disables Pause and generic Resume in both human waits.
13. Structured `expectedEvidence` renders as useful JSON rather than `[object Object]`.
14. Existing v0.11.12/v0.11.11/v0.11.10 controls remain covered by focused preservation tests.
15. Fresh post-package extraction repeats syntax, JSON, state-space and payload-integrity checks.

## Adversarial state-space requirement

For both owner-bound source states, enumerate every destination in `STATES` under both normal and
`force` transition attempts. Without a valid receipt, the only state changes allowed are fail-safe
terminal exits. With the matching accepted receipt, only `RECOVERING` is additionally allowed.

Explicit chains:

- `AWAITING_OPERATOR_ACTION -> PAUSE -> SOFT_PAUSED -> RESUME` must be impossible.
- `AWAITING_OPERATOR_DECISION -> PAUSE -> SOFT_PAUSED -> RESUME` must be impossible.
- Reload/watchdog/delayed callback must preserve the wait until receipt or STOP.

## Executed source checks

Before packaging, the exact v0.11.13 worktree passed:

- JavaScript/module syntax: **94/94 PASS**.
- JSON parse: **23/23 PASS**.
- Focused owner-bound/preservation suite: **51/51 PASS**.
- Adversarial human-wait state-space: **2 source states × 20 destinations × 3 receipt phases × 2 force modes = 240 checks, 0 violations**.
- Static integration invariants: **12/12 PASS**.
- Preserved v0.11.12 modules used by diagnostics, semantic bridge, baseline correction and Nano output/completeness remain byte-identical where not part of this change.

These are local source checks only; the final ZIP is independently re-extracted and re-run after `build-info.json` is regenerated.

## Claim boundary

Passing local checks proves only the source/package candidate. Desktop Chrome must separately
confirm the human-boundary pause/receipt/reload behavior on the installed build.
