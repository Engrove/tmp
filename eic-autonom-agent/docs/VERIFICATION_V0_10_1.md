# Verification v0.10.1

## Baseline

- Attached v0.10.0 source ZIP: SHA-256 `c8e042e006e6dfc0e4c10938e06548c1d96799bb9fa86e284fac642e6bdbdbd4`.
- ZIP: 976108 bytes, 367 entries, CRC/path/symlink/encryption preflight PASS.
- Internal comparison against the prior v0.10.0 snapshot manifest: 366/367 file hashes match; the only difference is generated `build-info.json`. Application source, tests and documentation match that snapshot.
- Unchanged baseline execution: 743/743 tests PASS; validator PASS; syntax 140/140; packaging PASS.

## Runtime evidence used

The supplied v0.10.0 export and screenshots established the bounded defect targets:

- a stable legacy four-line EIC-AA/4 response was classified `PROTOCOL_AMBIGUOUS`;
- the run remained `WAITING_FOR_RESPONSE` while Nano telemetry remained `RUNNING` and no owned pending Nano request existed;
- Session Capture became visible only after explicit mission/capture activity;
- profile changes could leave a visible manual `Omstart krävs` state.

These observations are runtime evidence for v0.10.0 only. They do not prove v0.10.1 runtime behavior.

## Direct v0.10.1 gates

- Focused discriminating fixtures: 8/8 PASS.
- Full regression: 751/751 PASS.
- Validator: PASS.
- Syntax: 142/142 PASS.
- Current-protocol scan: active target/start/repair/archaeology/app-audit/decision paths use EIC-AA/5 and reject retired EIC-AA/4/FULL_STOP behavior.
- Packaging: PASS.

## Frozen-source rerun

A new work tree was extracted from the packaged v0.10.1 source ZIP.

- Focused discriminating fixtures: 8/8 PASS.
- Full regression: 751/751 PASS.
- Validator: PASS.
- Syntax: 142/142 PASS.
- Packaging: PASS.
- ZIP CRC/path/symlink/encryption checks: PASS.

## Claim boundary

The source suite verifies deterministic source behavior and package integrity. Actual Chrome service-worker lifecycle, IndexedDB, automatic capture, automatic Prompt API restart, canonical target delivery and one-shot interrupted-Nano recovery require separate Desktop Chrome acceptance.
