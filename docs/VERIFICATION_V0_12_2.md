# Verification v0.12.2

Verification scope for the session-context material-event rearm fix:

1. Replays the exact exported v0.12.0 deadlock state where causal CONTROL had
   already CLOSED the baseline effect as `SUPERSEDED_BY_NEW_MATERIAL_EVENT`
   while legacy `currentTurn` and `sessionContextInit` still waited for it.
2. Requires the stale legacy baseline effect to become
   `CANCELLED_SUPERSEDED`.
3. Requires the stale `currentTurn`, pending baseline Nano/observation,
   response candidate and response deadline to be retired.
4. Requires session init to re-arm as `WAITING_CHAT_READY` with a fresh
   `needKey` in the current material generation.
5. Negative fixture proves an ACKED causal effect that has not been
   material-superseded is not retired.
6. Negative fixture proves ordinary `CONTINUATION` turns are not affected by
   the baseline-only repair.
7. JavaScript syntax validation covers every `.js`/`.mjs` file.
8. v0.12.1 NANO_TASK executor/parser/UI files remain byte-identical.
9. Package ZIP integrity and build-info file hashes are verified after
   packaging.

Desktop Chrome live acceptance is separate from source/package verification.
