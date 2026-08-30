# Changelog v0.10.8

## Fixed

- Removed the false `handle.name === "temp"` admission rule that caused `FULL_AUDIT_DIRECTORY_MUST_BE_EXISTING_TEMP_FOLDER`.
- Added permission-bound full-audit write/readback/delete probing.
- Replaced the v0.10.6-only audit sink key with a version-neutral key plus legacy migration.
- Replaced the v0.10.6-only retention regex with a version-neutral segment matcher.

## Added

- `eic.main-task-baseline.v1`.
- Predetermined `HUVUDUPPGIFTSKONTROLL` prompt as Nano’s first action when baseline context is absent.
- Explicit 80/20 `vitalFew`/`deferredMany` fields.
- Active, required and missing global-skill reporting.
- `trackControl` classifications: `BASELINE_REQUESTED`, `ON_TRACK`, `JUSTIFIED_DETOUR`, `DRIFT`, `INSUFFICIENT_CONTEXT`.
- Required detour reason, bounded return condition and leverage verdict.
- Baseline parsing and continuity projection.
- Protocol fast-path gate until a baseline exists.
- Discriminating baseline, detour, drift, audit and wiring fixtures.

## Preserved

- EIC-AA/5.
- Config/runtime v13.
- Continuity v4.
- Export v20.
- Chrome standard LanguageModel activation/canary contract.
- Owner-route, claim, authorization and effect boundaries.
