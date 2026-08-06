# Changelog v0.9.9

## Fixed

- Replaced implicit modern-first browser API selection with explicit `LEGACY_NATIVE_FIRST` native provider arbitration.
- Reintroduced the provider-specific direct activation contract used by the working v0.7.8–v0.8.2 line.
- `ai.languageModel` is selected when present; standardized `LanguageModel` is used only when the legacy native surface is absent.
- Legacy create calls no longer receive standardized modality or abort fields.
- Legacy capability values are normalized into the current admission states.
- Base and task sessions are pinned to the same native provider.
- Provider policy, contract and inventory are persisted in Nano-host telemetry and the rotating application log.
- The asset watchdog now also arms during `PREPARING_ASSETS`; the v0.9.8 timeout constants remain 1,200 seconds material progress and 1,500 seconds total create time.

## Contract

- Application version: `0.9.9`
- Export schema: `eic.autonom.export.v15`
- Nano-host telemetry schema: `eic.autonom.nano-host-telemetry.v2`
- Forward-only policy remains in force.
