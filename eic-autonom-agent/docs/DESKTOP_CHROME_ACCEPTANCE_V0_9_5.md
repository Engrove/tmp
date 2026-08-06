# Desktop Chrome acceptance v0.9.5

Use the browser package as an unpacked extension in a fresh extension state.

## A. Gesture-bound Nano activation

1. Link an existing ChatGPT/EIC conversation containing a completed assistant response.
2. Do not press the separate Nano activation button.
3. Press **Starta valt uppdrag**.
4. PASS only when the Nano card moves through `STARTAR`/`LADDAR` to `KLAR` and the export has:
   - non-empty `nanoHostTelemetry.hostId`;
   - `nanoHostTelemetry.status = available`;
   - non-empty `modelKind`.

## B. Takeover emit twin

The pre-existing response may have no EIC-AA footer or a historical footer.

PASS only when:

- `lastNanoAttemptTrace` exists;
- `lastNanoAttemptTrace.decisionOwner = NANO_HOST`;
- `inputChars > 0`;
- `startedAt` and `transport` are populated;
- no audit event says takeover was handled as `repair-only utan Nano`.

## C. Current footer taxonomy

Verify:

- `CONTINUE` with `UNIT_DONE` or `MILESTONE_CONTINUE` is accepted;
- `DONE` requires `PROGRAM_DONE` and `EIC_NEXT: NONE`;
- `USER_PAUSE` requires `PROGRAM_BLOCKED`;
- `PAUSE` and `FULL_STOP` are rejected as retired contracts.

## D. Repair cutoff and identity

Create one invalid post-takeover response.

PASS only when:

- one repair prompt may be emitted;
- its header, machine envelope, requested action and response contract all use the same new turn ID;
- a second invalid repair response routes to Nano and does not create another deterministic repair.

## E. Continuity integrity

Run at least two response cycles.

PASS only when no new audit entry reports `Fönsterscoped continuity återställd från backup` with `DIGEST_MISMATCH`.

## Claim boundary

A passing source test suite is not this acceptance. Record the browser package digest, Chrome version, observed export fields and exact scenario results.
