# Verification v0.9.5

## Failure evidence

The v0.9.4 runtime export showed:

- `nanoHostTelemetry.status = unknown`;
- `lastNanoAttemptTrace = null`;
- `lastNanoTrace = null`;
- deterministic source `DETERMINISTIC_PROTOCOL`;
- `inputChars = 0`, `outputChars = 0`, `startedAt = null`;
- repeated `WRONG_TURN` repair responses;
- repeated continuity `DIGEST_MISMATCH` recovery.

## Root causes

1. `startMissionMode()` created the Chrome LanguageModel only for new-session mode, not continuation.
2. Invalid takeover responses were routed to deterministic repair before takeover analysis.
3. The EIC-AA parser still rejected completion-state evidence on `CONTINUE`.
4. Repair decisions embedded the prior expected turn ID while the compiled prompt allocated a new turn ID.
5. The mutable continuity work object aliased the sealed runtime snapshot, creating an integrity race.

## Direct gates

- Focused v0.9.5: 11/11 PASS.
- Full regression: 644/644 PASS.
- Validator: PASS.
- Syntax: 119/119 PASS.
- Source, standard and browser package generation: PASS.
- ZIP CRC, unsafe-path, symlink and encryption checks: PASS.
- Frozen source rerun: focused 11/11 PASS; full 644/644 PASS; validator and syntax PASS.

Exact package sizes and SHA-256 values are stored in the delivery receipt generated beside the packages.

## Claim boundary

These gates verify source and packages. They do not prove Chrome installation, a live LanguageModel inference, or the v0.9.5 Desktop Chrome acceptance scenarios.
