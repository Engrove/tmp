# Root cause och korrigering — v0.7.5

## Beslutad sessionsinvariant

EIC Autonom Agent får aldrig skapa, öppna eller navigera till en ny ChatGPT-flik eller session.

Både **Starta Ny Session** och **Starta systematisk granskning** förutsätter att operatören har:

1. öppnat rätt ChatGPT-session i Chrome;
2. väntat tills sessionen är redo;
3. kopplat fliken till addonen;
4. valt fliken som mål;
5. säkerställt att ingen generation eller bakgrundsuppgift pågår.

Addonen verifierar målflikens stabilitet och levererar därefter prompten i just den valda fliken. Den skapar inte en alternativ flik när förberedelsen saknas.

## Rotorsak: automatisk nyfliksväg

v0.7.4 hade två mekanismer som bröt invarianten:

- `createAndLinkNewSessionTab()` kunde återanvända en tom aktiv flik eller anropa `chrome.tabs.create`.
- båda startkommandona skickade eller defaultade `createNewTab=true`.

Det gjorde att en operatörsförberedd EIC-session kunde kringgås och att prompten hamnade i en ny, obootstrappad ChatGPT-session.

## Korrigering

- `createAndLinkNewSessionTab()` är borttagen.
- `chrome.tabs.create` förekommer inte i runtimekoden.
- `createNewTab` finns inte i background- eller sidepanelkommandon.
- båda startlägena använder `preparePreparedSessionRunUnlocked()`.
- den valda fliken måste redan vara kopplad.
- `requireEmptyConversation` är `false`; det är operatören, inte addonen, som avgör den semantiska förberedelsen.
- readiness-, busy-, receipt- och exakt-engångsgrindarna är bevarade.

## Buggranskning B1–B12

### B1 — verifierad och rättad

Postklassificeringscapen kunde sänka nivå 6–9 till 5 när texten innehöll ett generiskt Workbench-ord. Capen är borttagen. `workbenchCapped` sätts endast när Workbench-familjen faktiskt klassificerade en ren Workbench-effekt.

### B2 — verifierad och rättad

`auditEventPlacement()` använde rå text och första `EIC_TURN`, medan `parseTargetResult()` använde kod-/citatstrippad bounded tail. `stripProtocolNoise()` och `locateTargetTrailer()` är nu gemensam canonical yta.

### B3 — verifierad och rättad

Stängda blockerare kunde ensamma överskrida 32 kB och saknade krympningsväg. Kompakteringen tar nu bort äldsta stängda blockerare före mindre viktiga resonemangslistor. Öppna blockerare tappas inte tyst.

### B4 — verifierad och rättad

Queryparametrar på ChatGPT-roten ingick i conversation identity. Roten normaliseras nu till `hostname:/`, så `?model=...` och `?temporary-chat=true` kan promoveras till exakt `/c/<id>`.

### B5 — verifierad och rättad

Submit-preflight skickade inte `latestMessageRole` till `detectForegroundSignals()`. Rollen skickas nu explicit.

### B6 — verifierad och rättad

För små budgetar kunde projection + response + mandate överskrida `variableChars`. Mandate begränsas nu till kvarvarande budget.

### B7 — verifierad och rättad

Auditeventet parsades ur fulltext men strippades först efter head/tail-komprimering. Strippning sker nu före komprimering. Malformed protokollregion tas bort fram till den riktiga trailern.

### B8 — verifierad och rättad

`DELEGATED_PENDING_DISPATCH` saknades i Mjölnars dubblettgrind och ingår nu.

### B9 — verifierad och rättad

Map-dedupe bevarade första nyckelpositionen men senaste värdet. Resultatet sorteras nu efter `turn` och `at` före retention/slice.

### B10 — relevant designrisk och rättad

Promptmallen förifyllde exakt det starka tillståndet `READBACK_VERIFIED`. Den visar nu ett villkorat placeholdervärde och uttrycker svaga tillstånd explicit.

### B11 — verifierad klarhetsbugg

Ternären hade identiska grenar. Den är ersatt med explicit `STATES.HARD_BLOCKED`. Ingen spekulativ ändring till `HUMAN_REQUIRED` har gjorts; befintlig auth/CAPTCHA-policy bevaras.

### B12 — verifierad och rättad

Andra trimningsloopen kunde inte gå under det mjuka golvet. Den är nu en emergency pass som får ta bort optional lists under golvet för att respektera ett hårt prompttak.

## Bevisgräns

Automatiska tester och validator bevisar källkontrakt, parserlogik, budget, state-övergångar och att runtimekoden saknar nyfliksvägen.

De bevisar inte att en installerad Chrome-build beter sig korrekt mot en framtida ChatGPT-DOM. `docs/DESKTOP_CHROME_ACCEPTANCE_V0_7_5.md` beskriver den manuella acceptans som fortfarande måste köras i verklig Chrome.
