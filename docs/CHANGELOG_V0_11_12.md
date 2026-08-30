# EIC Autonom Agent v0.11.12

- Preserves the v0.11.11 typed one-shot `diagnostics.localState` channel and all earlier local-rearm, baseline-correction, Nano completeness/output-bound and actor/capability controls.
- Fixes the v0.11.11 operator-action dominance defect: valid `OPERATOR_ACTION_REQUIRED` + `OPERATOR_ACTION` is latched immediately after target protocol parsing, before Nano, baseline/session-init routing, recovery, protocol repair or deferred mission logic.
- Extends deterministic human-boundary fast-path eligibility to `OPERATOR_ACTION_REQUIRED` as a defensive preserved-observation/recovery rule.
- Marks the operator-action target response processed before the latch so an accepted receipt cannot re-latch the same assistant response on resume.
- Clears pending Nano/observation/candidate/wait state, suspends response timeout, sets `AWAITING_OPERATOR_ACTION`, and cancels any still-PREPARED/RETRY_PREPARED effect before it can dispatch.
- Adds a second dispatch guard in `executePreparedEffectUnlocked()` so callbacks prepared before the boundary cannot submit after the latch.
- Treats `AWAITING_OPERATOR_ACTION` as an explicit human-required boundary in snapshot/UI routing.
- Rotates current-only storage from `v111` to `v112`; no v0.11.11 runtime state is imported as current v0.11.12 state.
