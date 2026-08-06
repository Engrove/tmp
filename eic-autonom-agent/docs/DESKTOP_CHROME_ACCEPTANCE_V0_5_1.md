# Desktop Chrome acceptance — v0.5.1

Status före körning: `BROWSER_RUNTIME_PENDING`.

## Installera

1. Packa upp install-ZIP.
2. Öppna `chrome://extensions`.
3. Aktivera utvecklarläge.
4. Ladda unpacked-mappen.
5. Öppna en inloggad ChatGPT-session och sidopanelen.
6. Koppla exakt targetflik.

## Background wait

Kör separata svenska och engelska testflöden.

Verifiera:

- foreground generation blir `WAITING_FOREGROUND`;
- ChatGPTs strukturerade background UI blir `WAITING_BACKGROUND`;
- UI visar timeout suspenderad och växande wait-age;
- ingen statusprompt skickas;
- väntan överstiger tidigare timeout utan paus;
- annan flik/fönster kan vara aktivt;
- Chrome kan minimeras;
- skärmsläckare/låsskärm medan systemet är vaket;
- service worker kan stoppas i extensioninspektorn och state återställs;
- discarded/frozen ger reconcile-on-resume;
- efter verklig sleep/wake skapas en reconciliation, inte catch-up-turns;
- nytt komplett svar kräver stabil readback och återupptas högst en gång;
- explicit Cancel/Avbryt, auth och targetnavigation stoppar.

Rapportera separat:

- `continued while system awake`;
- `resumed correctly after OS suspension`.

## Mjölnar

Börja i Shadow:

- D0 candidate → DELEGABLE men ingen dispatch.
- D1 komplett candidate → DELEGABLE men ingen dispatch.
- D2 auth/permission/delete/merge/release/deploy → HUMAN_REQUIRED.
- Hjalmar BLOCK → ingen dispatch.

Aktivera sedan D0 live:

- `REFRESH_TAB_STATUS`;
- `RECONNECT_CONTENT`;
- `RESUME_VERIFIED_MARKER`;
- `RELOAD_SELECTED_TAB` endast när ingen task är aktiv.

D1 live kräver explicit operatorval:

- `SET_AUTO_DISCARDABLE_FALSE`;
- readback;
- `RESTORE_AUTO_DISCARDABLE`;
- verifierad rollback.

För varje action: kontrollera ledger, idempotency key, dispatchstatus och readback. Simulera workerrestart mellan dispatch och readback; ingen blind dublett får ske.

## Evidens att returnera

- Chrome-version;
- extensionversion;
- tidsstämplad transitionlogg;
- skärmbild av background UI och addonstate;
- resultat per scenario;
- eventuella aktuella DOM-diagnostics;
- explicit PASS/FAIL/PENDING per acceptancepunkt.
