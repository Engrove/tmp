# EIC Autonom Agent v0.10.6 — Verification

## Verification profile

`STRICT_AUDIT`

## Source baseline

v0.10.5 source SHA-256:

`bc62d8d0dd5d173c74f6f61566501992777b9403aa136b6ded5658182f2cd3b4`

## Required local gates

Run from the source root:

```bash
npm test
npm run validate
npm run package
```

A frozen source package must then be extracted and the same three commands rerun. Every package `build-info.json` entry must match the extracted file bytes.



## Verified result

The final source candidate was tested both before packaging and after extraction from the frozen source ZIP:

- `npm test`: **802/802 PASS**
- `npm run validate`: **PASS; 156/156 syntax checks**
- `npm run package`: **PASS**
- `build-info.json`: **126/126 files matched** for SOURCE, STANDARD and BROWSER
- ZIP CRC: **PASS**
- unsafe archive paths: **0**


## Focused v0.10.6 fixtures

The new fixtures cover:

- run-to-continuity projection;
- semantic continuity equality;
- Nano/capture arbitration;
- partial Nano telemetry and clone consistency;
- bounded redacted full-audit queue;
- virtualized ordinal-independent turn identity;
- cumulative delta and monotonic full capture;
- stable-gap delta policy;
- target/control project mismatch;
- stable capture fingerprint;
- mission step/next/risk projection;
- owner receipt claim gate;
- M2 mandate level and level-10 exclusion;
- watchdog, heartbeat, audit UI and acknowledgement source ownership;
- default-OFF audit configuration.

## Claim boundary

Passing these gates does not prove:

- installed Desktop Chrome runtime acceptance;
- actual writes to `C:\temp`;
- Prompt API latency or discrimination under live load;
- M2 owner-route effects;
- external project/repository state.

Those require the operator acceptance matrix and route-native evidence.
