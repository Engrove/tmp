# Verification v0.6.7

## Automated checks

Run from the source root:

```text
npm test
npm run validate
node --check background.js
node --check content.js
node --check sidepanel.js
npm run package
```

## Executed local result — 2026-08-02

- `npm test`: 216/216 passed, exit status 0.
- `npm run validate`: PASS, exit status 0.
- `node --check background.js`: PASS.
- `node --check content.js`: PASS.
- `node --check sidepanel.js`: PASS.
- `node scripts/background-smoke.mjs`: `BACKGROUND BOOT SMOKE PASS`.
- `npm run package`: install and source archives created with ZIP CRC validation.

These are local source/package checks. They are not desktop-Chrome end-to-end evidence.

The v0.6.7 fixtures cover:

1. stale Stop/composer-busy signals do not suppress a stable latest assistant response;
2. a real assistant streaming marker remains non-triggering;
3. a latest user prompt never reprocesses the previous assistant answer;
4. `WAITING` arms an assistant answer already present at activation;
5. response identity distinguishes identical assistant text across different user tasks;
6. browser entrypoints use role-first dynamic triggering without requiring trailer variables;
7. an unsettled candidate schedules its own follow-up stability read.

## Required desktop Chrome acceptance

Automated Node tests do not own live browser truth. Test the unpacked extension in desktop Chrome:

1. Link a ChatGPT tab containing a completed ordinary assistant answer with no EIC trailer.
2. Activate `WAITING`.
3. Confirm the run moves through stability checking to `ASSESSING`.
4. Submit a user prompt and confirm `WAITING` remains active while the user prompt is latest.
5. Confirm processing starts only after the later assistant response stabilizes.
6. Repeat with a lingering visible Stop/busy control.
7. Repeat with active streaming and confirm no premature trigger.
8. Repeat with ChatGPT structured background work and confirm the pipeline waits.
9. Reload/update the extension and reload the ChatGPT tab before judging the new content script.

## Evidence boundary

A passing Node suite and package validator support the candidate source and package. They do not prove installation, current Chrome runtime state, or live ChatGPT end-to-end behavior.
