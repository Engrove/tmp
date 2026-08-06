# Verification v0.9.10

## Source basis

Baseline: exact v0.9.9 source package.

- SHA-256: `214465005426aea71ebea91a3c662b2625bea6b4cdbc63eafc1f3ca91f4dd133`
- Size: 924,244 bytes
- ZIP entries: 340
- CRC/path/symlink/encryption checks: PASS

## Online contract review

The active implementation was compared against current Chrome/Chromium primary sources before coding:

- current extension surface: `LanguageModel`;
- extensions available from Chrome 138;
- passive readiness: `LanguageModel.availability()`;
- download/session admission: `LanguageModel.create()` after user activation;
- download telemetry: create monitor `downloadprogress`;
- `signal`, `initialPrompts`, sampling and expected modalities are optional create settings;
- `ai.languageModel` is not part of the current extension reference path.

The source-derived contract and the project-specific canary design are separated in `V0_9_10_PROMPT_API_ACTIVATION.md`.

## Automated results

- Official Prompt API activation focus suite: 16/16 PASS.
- Full regression: 701/701 PASS.
- Validator: PASS.
- Syntax: 126/126 PASS.
- Package command: PASS.
- Source, standard and browser ZIP CRC/path/symlink/encryption checks: PASS.
- Runtime build-info: 81 files per profile.
- Frozen source-ZIP rerun:
  - focus 16/16 PASS;
  - full regression 701/701 PASS;
  - validator PASS;
  - syntax 126/126 PASS.

## Discriminating invariants

- No active `ai.languageModel` provider.
- `LanguageModel.create()` is entered synchronously in the explicit activation click.
- No `await`, storage write, message hop or availability call precedes native create.
- Admission create has no initial prompt, expected modalities, language declaration or sampling parameters.
- Non-empty local canary output is required before readiness.
- The admission session is destroyed and replaced by a clean mandate-bound base.
- Mission start does not initiate model creation.
- Mission start remains blocked until a local base session is available, non-stale and canary-verified.
- Telemetry v3 records user activation, preflight and canary evidence.
- 1,200-second material-progress and 1,500-second total-admission limits remain enforced.

## Claim boundary

The automated and frozen-source suites prove source-level contracts and deterministic block/emit cases. They do not prove that the target Chrome installation has runnable model assets or that a real Desktop Chrome canary has succeeded. Desktop Chrome runtime remains a separate owner surface.
