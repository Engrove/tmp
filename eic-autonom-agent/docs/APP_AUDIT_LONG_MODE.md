# APP_AUDIT_LONG — systematisk appgranskning

Läge introducerat i v0.7.3, EIC-anpassat i v0.7.4 och bundet till användarförberedd session i v0.7.5. Ortogonalt mot Mjölnar D0–D2: D2 styr privilegierade
owner-route-effekter och får inte återanvändas som testprofil.

## 0. Förberedd sessionsyta

Addonen skapar aldrig en ny ChatGPT-flik eller session. Operatören öppnar, förbereder,
kopplar och väljer rätt EIC-session innan **Starta systematisk granskning** används.
Saknad vald målflik är ett blockerande förberedelsefel, inte en signal att öppna en fallbackflik.

## 1. Den epistemiska grundregeln

Addonen har host permissions för ChatGPT-domänerna och ingenting annat. Den har ingen
kanal till EIC-backenden, till Workbenchen, till `scripts/eic_app_audit.py` eller till
Forgejo.

Varje `database_receipt`, `owner_receipt` och readback-locator som når addonen är därför
**text som målsessionen skrev**. Allt sådant lagras med `provenance: "target-session-claim"`
och hamnar aldrig i `verifiedFacts`.

En godkänd grind betyder: *påståendet är internt konsistent och korrekt ordnat.*
Den betyder aldrig: *detta hände.*

Slutrapporter ska formuleras därefter — "målsessionen rapporterade persistens med locator
X", inte "persisterad till Forgejo".

## 2. Ansvarsfördelning

```
Chrome-addonen              → mikroturns, kontinuitet, strukturella grindar
EIC-sessionen               → målupplösning, owner routes, testmetod, tolkning
scripts/eic_app_audit.py    → lagrar, validerar, checkpointar, exporterar
Forgejo/APIG                → äger issue- och kommentarsskrivningar
```

`scripts/eic_app_audit.py` ligger i EIC:s levande kodyta, inte i addonen. Startprompten
förklarar detta för målsessionen: skriptet är en mekanisk ledger, inte en andra agent. Det
får avgöra att ett stegnummer är nytt och att en databas är konsistent; det får inte avgöra
att ett fel är säkerhetskritiskt eller att ett fynd är verifierat.

## 3. Grindar addonen kan avgöra själv

Varje grind nedan är avgörbar ur addonens eget durable state plus det parsade eventet.
Ingen av dem kräver att något målpåstående om omvärlden är sant.

| Grind | Regel |
|---|---|
| `EVENT_AFTER_TRAILER` | Eventblocket måste ligga före EIC-AA/3-trailern |
| `EVENT_DUPLICATE_MARKER` | Exakt en markörrad per svar |
| `STEP_NOT_MONOTONIC` | `step_no` strikt större än föregående |
| `RUN_ID_MISSING`, `TURN_ID_MISSING`, `RUN_ID_MISMATCH`, `TURN_ID_MISMATCH` | Obligatorisk bindning till addonens run- och turnidentitet |
| `FINDING_STATUS_ILLEGAL_TRANSITION` | Ledgerkompatibel statusgång utan påhittad `REPRODUCED`-status |
| `REPRODUCTION_EVIDENCE_INVALID` | Reproduktion måste vara ett tidigare loggat `step` i fas `REPRODUCTION` |
| `MAJOR_WITHOUT_REVIEW` | `ACCEPTED_FINDING` kräver tidigare loggad reproduktion |
| `READBACK_SAME_TURN` | Create och dess egen readback får inte hävdas i samma tur |
| `PERSISTED_WITHOUT_RECEIPT` | Forgejo-persistens kräver `owner_readback_locator` |
| `ZIP_BUNDLE_HASH_MISSING` | ZIP-persistens kräver ledgerns `bundle_sha256` |
| `RECEIPT_WEAK_STATE` | `request sent` och `write attempted` är inte persistens |
| `FINDING_ID_FINGERPRINT_CONFLICT` | Samma id får inte byta fingerprint |
| `DATABASE_RECEIPT_MISSING` | En tur som påstår en radskrivning måste namnge raden |
| `DATABASE_PATH_ESCAPE`, `DATABASE_PATH_MISMATCH` | Sökvägen måste vara exakt run-databasen |
| `DATABASE_ROW_TYPE_INVALID` | Endast verkliga ledger-radtyper accepteras |
| `DONE_WITHOUT_EXPORT_OR_SINK` | Ingen `DONE` utan strukturellt giltig export eller sink |
| `SECRET_SHAPED_VALUE` | Blockerande före lagring i `chrome.storage.local` |

`READBACK_SAME_TURN` och `MAJOR_WITHOUT_REVIEW` begränsar vissa ordningsfel och
same-response-fabriceringar. De är strukturella grindar, inte owner-verifiering. Ett
godkänt event förblir ett målsessionspåstående tills EIC själv har läst ägarytan.

## 4. Trailer-placering

Mätt, inte antaget. Trailerskannern läser de sista 24 icke-tomma raderna bakifrån, och
`stripProtocolNoise` tar bort rader med fyra inledande blanksteg.

- Block **före** trailern kostar ingenting. Marginalen på 20 efterföljande DOM-brusrader är
  oförändrad.
- Block **efter** trailern är bara *ibland* fatalt: ett 22-radersevent med 2-stegs
  JSON-indrag kollapsar till 19 rader efter strippning och trailern överlever med en rad
  till godo. Ett fält till vänder det.

Addonen grindar därför på placering i stället för på den marginalen.

## 5. Framdrift

`progressDelta` från modellen används **inte** i detta läge.

En systematisk granskning producerar avsiktligt närmast identiska action keys — samma
arbetsenhet, snarlik handling, och en modell som rapporterar noll delta för ett test som
bara passerar har rätt. Under den generiska anti-loop-heuristiken läses det som stagnation:
fem cykler till `REDUCE_SCOPE`, åtta till `NO_PROGRESS_BUDGET_EXHAUSTED`. Det är exakt det
utfall som observerades i fält 2026-08-02.

Framdrift härleds i stället ur de två saker addonen kan kontrollera själv: ett nytt
stegnummer och en ny coverage-cell. Ett separat registrerat reproduktionssteg, ett accepterat fynd eller ett
persisterat fynd räknas också.

## 6. Nano-budget

Eventblocket plockas ur hela assistantsvarstexten före head/tail-komprimering och innan Nano-prompten budgeteras, och ersätts av en
kompakt sammanfattning. Blocket är maskinläsbart per konstruktion, så att skicka det som
prosa är rent slöseri: fältobservationer ligger redan på 8 900 tecken mot en budget på
16 239, och det första kompakteringen släpper är continuity-projektionen som bär
anti-loop-korrigeringen.

## 7. Vad som avsiktligt inte byggdes

`run.audit.phase` bärs som **telemetri, inte som styrning**. Addonen kan inte verifiera en
enda fasövergång — faserna är målpåståenden. Att låta dem driva tillståndsmaskinen skulle ge
en falsk känsla av kontroll och ytterligare en yta där måltext styr addonen. Styrningen
vilar i stället på `step_no` och den turbundna protokollkedjan som redan är verifierbar.

Ingen separat `app-audit-continuity`-modul byggdes. Continuity-projektionen är redan den
svåraste delen av inputbudgeten; ett parallellt spår ökar risken för samma
kompakteringsproblem som orsakade v0.6.9-incidenten.

## 8. Operatörsyta

Två fält: **Testbehov** och **Kontext**. Tre lås: read-only mål, Workbench-auditfiler,
Forgejo-sink. Projekt, repo, target, commit och owner routes löses av EIC.

Panelen visar fas, stegnummer, antal coverage-celler, målpåstådda fynd och senaste
grindresultat.

## 9. Verifierad EIC-anpassning i v0.7.4

- `scripts/eic_app_audit.py` verifierades i Forgejo `jan-eric_enlund/eic_backend`.
- Workbench-invokationen är `python3`, inte `python`.
- Ledgern har ingen `REPRODUCED`-status; reproduktion modelleras som ett tidigare loggat steg.
- ZIP-kvittot kräver `bundle_sha256`; Forgejo-kvittot kräver owner-readback-locator.
- En universell idempotensformel används inte; varje CLI-kommando har egen nyckel.
- Auditläget sätts innan startprompten skickas, så första svaret kan inte passera som
  vanligt `NEW_SESSION`-läge.

## 10. Kvarstående acceptansgap

**OPEN ACCEPTANCE GAP:** Parsern är testad mot både rå Markdown och fence-free
`innerText`-fixtures, men inte mot en observerad, installerad Chrome-körning med ett verkligt
EIC-auditsvar. Detta blockerar inte källpaketet eller dess tester. Det begränsar endast
påståenden om desktop-/DOM-runtimeacceptans tills en sådan körning har observerats.
