# Verification — v0.12.12

The final exact-package values are written into `build-info.json` during
packaging. Required gates:

- inherited v0.12.9 deep-repair suite
- inherited v0.12.10 Autostart suite
- inherited v0.12.11 Nano owner-liveness suite
- v0.12.12 post-Nano handoff suite
- current whole-package invariant suite
- JS/MJS syntax for every packaged source/test file
- relative import resolution
- local named import/export binding scan
- local import-cycle scan
- lib-module top-level evaluation
- payload SHA-256 manifest readback
- packageDigest recomputation

Desktop Chrome acceptance is a separate runtime gate and remains `NOT_RUN`
until the exact v0.12.12 package is installed and observed.
