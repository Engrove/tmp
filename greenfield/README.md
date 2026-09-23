# EIC Autonom Agent Greenfield 1.7.6

Chrome MV3-tillägg för EIC GPT i vanligt Chat-läge.

Version 1.7.6 lägger till **owner-state/current_focus resume safety** i alla Greenfield-genererade A2A-prompter. `project.current_focus` är nu uttryckligen `STEERING_POINTER_NOT_FACT_OWNER`: färsk subject-project state läses/reconcileras före första bounded work package, nyare exakt owner-evidence vinner konflikt, completed effects får inte replayas från stale focus och focus skrivs bara när steering/restart-state faktiskt har ändrats. 1.7.5:s autonoma lagringsretention och 1.7.4:s ordered cyclic queue är oförändrat bevarade.

## Viktigaste ändringarna

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

Börja med [START_HERE_SV.md](START_HERE_SV.md). För uppgradering från 1.7.5, se [UPPDATERA_TILL_1_7_6.md](UPPDATERA_TILL_1_7_6.md).

| Underlag | Innehåll |
|---|---|
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
node --test tests/v176-owner-state-current-focus.test.mjs
node --test tests/v175-storage-retention.test.mjs
node --test tests/v174-ordered-loop-queue.test.mjs
node --test tests/v173-language-model-safety.test.mjs
node --test tests/v170-model-compatibility.test.mjs
```

Ingen ny produktionsdependency har lagts till i 1.7.6. Chrome-behörigheten `unlimitedStorage` har lagts till för autonom retention.
