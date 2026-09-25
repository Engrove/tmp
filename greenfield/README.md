# EIC Autonom Agent Greenfield 1.8.5

Chrome MV3-tillägg för EIC GPT i vanligt Chat-läge.

Version 1.8.5 gör sparade uppdrag administrerbara. Ett uppdrags identitet är GF-ID:t på första raden (”Projekt: … - Gf: GF-001.”). Samma GF-ID uppdaterar det befintliga uppdraget på plats, och köplatser och kö-set hämtar alltid uppdragets aktuella text. Taket är höjt från 24 till 64, och inget raderas längre automatiskt. ChatGPT:s notis ”Våra system bearbetar den här förfrågan lite till …” kan aldrig fångas som svar.

Version 1.8.4 rättar mönstret för fältet Modellgolv i panelen. Chrome avvisade det som ogiltigt reguljärt uttryck och loggade ett fel i tilläggets felsida. Fältet godtog då vad som helst, men bakgrundens kontroll stoppade fortfarande ogiltiga värden.

Version 1.8.3 gör att Greenfield inte längre fryser tillsammans med en flik som hänger. Alla anrop till sidan har tidsgräns. En vit ruta, ett halvladdat ChatGPT-gränssnitt eller en sida som inte svarar återhämtas i steg: F5, Ctrl-F5, samma URL, ny flik med samma konversation, och först därefter ny chatt. Ett Daybreak-spärrkort från ChatGPT gör att samma GFW fortsätter i en ny chatt. Upprepas det pausas GFW:n i 2, 6 eller 24 h och kön går vidare. Den blir aldrig BLOCKED.

Version 1.8.2 stoppar fångst av halvfärdiga svar. I den live-körda 1.8.0-sessionen fångades 45 av 78 turer som några tecken av ett JSON-svar som fortfarande skrevs, och Greenfield skickade då nästa prompt mitt i svaret. Nu godkänns ett JSON-objekt som öppnats men inte stängts aldrig som färdigt svar. Varje process har dessutom ett varaktigt observationsspår som följer med vid köbyte och syns i diagnostikexporten (`responseObservation`), även när Audit är avslaget.

Version 1.8.1 ger varje köplats en **schemaläggare**: veckofönster i lokal tid och en engångspaus till en tidpunkt. En plats körs bara när schemat tillåter det. En pågående tur avbryts aldrig. Stänger fönstret under en tur parkeras platsen efter svaret och nästa plats startar. Finns ingen annan körbar plats väntar kön i `QUEUE_WAIT` tills nästa plats öppnar. EIC-AI:n kan ändra aktuell plats schema med `runtimeControl` `SET_SCHEDULE`, och FULL-prompten påbjuder schemaläggaren för tidsberoende arbete. Ett sparat kö-set kan nu skrivas över med aktiv kö (**Uppdatera valt**).

Version 1.8.0 bygger ut Greenfields prompt med **EIC Learning & Continuity Control**. Varje FULL-prompt bär ett fristående kontrakt som definierar AIK, Self-learn, Kaizen, Operator Learning, Memory och owner-ytor, deras regler och en routingtabell. Kontraktet utgår från att AI:n inte har någon inbyggd EIC-kunskap och att factual owner alltid vinner. Varje prompt, även COMPACT, bär en dynamisk kapsel `control.learningControl`. I kapseln anger Greenfield deterministiskt projektscope, arbetsblock, detekterade keypoints och vilka kontroller som är obligatoriska just nu. AI:n rapporterar utfallet i det nya valfria svarsfältet `learningControl`. En obligatorisk kontroll som inte rapporterades förs över till nästa prompt. Greenfield hämtar eller skriver inget i AIK/Kaizen själv; kontrollerna körs av EIC-sessionen.

Version 1.7.9 ändrar vad som händer när ett svar aldrig blir klart. Greenfield laddar om samma chatt efter 30, 60 och 90 min. Efter 120 min utan färdigt svar gör en köstyrd körning nu ett fullständigt köbyte: chatten överges och köplatsen parkeras med sin ofärdiga kvant (den obesvarade turen räknas inte). Nästa körbara köplats i listordning startar. När den parkerade GFW:n kommer tillbaka får den veta att föregående prompt saknade färdigt svar och att owner-state ska läsas om. Finns ingen annan körbar plats byter samma GFW till en ny chatt som tidigare. Overlayen i ChatGPT-fliken visar nu också GFW-id, köplats, prioritet, interaktion/kvant, en nedräkning till köbytet och nästa omladdning, tur, session, promptprofil, nästa GFW i kön och eventuell spärr.

Version 1.7.8 rättar FULL/COMPACT-promptprofilen från 1.7.7. En omladdning av samma ChatGPT-konversation räknas inte längre som sessionsgräns. Det gäller både Greenfields egen stale-ladder-F5/Ctrl-F5 efter 30/60/90 min och en manuell F5. I den live-körda 1.7.7-sessionen gjorde Greenfields egen 30-minuters-F5 att tur 2 skickades som FULL. Modellens kontext ligger i konversationen (`/c/<id>`) och påverkas inte av en omladdning. FULL skickas vid ny chatt, byte av konversation, rotation, köaktivering, nytt fönster eller ny process, var tionde prompt och på AI-begäran.

Version 1.7.7 gör **AI-begärd runtime-control** till en validerad, avgränsad kontrollpunkt. När EIC-AI:n svarar `status=DONE` eller `sessionAction=STOP_PROCESS` (eller strukturerat `runtimeControl` `COMPLETE_MISSION`) avslutar Greenfield nu faktiskt den logiska GFW:n och pensionerar alla dess köplatser. I 1.7.6 kunde Hjalmars lokala `CONTINUE` tyst köra över den terminala signalen. AI:n kan också begära ändrad kvant (`SET_QUANTUM`) och prioritet (`SET_PRIORITY`) för aktuell köplats. Greenfield validerar target, gränser och operatörsföreträde och återrapporterar kvitton i nästa prompt. Följdprompter i samma ChatGPT-konversation kan skickas som COMPACT. FULL-prompten skickas vid sessionsgräns (ny chatt, rotation, köaktivering, konversationsbyte) och var tionde prompt.

## Nytt i 1.8.5

- **Sparade uppdrag under Uppdragskö:** välj, **Redigera**, **Spara ändring** (samma id), **Spara som nytt** och **Ta bort** med bekräftelse. Räknaren visar `N / 64`, markerar fullt valv och anger antal GF-ID med dubbletter.
- **Import och export:** klistra in texter med rubriker `### GF-001`, eller en exporterad JSON-fil. **Förhandsgranska** visar ny, ändras och oförändrad samt dubbletter och ignorerade rader innan något skrivs. Varje post läses tillbaka ur bokmärkesvalvet. **Exportera alla** ger en JSON-fil som kan importeras igen.
- **Städa sparade uppdrag:** en lista med kryssrutor där äldre dubbletter och uppdrag utan GF-ID är märkta. Inget är förvalt. Köreferenser till en borttagen dubblett flyttas till det nyare uppdraget.
- **Referenser i stället för kopior:** köplatser och kö-set hämtar den sparade textens aktuella version när ett uppdrag läggs i kön, när ett set sparas eller laddas och när en köplats aktiveras, även en parkerad. Lagrade kö-set skrivs om direkt vid ändring. En pågående process byter text först vid nästa aktivering. Köplatser utan sparat uppdrag, till exempel EIC-delegerade, berörs aldrig.
- **Tak 64, ingen tyst radering:** ett nytt uppdrag i ett fullt valv nekas med ett synligt fel. **Spara aktuellt uppdrag** har en egen statusrad.
- **ChatGPT:s bearbetningsnotis:** ”Våra system bearbetar den här förfrågan …” räknas som statusrad och blir aldrig assistenttext, även om ChatGPT skulle lägga den i ett assistentmeddelande.

## Nytt i 1.8.4

- **Modellgolv:** `pattern` är giltigt i Chromes v-läge och godtar samma syntax som bakgrundens kontroll. Felet ”Pattern attribute value GPT[- ]… is not a valid regular expression” försvinner.

## Nytt i 1.8.3

- **Tidsgränser** på alla anrop till sidan, så att en hängd flik inte fryser processen.
- **Flikhälsa och återhämtningsstege:** sidan svarar inte, sidan ritas inte, inmatningsfältet eller tråden saknas → F5 → Ctrl-F5 → samma URL → ny flik → ny chatt. Stegen har takt, budget och tar aldrig åtgärd mitt i ett utskick.
- **Daybreak:** rotation till ny chatt, och vid upprepning paus 2 h → 6 h → 24 h. Aldrig BLOCKED.
- Se [TAB_HEALTH_DAYBREAK_V1_8_3.md](docs/TAB_HEALTH_DAYBREAK_V1_8_3.md).

## Nytt i 1.8.2

- **Ingen fångst av oavslutad JSON.** Detta gäller ledande objekt, objekt efter bilagekort och en avslutande `{`. Greenfield väntar vidare, och 120-minutersstegen är gränsen.
- **Observationsspår.** `process.responseObservationTrace` visar varför ett svar hölls eller godkändes, utan svarstext. Spåret följer med vid köbyte och indexeras i diagnostikexporten.
- Se [RESPONSE_OBSERVATION_V1_8_2.md](docs/RESPONSE_OBSERVATION_V1_8_2.md).

## Nytt i 1.8.1

- **Schema per köplats.** Högst 7 veckofönster (`days` 1–7, `HH:MM`, över midnatt tillåtet, `24:00` = dygnets slut) plus paus-till (högst 30 dagar). Platser utanför sitt schema hoppas över.
- **Pågående tur, sedan köbyte.** Parkering sker efter svaret med bevarad kvant (`SCHEDULE_WINDOW_CLOSED`/`SCHEDULE_PAUSED`). En spärr före utskick stoppar prompter som aldrig skickats.
- **`QUEUE_WAIT`.** Ny terminal fas när ingen plats är körbar. Kapaciteten släpps och väckarlarmet tar nästa plats.
- **AI `SET_SCHEDULE`.** Strikt validerad, operatörsföreträde, kvitton. Påbjuds i FULL-prompten (`control.workQueue.scheduleRule`). `control.workQueue.schedule` finns i varje prompt.
- **Kö-set.** Fönster sparas i set, och **Uppdatera valt** skriver över valt set med aktiv kö.
- Se [QUEUE_SCHEDULER_V1_8_1.md](docs/QUEUE_SCHEDULER_V1_8_1.md).

## Nytt i 1.8.0

- **Lager A – kontrakt i varje FULL-prompt.** `responseContract.learningControlContract` innehåller baseline (`You have no built-in knowledge of EIC.`), `THE FACTUAL OWNER WINS` och varje yta med *is / usedFor / isNot*. Där finns också AIK discovery och continuity check, Self-learn-klassning, Kaizen-keypoints, Operator Learning, routing, 3M, origin och stående triggers.
- **Lager B – dynamisk kapsel i varje prompt.** `control.learningControl` innehåller `project.aikScope` (`project:<id>` ur `Projekt: <id> - … - Gf: <GF-id>`), `workBlockId`, keypoints med trigger och obligationer (`REQUIRED`, `FRESH_RESULT_REUSABLE`, `REQUIRED_AT_DECLARED_KEYPOINT` …), plus `carriedOverObligations` och `previousResult`.
- **Deterministiska keypoints.** De utlöses av sessionsgräns och ny kvant, föregående blockering, stall eller okänd effekt, blockerare i två svar i följd, operatörsinstruktion och kvantens sista interaktion.
- **Lager C – resultat.** Det valfria svarsfältet `learningControl` normaliseras till en sluten, avgränsad form. Ett felaktigt värde påverkar aldrig svarets status.
- **Ingen prefetch, inga nya effekter.** Greenfield läser och skriver inte AIK, Kaizen eller Operator Learning.
- Se [LEARNING_CONTROL_V1_8_0.md](docs/LEARNING_CONTROL_V1_8_0.md).

## Nytt i 1.7.7

- **Terminal AI-signal verkställs.** `DONE`/`STOP_PROCESS` normaliseras till `COMPLETE_MISSION` och går genom samma DONE-commit och logiska retirement av alla dubblettplatser med samma `savedMissionId`. Andra GFW:er påverkas inte.
- **`runtimeControl` i svarskontraktet.** Target (`runId`, `turn`, `queueId`, `itemId`, `savedMissionId`) publiceras i varje prompt och måste kopieras exakt. Stale eller fel target ger `STALE` och ingen effekt. Ett felaktigt target tillsammans med `DONE` blockerar i stället för att pensionera.
- **Kvant och prioritet.** `SET_QUANTUM` tar heltal 1..15 och gäller från platsens nästa kvant. `SET_PRIORITY` tar `LOW|NORMAL|HIGH|URGENT`, aldrig över operatörens tilldelade prioritet för platsen.
- **Operatören vinner.** Köändringar som operatören gör efter att prompten skickades avvisar äldre AI-begäran (`OPERATOR_PRECEDENCE`). En väntande operatörsinstruktion stoppar AI-terminal. Panelen skickar bara det fält operatören ändrade.
- **Kvitton.** `APPLIED`, `ALREADY_APPLIED`, `REJECTED`, `STALE` och `INVALID` visas för AI:n i `control.runtimeControl.lastReceipts`.
- **FULL/COMPACT-prompter.** `promptProfile` visar profilen. COMPACT används bara med positiv konversationskontinuitet och uppgraderas till FULL före utskick om konversationen bytts (sedan 1.7.8 inte vid omladdning av samma konversation).
- **Självläkning.** Om kö-retirement efter DONE inte kunde skrivas görs den om innan kön väljer nästa plats.
- **`MISSION_RESTORE`** accepteras nu som A2A-meddelandetyp i köns återställningsväg.

## Bevarat från 1.7.6


- **`current_focus` är steering pointer, inte factual owner.** Nyare exakt owner-evidence styr alltid sin faktadomän.
- **Fresh owner-state före bounded work.** Project-bound continuation måste läsa/reconcile färsk subject-project state och `current_focus` före första arbetspaketet.
- **Material-delta-only writes.** `current_focus` får bara uppdateras när restart/lead-state materiellt ändrats; write är inte komplett utan owner readback.
- **Ingen stale replay.** Completed objectives/effects får inte köras igen därför att en steering pointer är gammal.
- **Scoped metadata failure.** Om focus-write saknas bevaras restart pointer via korrekt durable owner/chronology-route, metadatafelet routas till sin owner och unrelated safe work fortsätter utan blind retry.
- **Effect-owner revalidation.** Exakt effect target/owner ska revalideras före material effect.
- **Handoff-safe restart.** Mission state persisteras före pause/yield/block/done/handoff och focus ändras bara vid material restart delta.
- **Ingen 90 %-dispatchspärr.** Lagringsprocenten stoppar inte längre promptutskick.
- **Rolling checkpoint retention.** Efter verifierad checkpoint-publicering behålls primärvärdet plus en checksummad återställningsslot; den äldre alternerande slotten tas bort automatiskt.
- **Proaktiv high-water-städning.** Vid 80 % körs retention mot ett mål på 70 %.
- **Äldsta obundna workers först.** Om checkpointkompaktering inte räcker raderas hela process+queue-bundles för de äldsta workers som inte längre har en live `storage.session`-binding.
- **Aktiva workers skyddas.** En worker som är live-bunden kontrolleras igen precis före radering och lämnas orörd.
- **Kortare avslutshistorik.** Uppdragsköernas historik begränsas till 30 avslutade slots i stället för 100.
- **Kvotbuffert.** `unlimitedStorage` läggs till för att undvika att Chromes nominella 10 MiB-gräns hindrar en pågående kompaktering.
- **Driftstatus visar auto-retention.** Panelen visar procent och markerar lagringen som automatisk.
- **1.7.4-funktionerna bevaras.** Ordered cyclic queue, per-slot quantum, duplicate-GFW continuity och mixed-language model safety är kvar.

## Bevarat från 1.7.4

- **Strikt listordning.** Nästa körbara köplats väljs efter explicit position och kön wrappar cykliskt efter sista platsen; köplats-prioritet får inte längre omordna den inre worker-kön.
- **Riktig per-plats-kvant.** `maxInteractions` följs för den aktiva köplatsen. Tidig yield, pause eller blockerare bevarar ofärdig kvantprogress; först full kvant nollställer platsens räknare inför nästa varv.
- **Samma GFW flera gånger.** En sparad GFW kan läggas till flera gånger med separata `itemId`, positioner, prioriteter och kvanta. `savedMissionId` binder den gemensamma logiska missionens continuation.
- **Logisk stop/pause/block.** PAUSE/BACKGROUND_SLEEP pausar alla dubblettplatser av samma GFW och låter annan runnable köplats fortsätta; BLOCKED delar cooldown; DONE/STOP_PROCESS tar bort alla dubblettplatser för den avslutade logiska GFW:n.
- **Prioritetens ansvar är tydligt.** Per-plats-prioritet används när den aktiva platsen konkurrerar i den profilglobala kapacitetsschedulern, inte för att hoppa i den lokala listordningen.
- **Queue-set bevarar dubbletter.** Samma GFW kan finnas flera gånger i ett sparat set med olika ordning/prioritet/kvant.
- **A2A beskriver kökontraktet för EIC.** `ORDERED_CYCLIC_SLOTS`, kvantregeln, duplicate continuity och queue-local pause semantics annonseras i varje queue-managed envelope.
- **EIC ser sin faktiska kvant.** Varje queue-prompt innehåller bland annat `operatorDisplay`, t.ex. `Hög · 1 interaktioner/kvant · 0/1 slutförda i kvanten`, samt engelskt `planningHint`, återstående interaktioner och final-quantum-flagga.
- **Roundtrip-telemetri.** Prompten exponerar ungefärlig föregående response-roundtrip och, när slotten återkommer, loop-roundtrip för exakt samma köplats.
- **Full process-status på begäran.** EIC kan returnera `greenfieldStatusRequest=FULL_NEXT_PROMPT`; nästa prompt för samma logiska GFW får ett bounded `eic.greenfield.process-status.v1`-objekt utan prompt-/responsekroppar, hidden reasoning eller credentials.
- **BACKGROUND_SLEEP är inte DONE.** `CONTINUE + BACKGROUND_SLEEP`, även på sista interaktionen i kvanten, parkerar missionen och får inte placera den i `Klart/avslutade`; endast `DONE`/`STOP_PROCESS` är terminalt.
- **Mixed-language model safety bevaras.** Composer-first reasoning evidence, `nåla fast`/English Fast collision guard, finsk bounded vocabulary och English internal control med `en/sv/fi` evidence kvarstår från 1.7.3.

v1.7.3:s mixed-language model safety, v1.7.2:s multi-turn-liveness, v1.7.1:s dispatch-reconciliation och v1.7.0:s semantiska modellgolv bevaras.

Börja med [START_HERE_SV.md](START_HERE_SV.md). För uppgradering från 1.8.4, se [UPPDATERA_TILL_1_8_5.md](UPPDATERA_TILL_1_8_5.md); från äldre versioner, se även [UPPDATERA_TILL_1_8_4.md](UPPDATERA_TILL_1_8_4.md), [UPPDATERA_TILL_1_8_3.md](UPPDATERA_TILL_1_8_3.md), [UPPDATERA_TILL_1_8_2.md](UPPDATERA_TILL_1_8_2.md), [UPPDATERA_TILL_1_8_1.md](UPPDATERA_TILL_1_8_1.md), [UPPDATERA_TILL_1_8_0.md](UPPDATERA_TILL_1_8_0.md), [UPPDATERA_TILL_1_7_9.md](UPPDATERA_TILL_1_7_9.md), [UPPDATERA_TILL_1_7_8.md](UPPDATERA_TILL_1_7_8.md) och [UPPDATERA_TILL_1_7_7.md](UPPDATERA_TILL_1_7_7.md).

| Underlag | Innehåll |
|---|---|
| [TAB_HEALTH_DAYBREAK_V1_8_3.md](docs/TAB_HEALTH_DAYBREAK_V1_8_3.md) | Tidsgränser, flikhälsa, återhämtningsstege, Daybreak-rotation och paus |
| [RESPONSE_OBSERVATION_V1_8_2.md](docs/RESPONSE_OBSERVATION_V1_8_2.md) | Fynd i live-export, spärr mot oavslutad JSON, observationsspår |
| [QUEUE_SCHEDULER_V1_8_1.md](docs/QUEUE_SCHEDULER_V1_8_1.md) | Schema per köplats, `QUEUE_WAIT`, AI `SET_SCHEDULE`, kö-set-uppdatering |
| [LEARNING_CONTROL_V1_8_0.md](docs/LEARNING_CONTROL_V1_8_0.md) | EIC Learning & Continuity Control: tre lager, keypoints, obligationer, risker |
| [RUNTIME_CONTROL_V1_7_7.md](docs/RUNTIME_CONTROL_V1_7_7.md) | AI runtime-control, riskanalys, FULL/COMPACT-promptprofil |
| [OWNER_STATE_CURRENT_FOCUS_V1_7_6.md](docs/OWNER_STATE_CURRENT_FOCUS_V1_7_6.md) | Owner-state/current_focus restart- och replay-kontrakt |
| [STORAGE_RETENTION_V1_7_5.md](docs/STORAGE_RETENTION_V1_7_5.md) | Autonom high-water-retention och checkpointkompaktering |
| [ORDERED_LOOP_QUEUE_V1_7_4.md](docs/ORDERED_LOOP_QUEUE_V1_7_4.md) | Ordered cyclic slots, quantum continuity och duplicate-GFW semantics |
| [MODEL_LANGUAGE_ROBUSTNESS_V1_7_3.md](docs/MODEL_LANGUAGE_ROBUSTNESS_V1_7_3.md) | Root cause, språk-/evidencekontrakt och acceptance fixture |
| [MULTITURN_LIVENESS_V1_7_2.md](docs/MULTITURN_LIVENESS_V1_7_2.md) | Bevarat flerturns-kontrakt |
| [MODEL_COMPATIBILITY_V1_7_0.md](docs/MODEL_COMPATIBILITY_V1_7_0.md) | Bevarat modellgolv/reasoningkontrakt |
| [RELEASE_NOTES.md](docs/RELEASE_NOTES.md) | Versionshistorik |
| [BUILD_VERIFICATION.json](BUILD_VERIFICATION.json) | Genomförda kontroller och verifieringsgränser |
| [INTEGRITY.json](INTEGRITY.json) | SHA-256 för paketfilerna |

## Testa koden

```sh
npm test
node --test tests/v185-saved-missions.test.mjs
NODE_PATH="$(npm root -g)" node tools/verify-saved-mission-admin.mjs   # kräver Playwright + Chromium
NODE_PATH="$(npm root -g)" node tools/verify-processing-notice.mjs   # kräver Playwright + Chromium
node --test tests/v184-pattern-attributes.test.mjs
NODE_PATH="$(npm root -g)" node tools/verify-sidepanel-patterns.mjs   # kräver Playwright + Chromium
node --test tests/v183-tab-health-daybreak.test.mjs
NODE_PATH="$(npm root -g)" node tools/verify-content-health.mjs   # kräver Playwright + Chromium
node --test tests/v182-response-observation.test.mjs
node --test tests/v181-queue-schedule.test.mjs
node --test tests/v180-learning-control.test.mjs
node --test tests/v179-stale-rotation-overlay.test.mjs
node --test tests/v178-prompt-continuity.test.mjs
node --test tests/v177-runtime-control.test.mjs tests/v177-runtime-control-e2e.test.mjs
node --test tests/v176-owner-state-current-focus.test.mjs
node --test tests/v175-storage-retention.test.mjs
node --test tests/v174-ordered-loop-queue.test.mjs
node --test tests/v173-language-model-safety.test.mjs
node --test tests/v170-model-compatibility.test.mjs
```

Ingen ny produktionsdependency och ingen ny Chrome-behörighet har lagts till i 1.7.7–1.8.5.
