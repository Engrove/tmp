# Features — EIC Autonom Agent v0.6.4

v0.6.4 är en defektfix ovanpå v0.6.3. Ingen funktion är borttagen.

## Nytt

- **Nano input budget.** Beslutsprompten binds mot värdmodellens contextfönster före
  dispatch, med prioriterad sektionsallokering och konvergerande krympning.
- **Adaptiv quota-hantering.** `measureInputUsage()`-förmätning när den finns, och
  `QuotaExceededError` som bounded krympsignal i stället för körningsfel.
- **Semantisk continuity-kompaktering.** Dedupe och åldersgallring vid varje beslut;
  `compactionGeneration` rör sig nu på riktigt.
- **Budgetbunden projektion.** `projectContinuity({ maxChars })`.
- **Sann anti-loop-räkning.** Endast åtgärdssegmentet klassificeras; verifierad progress
  rankar över ordval; nya räknare `concreteActionCount` och `lastActionClass`.
- **Icke-destruktiv anti-loop-korrigering.** Korrigeringen bifogas konkret arbete i stället
  för att ersätta det.
- **Blockerarlivscykel.** Återassertion med `lastAssertedTurn` och explicit
  `STALE_NO_REASSERTION`-stängning utan resolutionspåstående.
- **Positionsavancemang.** Konkret `EIC_NEXT` blir arbetsenhet med provenance och fas.
- **Sessionsinitieringsgate.** "Starta Ny Session" spärrar autonom leverans tills
  sessionsytan är stabil, startprompten kvitterad och första svaret komplett.
- **Build-identitet i export.** `build-info.json` med per-fil-SHA och `packageDigest`
  bäddas in i varje export.

## Bevarat från v0.6.3

Deterministic source exhaustion, at-most-once callback, revisionstormskydd,
grounding repair, sann Mjölnar-state, EIC_DESTRUCTIVENESS/1, Max Autonomous Mode,
bakgrundsvänteläge utan TTL, engångsstartprompt med kvitto, v8-migrationskedjan.
