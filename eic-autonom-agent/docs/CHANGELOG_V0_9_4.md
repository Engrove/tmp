# EIC Autonom Agent v0.9.4

## Bounded fix

v0.9.4 corrects the Desktop Chrome start failure:

`MANDATE_VERSION_HASH_CONFLICT: NANO:nano-core-v4`

The v0.9.3 sidepanel changed the Nano mandate text when a profile or app preset was selected, but it did not update or submit the selected profile's `nanoMandateVersion`. The background mandate registry therefore received new semantics under the previously registered version and correctly rejected the save.

## Changes

- Added the visible `nanoMandateVersion` field to the settings contract.
- `applyNanoProfile` now applies profile ID, version and text atomically.
- `uiConfig` now submits `nanoMandateVersion`.
- Snapshot rendering restores the persisted Nano mandate version.
- Manual Nano and target mandate edits receive deterministic content-addressed versions before autosave.
- Current background fallbacks are `nano-core-v4` and `target-core-v3`.
- Config writes retain the current v10 contract.
- The immutable version/hash gate remains fail-closed; it was not weakened.

## Boundary

This release does not add authority, compatibility adapters, migration paths, repository effects, installation claims or release/deployment behavior.
