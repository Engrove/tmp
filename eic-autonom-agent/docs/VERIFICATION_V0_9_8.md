# Verification v0.9.8

## Source baseline

- Exact v0.9.7 source ZIP SHA-256:
  `f1123d4689a0980b88918b481ace9d35e9f11ff9626b01e758a6c10a1b3ec5a8`
- Size: 910,015 bytes.
- ZIP entries: 330.
- CRC and path safety: PASS.

## Direct source verification

- Focused v0.9.8 and retained log/stall twins: **29/29 PASS**.
- Full regression: **688/688 PASS**.
- Validator: **PASS**.
- JavaScript/MJS syntax: **124/124 PASS**.

## Package verification

- Source, standard and browser package creation: PASS.
- ZIP CRC, unsafe paths, symlinks and encryption checks: PASS.
- Runtime build-info: 79 files per profile.
- Standard/browser common runtime files are byte-identical except
  profile-owned `manifest.json` and `build-info.json`.

## Runtime boundary

These checks prove the source and package candidate only. They do not prove that
Chrome has installed runnable on-device model assets, that a LanguageModel session
became available, that a Nano inference ran, or that a mission, installation,
release, deployment or publication occurred.

Desktop Chrome must separately verify either:

- `AVAILABLE` with a real model session and non-null Nano trace; or
- `EXTERNAL_MODEL_ASSET_BLOCKER` after the 1,200-second material-progress boundary,
  with no automatic retry and a session-bound application-log chain.
