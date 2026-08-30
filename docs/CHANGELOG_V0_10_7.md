# Changelog — EIC Autonom Agent v0.10.7

## Fixed

- Deterministic EIC-AA/5 CONTINUE decisions now provide a complete delivery contract before
  the direct-program-delta gate runs.
- Concrete bounded continuation work carries a positive direct program delta.
- A required owner-read carries `requiredControl`, a concrete omission failure and the exact
  action that unlocks delivery.
- `DIRECT_PROGRAM_DELTA_ZERO` no longer enters auto-recoverable `SOFT_PAUSED`.
- A rejected response identity is consumed and cannot be rearmed by the deterministic
  protocol fast path.
- Zero-delta waiting suspends the response timeout and remains stable until new evidence.
- The attention banner shows `Väntar på extern owner/locator` for owner-evidence waits.

## Added

- `deriveContinuationDeliveryContract()`.
- `resolveDeliveryRegulatorDisposition()`.
- `eic.autonom.delivery-wait.v1`.
- Paired emit/block fixtures and a background lifecycle regression fixture.
- Desktop Chrome v0.10.7 acceptance for the reproduced self-pause scenario.

## Preserved

- EIC-AA/5.
- Config/runtime v13.
- Continuity v4.
- Export v20.
- Chrome Prompt API and LanguageModel activation contract.
- v0.10.6 runtime-hardening, capture, audit and M2 mandate behavior.
- Source/package versus installed-runtime claim boundary.
