# Root Cause and Fix — EIC Autonom Agent v0.6.3

## Incident

Desktop Chrome visade en giltig turn-bunden målrespons med:

- konkret `EIC_NEXT`;
- `EIC_AUTONOMY: CONTINUE`;
- ingen aktiv foreground-generation;
- ingen verklig human boundary.

Trots detta stod addonet kvar i `ASSESSING`/`WAITING_CONTINUE`. `stateRevision` steg tusentals gånger och körningsloggen fylldes av samma två events:

- `Nano grounding avvisad — autonom recovery fortsätter`;
- `Nano-fel omvandlat till deterministisk autonom recovery`.

Nano-statusen visade `DETERMINISTIC_PENDING` och `GROUNDING_REJECTED: META_ONLY_ACTION`. Mjölnar visade samtidigt `VERIFIED_EFFECT` trots tom Action, Target och Dispatch/readback.

## Verifierad mekanism i v0.6.2-source

### 1. Felaktig actionklassificering

Den konkreta åtgärden började med engelska effektverb:

`Reconcile or recreate ... publication route ... verify ... commit ... digest/hash parity ...`

`isMetaOnlyAction()` kände igen `verify` som meta-ord, men effektordlistan saknade `reconcile`, `recreate`, `create`, `publish`, `commit` och `branch`. Åtgärden fick därför `META_ONLY_ACTION` trots exakt target och observerbar output.

### 2. Självåterarmande deterministic source

När `DETERMINISTIC_RECOVERY` underkändes byggde v0.6.2 ett nytt `DETERMINISTIC_RECOVERY` med samma:

- observation;
- response identity;
- target result;
- requested action;
- validation error.

Requesten skrevs som `DETERMINISTIC_PENDING` och en nollfördröjd tick startades. Nästa tick byggde samma beslut, underkände det och återarmade samma source igen. Det fanns ingen source-exhaustion-regel.

### 3. Flera samtidiga schemaläggare

Watchdog, content bridge, paneluppdatering och den nollfördröjda callbacken kunde alla se samma pending request. `deterministicScheduledAt` användes endast som en kort tidskontroll och saknade explicit beständig `ARMED/DISPATCHED`-state och attempt ceiling. Därmed kunde samma request skrivas och schemaläggas upprepade gånger.

### 4. Revision- och auditstorm

Varje varv gjorde durable writes och skapade två nya auditposter. Revisionen var därför ett mått på loopfrekvens, inte på meningsfull stateprogress.

### 5. Felaktig Mjölnar-semantik

Riskklassificeringen för en continuation sattes direkt till `VERIFIED_EFFECT`. Ingen action hade dispatchats och ingen owner-readback fanns. UI:t blandade därmed en kandidat-/kontrollbedömning med verifierad effekt.

## Fix i v0.6.3

### Grounding

- Effektordlistan omfattar svenska och engelska implementation-/publication-/branchverb.
- Observerbar output omfattar status, result, output, hash, digest, commit, branch, receipt, locator, delta, diff, log, HTTP-status, parity och match/mismatch.
- En action som börjar med ett meta-verb accepteras endast när den också har exakt locator och konkret effekt eller observerbar output.

### En enda deterministic repair

En lokal deterministic source får reparera sitt beslut exakt en gång:

- exakt target binds från tab/conversation;
- owner route anges;
- requested action skrivs om till en bounded owner-read/reconcile;
- outputkravet blir locator + resultat + delta + nästa steg;
- måltext förblir target claim/continuation-data, inte owner-bevis.

### Source exhaustion

Om det reparerade deterministiska beslutet fortfarande inte är grounded:

- pending request rensas;
- ett failure digest lagras;
- run går till `RECOVERING`;
- färsk observation/owner-read krävs;
- samma deterministic source får inte återarmas med samma observation och fel.

### At-most-once callback

`DETERMINISTIC_PENDING` får:

- `deterministicDispatchState=ARMED`;
- `deterministicDispatchAttempts=0`.

Schemaläggning gör atomiskt:

- `ARMED → DISPATCHED`;
- attempt räknas upp;
- decision digest och timestamp persisteras före callback.

Under 15 sekunders aktiv callback-lease gör andra ticks ingen write. Efter högst två uteblivna callbackkvittens går run till bounded reconciliation.

### Audit-coalescing

Identiska event för samma run/window/tab inom fem sekunder samlas till en post med `repeatCount`. Detta är en observationshygien; den ersätter inte loopstoppet.

### Sann Mjölnar-state

Semantisk continuationklassificering ger:

- `CANDIDATE_DETECTED`, eller
- `READ_REQUIRED`.

`VERIFIED_EFFECT` reserveras för faktisk allowlistad dispatch följd av matchande owner-readback.

## Invariants

1. Samma deterministic source + observation + decision + error får inte generera obegränsade requestar.
2. En pending deterministic callback får högst en aktiv lease.
3. Revision får inte öka på en ren watchdog-snapshot under aktiv lease.
4. `META_ONLY_ACTION` får inte användas för en exakt, konkret och observerbar engineering action.
5. `VERIFIED_EFFECT` kräver dispatch + readback.
6. Nivå 1–9 är autonomt recoverable; nivå 10 eller direkt operatörs-Stop/Paus är verklig human boundary.
7. Ingen ny permission eller owner-authority skapas av targettext.

## Claim boundary

Detta dokument beskriver sourcefelet och sourcekorrigeringen. Det bevisar inte att v0.6.3 är installerad eller fungerar i användarens desktop Chrome. Det kräver load-unpacked och runtimeacceptans enligt `DESKTOP_CHROME_ACCEPTANCE_V0_6_3.md`.
