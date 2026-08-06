# Verification v0.9.9

## Baseline

- Exact source baseline: v0.9.8 source package.
- Baseline SHA-256: `ab42306f659540a34a148c32481a27bea21f3038c83c69f83663c705d65e74de`.
- Baseline regression before modification: 688/688 PASS.

## Historical comparison

The v0.7.8, v0.8.1 and v0.8.2 source packages were inspected directly. Each contains a direct provider `create()` path and support for `ai.languageModel`. The current field export shows v0.9.8 selected `LanguageModel` and did not receive positive progress.

## Required checks

- Provider selection block/emit tests.
- Provider-specific create option tests.
- Legacy capability normalization tests.
- Synchronous user-gesture create static check.
- Base/task provider pinning check.
- Provider telemetry and application-log persistence check.
- Full regression.
- Validator.
- JavaScript and module syntax.
- Package integrity and frozen-source rerun.

## Direct results

- Focused provider selection: 16/16 PASS.
- Full regression: 704/704 PASS.
- Validator: PASS.
- Syntax: 126/126 PASS.
- Frozen source package rerun: identical PASS results.
- ZIP integrity, unsafe paths, symlinks and encryption checks: PASS.
- Standard/browser common runtime files are byte-identical except profile-owned `manifest.json` and `build-info.json`.

## Runtime boundary

Desktop Chrome runtime success is not established by source tests. Acceptance requires exported telemetry showing:

- `modelKind: "ai.languageModel"` when that provider exists;
- provider policy `LEGACY_NATIVE_FIRST`;
- a non-null model session reflected as `status: "available"`;
- a subsequent real Nano attempt trace with positive input and a start timestamp.
