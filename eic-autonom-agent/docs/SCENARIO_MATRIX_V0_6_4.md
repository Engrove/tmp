# Scenario Matrix — EIC Autonom Agent v0.6.4

| # | Scenario | Förväntat v0.6.4-beteende | Testtäckning |
|---|---|---|---|
| 1 | Nano-input skulle överskrida contextfönstret | Prompten krymps före dispatch; `withinBudget: true` | `v064-defect-regression` D1 |
| 2 | Chrome kastar ändå `QuotaExceededError` | Bounded krympstege 1,0 → 0,6 → 0,35, därefter verkligt fel | `v064-defect-regression` D1-ladder |
| 3 | Ingen känd contextWindow | Fallbackfönster; obudgeterad väg oförändrad | `v064-defect-regression` D1-legacy |
| 4 | Continuity växer med dubbletter | Merge + åldersgallring, `compactionGeneration` ökar | `v064-defect-regression` D2 |
| 5 | Arbetsenhet innehåller ordet "verify" | Konkret åtgärd räknas som produktiv, inte audit | `v064-defect-regression` D3 |
| 6 | Svensk implementationsåtgärd | Ej `META_ONLY`; deterministisk progress = 1 | `v064-defect-regression` D4 |
| 7 | Ren metaåtgärd | Fortfarande `META_ONLY` och auditräknad | `v064-defect-regression` D4-meta |
| 8 | `STOP_META_LOOP` med konkret icke-upprepad åtgärd | Korrigering bifogas, arbetet behålls | `v063-revision-spin`, manuell acceptans A5 |
| 9 | `STOP_META_LOOP` med upprepad metaåtgärd | Omplanering ersätter som tidigare | `continuity-takeover` |
| 10 | Uttömd recovery-stege | Deterministisk rotation med cykelnummer | manuell acceptans A6 |
| 11 | Blockerare återasserteras | `lastAssertedTurn` uppdateras, förblir öppen | `v064-defect-regression` D6 |
| 12 | Blockerare tyst i sex turer | `open: false` + `STALE_NO_REASSERTION`, ingen resolution | `v064-defect-regression` D6 |
| 13 | Turn-bundet `EIC_NEXT` | Blir position med `target-eic-next-claim` | `v064-defect-regression` D7 |
| 14 | Ny session, composer under hydrering | Ingen leverans; stabilitetskravet ej uppfyllt | `v064-defect-regression` R5 |
| 15 | Ny session, sidan navigerar om under väntan | Stabilitetsräknaren nollställs | `v064-defect-regression` R5 |
| 16 | Ny session, startprompt kvitterad | Autonom dispatch fortsatt spärrad | `v064-defect-regression` R5-gate |
| 17 | Ny session, första svaret komplett | `INITIALIZED`, normal autonomi återupptas | `v064-defect-regression` R5-gate |
| 18 | Målsessionen tänker länge efter start | Ingen timeout; gaten väntar | `v064-defect-regression` R5-timeout |
| 19 | Run skapad före v0.6.4 | Ingen spärr | `v064-defect-regression` R5-legacy |
| 20 | Upprepad v8-migration | Byte-identisk, `changed: false` | `v064-defect-regression` D9 |
