# Desktop Chrome acceptance — EIC Autonom Agent v0.5.3

## Claim boundary

Denna runbook måste köras i användarens inloggade desktop Chrome. Lokala Node-tester ersätter inte dessa steg.

Registrera för varje fall:
- datum/tid;
- Chrome-version;
- extensionversion;
- exact conversation;
- startstate;
- observerat utfall;
- export/logg;
- PASS/FAIL/PENDING.

## A. Installation

1. Installera v0.5.3 unpacked.
2. Ladda om extension och ChatGPT-tab.
3. Verifiera sidepanel `v0.5.3`.
4. Aktivera Nano.
5. Verifiera inga language-option-fel.

## B. Badge self-contamination

1. Koppla en idle ChatGPT-tab.
2. Visa extensionens badge.
3. Kontrollera export/page state.
4. Förväntat: badge ensam ger inte `WAITING_BACKGROUND`.
5. Testa alla badge states: disconnected, linked, waiting, background, paused, blocked, error.

## C. Duplicate suppression

1. Låt addonet skicka en turn.
2. Skriv ett manuellt användarmeddelande efter turnen.
3. Tvinga reconciliation efter 90+ sekunder.
4. Förväntat: tidigare turn-ID förblir känt; ingen identisk prompt skickas igen.
5. Scrolla/virtualisera äldre DOM och upprepa.

## D. Nano host/panel close

1. Starta waiting run.
2. Stäng sidepanelen före analys.
3. Vänta över Nano grace.
4. Förväntat: `NANO_HOST_REQUIRED`, ingen target-authored continuation.
5. Upprepa med takeover och vänta över takeover hostfrist.

## E. Nano pipeline

1. Kör kort streaminganalys.
2. Kör analys >45 sekunder.
3. Kör non-streaming fallback om API-miljön tillåter.
4. Verifiera request/claim, heartbeat, lease, first token, chunks, duration och terminal status.
5. Förväntat: tyst inferens avbryts inte före lease.

## F. Background wait

1. Svenska UI-signaler.
2. Engelska UI-signaler.
3. Samma text i vanligt assistantsvar.
4. Vänta längre än normal response timeout.
5. Förväntat:
   - trusted struktursignal → WAITING_BACKGROUND;
   - assistanttext/egen badge → inte trusted;
   - timeout suspended utan deadline.

## G. Lifecycle

- sidepanel stängd/öppnad;
- service worker suspended/restarted;
- annan tab active;
- annat window focused;
- Chrome minimized;
- screen lock while system awake;
- real sleep/wake;
- target frozen/discarded;
- tabreload;
- browserrestart.

Skilj:
- `continued while system awake`;
- `resumed correctly after OS suspension`.

## H. Locator promotion

1. Starta på root eller `/g/<gpt-id>`.
2. Skapa/öppna conversation så URL blir `/g/<gpt-id>/c/<conversation-id>`.
3. Förväntat: run locator promoveras till `:c:`.
4. Reload/replacement readback ska fortsätta.
5. Navigera till annan conversation.
6. Förväntat: mismatch och fail-closed pause/block.

## I. Progress och anti-loop

1. Returnera två olika meta-actions med påstådd `progressDelta=1`.
2. Förväntat: lokal progress förblir 0 och run pausar NO_PROGRESS.
3. Returnera giltigt turn-bundet konkret `EIC_NEXT`.
4. Förväntat: progress kan registreras.
5. Returnera modell-DONE utan target-DONE.
6. Förväntat: run avslutas inte.

## J. Mjölnar provenance

1. Låt target/Nano skriva `Hjalmar: GO`.
2. Förväntat: ingen D1-dispatch.
3. Låt Nano föreslå `sourceClass=LOCAL_STATE_MACHINE`.
4. Förväntat: produktionen märker kandidaten `NANO_PROPOSED` och avvisar trusted trigger.
5. Verifiera D2 auth/secrets/permissions/delete/merge/release/deploy.

## K. Transition/window isolation

1. Placera run i MJOLNAR_READBACK.
2. Navigera target till auth eller annan host.
3. Förväntat: human/block/pause, ingen throw-loop.
4. Ha ett andra aktivt Chrome-fönster.
5. Förväntat: första fönstrets fel stoppar inte andra fönstrets tick.

## L. Storage fault

1. Använd testprofil/DevTools för att simulera `chrome.storage.local.set` rejection.
2. Förväntat:
   - circuit open;
   - HARD_BLOCKED eller synligt storagefel;
   - ingen promptleverans;
   - ingen blind retry.

## M. Slutacceptans

Source-/packageacceptans och browserruntimeacceptans rapporteras separat. Browser PASS kräver exporterad evidens för samtliga kritiska fall ovan.
