# EIC Autonom Agent v0.8.2 — verification

## Source verification target

The release is accepted at source level only when all conditions pass:

- JavaScript syntax checks for background, content and side panel;
- the complete historical regression suite;
- new window/run continuity isolation tests;
- specialized-mode sticky-state tests;
- takeover intent-ownership test;
- `g:`→`c:` locator-promotion test;
- specialized response-completion gate test;
- evidence/action separation test;
- start-receipt reconciliation test;
- Nano wall-timeout and export-contract source invariants;
- package validation and ZIP CRC/hash verification.

## Executed source result

- JavaScript syntax checks: PASS.
- `npm test`: 382/382 PASS.
- `npm run validate`: PASS.

## Required runtime acceptance

Source tests do not prove Chrome lifecycle behavior. Desktop acceptance must additionally
show:

1. two Chrome windows with different tasks retain independent continuity;
2. ARCHAEOLOGY_LONG survives same-target Pause/Resume and Stop→Start/Continue;
3. another target cannot silently inherit the specialized mode;
4. a promoted ChatGPT conversation does not change the research intent;
5. an incomplete streaming response does not start Nano in ARCHAEOLOGY_LONG;
6. a deliberately stalled Nano request is aborted within the configured deadline;
7. an unconfirmed start receipt becomes ACKED after the first matching assistant reply;
8. strict USER_PAUSE still reaches HUMAN_REQUIRED while ordinary lower-level pause remains
   autonomously recoverable.

Until those checks are executed on Desktop Chrome, v0.8.2 is a source-verified candidate,
not a runtime-certified release.
