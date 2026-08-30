# Desktop Chrome acceptance — v0.10.1

Run only against the packaged v0.10.1 browser build.

1. Confirm the extension UI reports v0.10.1 and current config/runtime v12.
2. Confirm both checkboxes are selected by default:
   - automatic LanguageModel restart;
   - automatic Session Capture.
3. Activate LanguageModel once and verify canary PASS.
4. Change whole-app profile while model assets are available:
   - exactly one automatic restart occurs;
   - canary PASS returns;
   - repeated identical stale notifications within ten minutes do not create another restart.
5. Produce a stable assistant response without starting a mission:
   - automatic full capture appears;
   - scroll position is restored;
   - memory summary appears.
6. Produce one additional stable response:
   - delta capture occurs;
   - unchanged turns are deduplicated.
7. Start a continuation on a legacy four-line target response:
   - one EIC-AA/5 repair turn is generated;
   - the delivered prompt contains EIC_NEXT_ACTOR;
   - no protocol repair loop occurs.
8. Close the sidepanel during Nano inference and reopen it:
   - the orphaned RUNNING attempt is marked interrupted;
   - the preserved observation is requeued at most once;
   - the next canonical target prompt is delivered or an exact blocker is shown.
9. Inspect target prompt:
   - one compact JSON envelope;
   - no EIC_FIELD/EIC_BLOCK Markdown mirror;
   - exactly five required final response lines.
10. Export state and verify v19 summaries contain no transcript body, cookie, token or credential.

A source/package PASS does not prove this Desktop Chrome runtime matrix.
