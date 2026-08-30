# Changelog v0.10.5

## Fixed

- Replaced stale literal config/runtime loader version `12` with contract-owned v13 constants.
- Prevented current config/runtime state from resetting during every `loadBundle()` call.
- Replaced modal D1/D2 confirmation with a two-click in-panel confirmation that preserves native user activation.
- Attached model-activation rejection handling synchronously.
- Added tab/controller binding readback before mission start.
- Removed the redundant config save from the Autostart mission-start phase.
- Added current-version storage/port namespaces for v0.10.5.

## Verification additions

- Current-state round-trip fixture.
- Reproduced stale-v12 reset fixture.
- D1/D2 arm/confirm/expiry fixtures.
- Immediate rejected-activation outcome fixture.
- Tab/controller matching readback fixture.
- Source-order guard for create, readback and mission start.
