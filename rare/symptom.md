# G0 – symptom och klass

**Symptom.** Efter "Starta arbetskö" står processen i `SENDING`, initieringen (`SESSION_INITIALIZATION`, "Reply only READY") skickas aldrig (`dispatch null`, `sendAttempts 0`). Panelen: "1 worker hålls av skyddet", "Flera möjliga tänkenivåkontroller hittades; inget automatiskt val", spärr `THINKING_CONTROL_AMBIGUOUS`. Samtidigt visar kompositorn "Extra hög" och den vanliga modellkontrollen är godkänd (`UI_MODEL_COMPATIBLE`), men `highestEffortVerified false`. [E302, E314]

**Frekvens.** 2/2 observerade starter, två olika workers i två olika Chrome-fönster, med identisk kedja `UNAVAILABLE/PREFLIGHT` → `AMBIGUOUS/SELECT_MAXIMUM` inom 31–38 s. [E303] I riggen med fältets DOM: 10/10. [E307]

**Klass: BOH (Bohrbug).** Felet är deterministiskt under kända villkor: samma meny ger samma utfall varje gång, utan beroende av timing, last eller drifttid. Ingen observationseffekt: diagnostiken ändrar inte utfallet. Spärren är dessutom permanent, eftersom adaptern återanvänder sitt felresultat så länge ytan är oförändrad. [E303, E307, E310]

Enligt G0 räcker vanlig felsökning för en BOH. Bevisen i G5-format redovisas ändå, eftersom metodiken begärdes uttryckligen.
