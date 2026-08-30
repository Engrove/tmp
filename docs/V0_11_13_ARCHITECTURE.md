# v0.11.13 Architecture

Status: **LOCAL SOURCE/PACKAGE CANDIDATE — DESKTOP CHROME LIVE ACCEPTANCE PENDING**

## Purpose

v0.11.13 fixes the v0.11.12 production-gate failure where a human owner-bound wait could
be converted through `PAUSE -> SOFT_PAUSED -> RESUME`, bypassing the exact operator receipt.

## Central invariant

`AWAITING_OPERATOR_ACTION` and `AWAITING_OPERATOR_DECISION` are owner-bound source states.

- `force` does not bypass these states.
- `STOPPED` and `ERROR_TERMINAL` remain fail-safe terminal exits.
- The only normal non-terminal exit is `RECOVERING`.
- `RECOVERING` requires the exact accepted local receipt already stored on the run and a
  matching receipt identity supplied by the owner-specific receipt handler.
- Generic `PAUSE`, `RESUME`, recovery, watchdog, Nano callbacks and prepared-effect callbacks
  cannot authorize the transition.

The invariant lives in `lib/state-machine.mjs`, not only in UI or call-site guards.

## Direct consumers

- `submitOperatorActionEvidence()` supplies the accepted operator-action receipt identity.
- `authorizeBoundary()` supplies the accepted operator-decision receipt identity.
- `controlRun("PAUSE")` rejects both owner-bound states before any mutation.
- `tickWindowUnlocked()` returns before session-init, recovery or watchdog work while either
  owner-bound state is active.
- `executePreparedEffectUnlocked()` and Nano decision application refuse delayed work in both
  owner-bound states.
- Background-wait refresh/preserve helpers route state changes through `transitionRun()` instead of
  assigning `run.state` directly.
- Nano request claiming is ineligible while a human owner-bound wait is active.
- Sidepanel Pause is disabled for both states; generic Resume stays disabled.
- Operator evidence rendering serializes structured evidence instead of `[object Object]`.

## Preservation

The patch preserves v0.11.12 early OPERATOR_ACTION_REQUIRED latching, v0.11.11 typed one-shot
`diagnostics.localState`, v0.11.10 cross-boundary rearm semantics, the bounded baseline-correction
fence, Nano JSON completeness/output bounds, actor/capability routing and effect-integrity controls.

## Claim boundary

This design describes the local candidate. It does not prove installed-byte identity or Desktop
Chrome runtime acceptance.
