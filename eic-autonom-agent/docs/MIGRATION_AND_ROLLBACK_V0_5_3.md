# Migrering och rollback — v0.5.3

## Schema

| Objekt | v0.5.2 | v0.5.3 |
|---|---|---|
| Config | v5 | v6 |
| Runtime | v5 | v6 |
| Run | v5 | v6 |
| WindowContext | v3 | v4 |
| Export | v5 | v6 |
| Content bridge | 0.5.2 | 0.5.3 |

## Automatisk migrering

`migrateV5ToV6`:

- bevarar Nano- och targetmandat;
- bevarar continuity;
- bevarar manuella pause-states;
- stänger av `allowTargetAuthoredFallback`;
- cappar `recovery.attempts` till 40;
- cappar effect journal till 12;
- tar bort full prompt från historiska journalposter;
- lägger till deterministisk progress- och locatorstate;
- uppgraderar run/window schema;
- defaultar okänd state fail-closed.

Legacy locatorrepair körs efter schema-migration. Entydig `/g/` eller root-locator promoveras från sparad target-URL. Tvetydig continuity skrivs inte om automatiskt och kräver takeover.

## Uppgradering

1. Exportera v0.5.2-state.
2. Pausa aktiva runs.
3. Ladda v0.5.3 unpacked.
4. Ladda om extension.
5. Ladda om kopplad ChatGPT-tab.
6. Öppna sidepanelen och aktivera Nano.
7. Kontrollera config/runtime schema v6 i export.
8. Starta waiting mode och kör desktopacceptansen.

## Import

v0.5.3 accepterar export v3, v4, v5 och v6. Config migreras genom v3→v4→v5→v6. Import skriver inte en targetprompt.

## Rollback

v0.5.2 kan inte förväntas förstå v6-state.

Säkert rollbackförfarande:

1. Exportera v0.5.3-state.
2. Stoppa run.
3. Ta bort/återställ extension storage.
4. Ladda v0.5.2.
5. Importera endast en v5-kompatibel export.
6. Koppla target på nytt.

Försök inte redigera schemaetiketten manuellt; v6 innehåller nya säkerhetsfält och bounded journalregler.

## Fail-closed migration

Vid korrupt continuity eller tvetydig locator skickas ingen prompt. Vid storage-write-fel öppnas circuit breaker och run pausas/blockeras.
