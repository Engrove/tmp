# EIC Autonom Agent v0.11.3

- Treats baseline Nano `ACCEPT` as a typed commit event rather than an ordinary continuation action.
- Stops `nextHighLeverageAction` from becoming the current executable `requestedAction` during baseline acceptance.
- Aligns background baseline grounding with sidepanel semantics: accepted baseline analysis bypasses ordinary continuation grounding.
- Requires the exact typed baseline Nano request id during `NANO_ANALYZING`; an arbitrary pending Nano request can no longer mask an ownerless baseline lifecycle.
- Rejects ordinary Nano/recovery/local program mutation before durable `READY`, except exact commit replay and session-init control.
- After durable `READY`, hands the same owner-bound observation to exactly one ordinary continuation Nano without sending a second baseline/target prompt.
- Resolves execution disposition before delivery regulation; delivery regulation applies only to material `TARGET_DISPATCH`.
- Makes ACKED baseline response re-observation lifecycle-aware so ordinary processed markers cannot strand baseline reconciliation.
- Routes terminal Nano ownership release through one common finalizer to prevent stale host-busy state.
- Requires every `WAITING_FOR_RESPONSE` state to have a causal wake source.
- Adds metamorphic and live-shaped regression coverage for the v0.11.2 `META_ONLY_ACTION`/baseline-reconcile deadlock.
