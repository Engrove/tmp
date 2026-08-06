# Verification v0.8.0

Denna fil beskriver source-level verifiering. Desktop Chrome, Prompt API/Nano och live Workspace/ChatGPT end-to-end måste verifieras separat.

## Source gates

- Node test suite.
- Static validation.
- ZIP CRC.
- `build-info.json` per-file hashes.
- Manifest permissions och host allowlist oförändrade.

## Required v0.8.0 cases

- Legacy profiles equal active default mandates.
- ARCHAEOLOGY_LONG is a separate run mode.
- ERP is one scenario among several.
- A valid archaeology event is parsed, gated and applied.
- Forbidden effects fail the archaeology gate.
- Workspace recommendations require live discovery.
- USER_PAUSE parses only with exact next decision and no completion evidence.
- USER_PAUSE produces level 10 and local human-required handling.
- Existing v0.7.8 regression suite remains green.
