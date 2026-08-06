# Verification — v0.6.5

## Source basis

- Input source: supplied `EIC_Autonom_Agent_v0_6_4_delivery_bundle.zip`.
- Input failure analysis: supplied `files (1).zip`.
- Source archive and analysis archive were extracted with path-traversal and symlink checks.
- Baseline source test suite: 194/194 passed before incident patches.

## Permanent automated checks

The v0.6.5 source tree contains:

- existing unit/regression suite;
- `tests/v065-incident-regression.test.mjs`;
- release validator;
- deterministic packager with build-info digests and ZIP CRC verification.

## Executed local checks

Executed in the extracted v0.6.5 source tree:

```text
npm test
206 tests, 206 passed, 0 failed

npm run validate
VALIDATE PASS

node scripts/background-smoke.mjs
BACKGROUND BOOT SMOKE PASS

node /mnt/data/eic_debug_work/repro_v065.mjs
compactContextText(..., 0) -> 0 characters
incident prompt -> 2,384 / 2,400 characters
withinBudget -> true

npm run package
install ZIP and source ZIP created; packager CRC check passed
```

The incident prompt reproduction uses the same high-volume mandate, response, conversation, target-result evidence and anti-loop shape used for the pre-patch source-level reproduction.

## Evidence boundary

A successful local run supports source-level and package-level claims only. It does not prove:

- that Chrome loaded this exact package;
- that ChatGPT's current DOM matches the fixtures;
- that Gemini Nano is available;
- that a real long-running browser incident is fixed end-to-end;
- deployment or installation status.

Use `DESKTOP_CHROME_ACCEPTANCE_V0_6_5.md` for the owner-surface runtime check.
