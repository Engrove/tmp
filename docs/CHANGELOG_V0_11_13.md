# Changelog v0.11.13

- Centralized owner-bound human-wait transition admission in `lib/state-machine.mjs`.
- `force` can no longer bypass `AWAITING_OPERATOR_ACTION` or `AWAITING_OPERATOR_DECISION`.
- Matching accepted local receipt identity is required for the sole normal exit to `RECOVERING`.
- Generic Pause is rejected for both human waits; sidepanel Pause is disabled.
- Watchdog/session-init reconciliation returns before autonomous work in both human waits.
- Prepared-effect and stale Nano callbacks are fail-closed across both human waits.
- Nano request claiming is disabled while a human wait is active.
- Structured operator expected-evidence rendering no longer degrades to `[object Object]`.
- Rotated current-only storage namespace to v113.
- Added adversarial state-space and Pause→Resume acceptance requirements.
