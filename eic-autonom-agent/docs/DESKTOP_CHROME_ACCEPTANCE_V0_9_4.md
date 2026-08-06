# Desktop Chrome acceptance — v0.9.4 mandate profile binding

## Setup

Load the v0.9.4 browser package as an unpacked extension in the supported Desktop Chrome environment. Open a clean forward-only window and link one ChatGPT controller tab.

## Block twin

1. Select `STANDARD_DELIVERY`.
2. Confirm the Nano version is `nano-core-v4`.
3. Manually force another profile's mandate text while retaining `nano-core-v4`.
4. Save or start.
5. Expected: `MANDATE_VERSION_HASH_CONFLICT`; no mission and no run are created.

## Emit twin — app preset

1. Select `WORKSPACE_GENERAL`.
2. Confirm the Nano profile is `WORKSPACE_AWARE_GENERAL`.
3. Confirm the Nano version is `nano-core-workspace-v1`.
4. Start the selected mission.
5. Expected: config save succeeds, the mission/run is created and no mandate conflict is logged.

Repeat with:

- `ARCHAEOLOGY_LONG` → `nano-archaeology-v1`
- `APP_AUDIT_LONG` → `nano-app-audit-v1`
- `STANDARD_DELIVERY` → `nano-core-v4`

## Emit twin — custom text

1. Edit the Nano mandate.
2. Expected before autosave: version becomes `nano-custom-<16 hex>`.
3. Edit the target mandate.
4. Expected before autosave: version becomes `target-custom-<16 hex>`.
5. Start the mission.
6. Expected: immutable registry entries are created for the content-addressed versions.

## Readback

Export state and verify:

- current app version `0.9.4`;
- non-empty `mandateRegistry.entries`;
- selected profile text and version agree;
- active mission/run exists only after successful save;
- no partial run exists after the block twin.
