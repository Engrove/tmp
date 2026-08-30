# Changelog v0.11.16

## Fixed

- A due trusted terminal response candidate now has owner-drain priority after effect reconciliation
  and before autonomous Nano/recovery/session-init branches can return.
- A terminal candidate that reaches its persisted bounded settle deadline must be processed or emit
  typed `RESPONSE_SETTLE_LIVENESS_TIMEOUT`.
- A settled terminal response that remains completion-policy-ineligible is bounded-failed instead
  of being probed forever.
- Trusted protocol-completion override uses the normal settle threshold while true foreground
  streaming remains protected.
- Core Surface Review config patches require non-`OK` setting findings to be material.
- Explicit `NO_CHANGE` suppresses contradictory stray patch/surface fields.
- Semantically no-op Core Surface Reviews therefore resolve without creating a material owner event.

## Preserved

- v0.11.15 persisted response candidate, local timer, `chrome.alarms` wake and startup restore.
- v0.11.14 lexical `USER_PAUSE` correction.
- v0.11.13 receipt-bound `AWAITING_OPERATOR_ACTION` /
  `AWAITING_OPERATOR_DECISION` transition authorization.
- v0.11.11 local-state diagnostics, v0.11.10 local-rearm bridge, baseline correction,
  Nano completeness/output bounds, actor/capability and effect-integrity controls.
