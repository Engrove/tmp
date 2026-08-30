# Verification v0.10.5

## Required source gates

- `npm test`
- `npm run validate`
- `node --check` for all runtime, library, script and test files
- `npm run package`
- ZIP CRC and path-safety verification
- frozen-source package rerun
- build-info file hash verification

## Required discriminating fixtures

- current v13 config/runtime emits `CURRENT_SCHEMA`;
- stale v12 expectation resets a v13 runtime and reproduces the v0.10.4 mechanism;
- first D2 click arms without model creation;
- second matching D2 click confirms;
- expired or changed confirmation re-arms;
- activation rejection becomes a handled outcome;
- tab/controller mismatch blocks mission start;
- matching readback permits the source path to continue;
- no modal `confirm()` precedes native create;
- native create is invoked before the first await in the execution click.

## Executed source results

- Focused v0.10.5 recovery fixtures: `8/8 PASS`.
- Full regression: `785/785 PASS`.
- Validator: `PASS`.
- Syntax: `153/153 PASS`.

Packaging, frozen-source rerun, ZIP CRC and build-info verification are recorded in the external delivery report because their final hashes depend on the final archive bytes.

## Claim boundary

These results verify the delivered source/package candidate only. Installed Desktop Chrome behavior remains pending.
