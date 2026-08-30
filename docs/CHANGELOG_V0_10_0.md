# EIC Autonom Agent v0.10.0 changelog

## Added

- `EIC-AA/5` five-line response protocol with explicit next actor and autonomy state.
- Durable `OPERATOR_ACTION_REQUIRED` model for precise mechanical operator work.
- Separate material level-10 decision receipt with normalized grapheme validation and exact mission/run/decision binding.
- Current-only runtime states: `RUNNING`, `AWAITING_OPERATOR_ACTION`, `AWAITING_OPERATOR_DECISION`, `PROGRAM_BLOCKED`, `PROGRAM_DONE`.
- Transcript-only full/delta Session Capture with virtualized sweep, gaps and scroll restoration.
- IndexedDB-backed Session Capture and Session Memory with transactional readback, redaction, retention/purge and fail-closed error handling.
- Source-bound Session Memory v1 with typed registers, provenance, supersession, stale-state handling and bounded Nano capsule.
- Exactly four whole-application quick profiles with `VERIFIED_ANALYSIS` as default and non-silent recommendations.
- Export v18 summaries for profile, operator action, capture and memory.
- Forty v0.10.0 discriminating tests plus updated full regression coverage.

## Changed

- App/content version is `0.10.0`.
- Config/runtime schemas are v11.
- Export schema is v18.
- Nano decision request is v11.
- Nano mandate is v5 and target mandate is v4.
- UI command registry contains the new operator receipt, capture and purge commands.
- Historical level-10 authorization is replaced by exact decision receipts.
- Current-only namespace keys use v10 identifiers.

## Preserved

- Standard Chrome `LanguageModel` activation.
- English output-language attestation.
- Bounded local canary.
- Clean mandate-bound base and task sessions.
- Trusted-session, owner-route, claim, approval, effect and recovery gates.
- STANDARD and BROWSER package permission separation.

## Removed

- EIC-AA/4 response protocol.
- Export v17 and config/runtime v10 acceptance.
- v0.9.x state migration or compatibility behavior.
- Treating mechanical operator presence as a material level-10 decision.

## Not performed

No repository publication, merge, tag, release, installation, extension reload, deployment or Chrome Web Store publication is part of v0.10.0 source/package verification.
