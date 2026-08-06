# Verification — v0.9.7

## Field input

The v0.9.6 export reported:

- host create started;
- availability `downloading`;
- progress `0`;
- no mission or run;
- no material progress for more than seven minutes;
- the outer 600-second create watchdog had not yet expired.

## Required invariants

1. Duplicate `0 %` events never extend the material-progress deadline.
2. A larger progress value resets the deadline.
3. A completed download cannot be classified as download-stalled.
4. A stall aborts host creation with a distinct machine reason.
5. Mission start remains disabled until a real, non-stale session is available.
6. Application logs are session-aware, bounded and self-rotating.
7. Sensitive transport and prompt/body fields are redacted.
8. Explicit export includes the log; routine snapshots include only a summary.
9. Forward-only behavior is preserved.

## Commands

```text
node --test tests/v097-nano-stall-application-log.test.mjs
npm test
npm run validate
npm run package
```

Final executed results are recorded in the generated test summary and delivery receipt. Interactive Desktop Chrome acceptance is separate.
