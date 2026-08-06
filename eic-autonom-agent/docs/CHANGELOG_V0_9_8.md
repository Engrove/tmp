# Changelog v0.9.8

## Chrome on-device LanguageModel asset admission

- Replaced the operator-facing `Chrome Nano` label with `Chrome on-device LanguageModel`.
- Added `PREPARING_ASSETS` for `downloadable`, `downloading` or `downloadprogress=0` before any positive progress.
- `DOWNLOADING` now requires an observed positive progress fraction.
- Raised the material-progress watchdog from 180 seconds to 1,200 seconds.
- Raised the outer host-create watchdog to 1,500 seconds so it cannot pre-empt the 1,200-second material-progress boundary.
- A 1,200-second expiry without any positive progress produces `EXTERNAL_MODEL_ASSET_BLOCKER` and disables automatic retry.
- A 1,200-second expiry after positive progress remains `DOWNLOAD_STALLED`.
- `LOADING` remains separate from asset preparation and download progress.

## Diagnostics

- The session-aware rotating application log records the bounded admission chain:
  admission start, availability, asset preparation, material download progress, loading, available or terminal blocker, and settled.
- Start remains fail-closed until a non-stale LanguageModel session is `available`.
- No browser model installation, emulation or replacement path was added.

## Boundary

v0.9.8 remains forward-only. No backward-compatibility or migration adapter is provided.
