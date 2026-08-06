# Desktop Chrome Acceptance — EIC Autonom Agent v0.6.3

## Förutsättningar

- Desktop Chrome som stöder extensionens minimumversion.
- Inloggad ChatGPT-session.
- v0.6.3 load-unpacked.
- Kopplad exakt målflik i `LOCKED`.
- Export av incidentstate finns.
- DevTools/service-worker-logg får läsas men inga hemligheter ska exporteras.

## A. Exakt revision-storm-replay

1. Importera v0.6.2-state som innehåller:
   - `ASSESSING`;
   - `DETERMINISTIC_PENDING`;
   - senaste resultat `GROUNDING_REJECTED: META_ONLY_ACTION`;
   - giltigt turn-bundet `EIC_AUTONOMY: CONTINUE`;
   - konkret EIC_NEXT som börjar `Reconcile or recreate...`.
2. Notera initial stateRevision.
3. Vänta 20 sekunder utan att klicka.
4. Verifiera:
   - högst en aktiv deterministic callback-lease;
   - inte hundratals revisioner;
   - ingen upprepning av samma två auditposter per tick;
   - pending request konsumeras eller går till bounded reconciliation;
   - exakt en ny målprompt skickas om target fortfarande matchar;
   - prompten innehåller den konkreta actionen eller en enda explicit owner-read-repair.

PASS kräver faktisk promptack eller ett avgränsat, stabilt recovery-state med en ny unlock/owner-read-händelse. `ASSESSING` med snabbt stigande revision är FAIL.

## B. Groundingmatris

Kör följande:

1. `Reconcile or recreate exact branch ... verify_remote=true ... commit/digest parity`
   - ska vara konkret.
2. `Verify the plan`
   - ska vara meta-only.
3. `Read workspace.forgejo.publish.status for request abc_123 and return status/hash/delta`
   - ska vara konkret.
4. Samma konkreta action utan target/locator
   - ska repareras en gång eller gå till bounded owner-read; aldrig spinna.

## C. Callback at-most-once

1. Pausa service worker precis efter att request blivit `DISPATCHED`.
2. Trigga panelrefresh, tab event och watchdog.
3. Verifiera att stateRevision inte ökar på varje trigger under 15-sekunders lease.
4. Återuppta service worker.
5. Verifiera högst två dispatchförsök.
6. Efter två uteblivna callbackar ska state vara `RECOVERING`, inte `ASSESSING`.

## D. Mjölnar state integrity

För en nivå 7 continuation utan lokal action dispatch:

- Destruktivitet: 7/10;
- Hjalmar: `READ_REQUIRED` eller passande kontrollstatus;
- Mjölnar state: `READ_REQUIRED`/`CANDIDATE_DETECTED`;
- Action/Target/Dispatch får vara tomma;
- `VERIFIED_EFFECT` får inte visas.

Kör därefter en registrerad test-D1-handler med readback. Först efter matchande readback får `VERIFIED_EFFECT` visas.

## E. Audit coalescing

Provocera två identiska events inom fem sekunder.

PASS:

- en loggrad;
- `repeatCount` ökar;
- loggen förblir bounded.

## F. Verkliga stopp

Verifiera att följande fortfarande stoppar:

- direkt **Stoppa addon**;
- direkt **Pausa addon**;
- auth/CAPTCHA;
- credential/secret request;
- explicit irreversibel eller unknown-blast-radius destruction;
- nivå 10.

Nivå 1–9 och Workbench/owner-fencing ska inte bli human pause utan separat nivå-10-evidens.

## G. Soak

Kör minst 30 minuter med:

- panel öppen/stängd;
- targettab aktiv/inaktiv;
- service-worker suspension/wakeup;
- minst tre normala continuation turns.

PASS:

- inga revisionstorms;
- inga duplicate prompts;
- inga identiska deterministic recovery-loopar;
- korrekt wait/background-state;
- revisioner korrelerar med faktiska stateändringar.

## Evidence packet

Spara:

- appversion;
- exporterad state före/efter;
- initial/slutlig revision;
- auditutdrag med repeatCount;
- turn id;
- prompt acknowledgement;
- Mjölnar state före/efter dispatch/readback;
- eventuella blockerare.

Maska cookies, tokens, credentials och privat innehåll.

## Claim boundary

Lokal Node-PASS ersätter inte denna acceptance. Browser-runtime PASS får anges först när ovanstående är faktiskt kört och evidensen kan läsas tillbaka.
