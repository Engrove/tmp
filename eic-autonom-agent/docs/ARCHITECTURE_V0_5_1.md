# EIC Autonom Agent v0.5.1 — arkitektur

## Scope

v0.5.1 bygger vidare på v0.5.0:s storage-backed service-worker-orkestrering, exakta tab-/fönsterbindning, tre kärnytor, engångsstartprompt, Max Autonomous Mode och journalförd promptleverans.

Nya ansvar:

1. `content.js` producerar ett strukturerat, provenancebundet page-state.
2. `lib/chatgpt-state-classifier.mjs` klassificerar foreground, background, stable completion, auth, cancel, error och unknown.
3. `lib/background-wait-controller.mjs` gör `WAITING_BACKGROUND` till ett beständigt TTL-fritt state.
4. `lib/mjolnar.mjs` implementerar lokalt request/response-kontrakt, D0/D1/D2-policy, bias-bounded checks, statisk action registry och at-most-once-ledger.
5. `background.js` är single writer för run state, reconciliation, dispatcher och owner-readback.
6. Sidepanelen visar state men äger inte körningen.

## WAITING_BACKGROUND

Detektering kräver trusted DOM-struktur utanför vanliga assistantmeddelanden. Lager:

1. role/data/ARIA status- och progressankare;
2. strukturella progressrelationer;
3. Cancel/Hide eller Avbryt/Dölj;
4. svensk/engelsk normaliserad text som fallback;
5. fail-closed `UNKNOWN_RECONCILE`.

När state är aktivt:

- `responseDeadlineAt=null`;
- `timeoutSuspended=true`;
- inget nytt ChatGPT-turn skickas;
- alarm och DOM-events skapar bara reconciliation;
- väntetid är observerbar men har ingen deadline;
- explicit Stop, cancel, auth/CAPTCHA, target mismatch och korrupt state gäller fortfarande.

Efter att background-signalen försvunnit krävs två stabila snapshots med samma assistant-hash och message count innan normal assessment återupptas.

## MV3-livscykel

`chrome.storage.local` är source of truth. Service worker kan avslutas när som helst. Watchdog-alarm återskapas vid varje workerstart och är endast en väckningssignal. Frozen/discarded target bevarar logiskt state och får `RECONCILE_ON_RESUME`. Wall-clock-gap under sleep används aldrig som TTL-expiry i background state.

## Mjölnar

Mjölnar är en delegeringsbedömare, inte fact owner eller execution proof.

- D0: registrerad read/status/reconnect/reload/resume.
- D1: registrerad reversibel handling med rollback och readback.
- D2: auth, CAPTCHA, credentials, permissions, share, destructive, merge, release, deploy och annan mänsklig auktoritet.
- Standard rollout är `SHADOW`.
- `D0_LIVE` tillåter endast D0.
- `D1_LIVE` tillåter D0 och fullständigt kontrollerad D1.
- En vanlig target-text kan aldrig skapa en trusted request.
- Dispatch bindas till idempotency key över action, exact target, effect, conversation och snapshot.
- Okänd tidigare effekt kräver owner-read före retry.

## Top-level states

`IDLE`, `PREPARING`, `WAITING_FOR_RESPONSE`, `WAITING_FOREGROUND`, `WAITING_BACKGROUND`, `ASSESSING`, `CONTINUING`, `RECOVERING`, `SOFT_PAUSED`, `HARD_BLOCKED`, `MJOLNAR_ADJUDICATING`, `MJOLNAR_DISPATCH`, `MJOLNAR_READBACK`, `HUMAN_REQUIRED`, `DONE`, `STOPPED`, `ERROR_RETRYABLE`, `ERROR_TERMINAL`.

## Claim boundary

Source- och Node-tester kan verifiera pure logic, migration, static contracts och paketering. Faktisk ChatGPT-DOM, flera timmars background wait, Chrome suspension, Windows lock/sleep och D0/D1-dispatch kräver separat desktop Chrome-owner evidence.
