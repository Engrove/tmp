# CHANGELOG — v0.12.10

## Fixed

- Autostart no longer rejects an empty cached `selectedTabId` when the selected
  preset itself owns `LINK_ACTIVE_TAB`.
- Autostart no longer marks an existing verified Nano base stale merely by
  staging a scenario profile before target binding.
- Failed staged LanguageModel replacement restores the previous verified base
  session when one exists.
- Autostart defers persistent config commit until target binding and Nano
  readiness have succeeded.
- A failed pre-commit Autostart restores the persisted config inputs in the
  panel while retaining any legitimate target-link state.
- If a newly verified Nano base cannot have its matching config committed, the
  new base is failed closed instead of being used under mismatched durable
  configuration.
- Nano stale badge wording changed from `OMSTART KRÄVS` to `AKTIVERA NANO`.

## Verification added

- `tests/v0.12.10-autostart-regression.mjs`
- inherited `tests/v0.12.9-repair-regression.mjs`

No new autonomous browser capability is added.
