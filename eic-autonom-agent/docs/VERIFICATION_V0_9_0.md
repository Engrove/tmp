# Verification — EIC Autonom Agent v0.9.0

## Baseline

- WP12 source SHA-256:
  `a4df6c5b19ea7ac29e0492e2661f30872f3ec6ca7bc3edce8f4d39ed433b3f5c`
- Pre-WP14 full regression: 575/575 PASS.
- Pre-WP14 validator: PASS.

## WP13 runtime gate

- Desktop Chrome verdict: PASS, operator-reported on 2026-08-04.
- Scenario-level machine evidence: not supplied.

## WP14 release gate

WP14 must verify:

1. all active version surfaces equal `0.9.0`;
2. the STANDARD manifest has no debugger or general web host access;
3. the BROWSER manifest has debugger and only optional general web origins;
4. focused WP14 tests pass;
5. full regression and validator pass;
6. syntax checks pass;
7. build-info hashes match both profiles;
8. standard/browser/source ZIP CRC and safe-entry checks pass;
9. final package hashes are written to an external release receipt.

The external release receipt is generated after packaging and is not embedded into the ZIP files,
which avoids self-referential package hashing.

## Completed WP14 source verification

- Focused release tests: 8/8 PASS.
- Full regression: 583/583 PASS.
- Validator: PASS.
- JavaScript/MJS syntax: 122/122 PASS.
- Version surfaces: package, source manifest, runtime contracts, content bridge and sidepanel all `0.9.0`.
- Final ZIP hashes are intentionally emitted only in the external release receipt.
