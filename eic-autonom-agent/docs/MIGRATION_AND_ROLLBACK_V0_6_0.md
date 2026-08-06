# Migrering och rollback — v0.6.0

## Schema

| Objekt | v0.5.3 | v0.6.0 |
|---|---|---|
| Config | v6 | v7 |
| Runtime | v6 | v7 |
| Run | v6 | v7 |
| WindowContext | v4 | v5 |
| Continuity | v1 | v2 |
| Export | v6-label/version 5-defekt | v7/version 7 |
| Content bridge | 0.5.3 | 0.6.0 |

## Automatisk migration

`migrateV6ToV7`:

- bevarar config, custom Nano-/targetmandat och continuity;
- uppgraderar endast det identifierade gamla standardmandatet till Nano Core Mandate v2;
- stänger av target-authored fallback;
- lägger till response candidate, observation generation och supersede receipt;
- lägger till response contract och Nano host/context/clone telemetry;
- uppgraderar run/window schema.

v0.6.0 accepterar export v3, v4, v5, v6 och v7. Import skriver inte targetprompt.

## Uppgradering

1. Exportera v0.5.3-state.
2. Pausa eller stoppa aktiva runs.
3. Ladda v0.6.0 unpacked och ladda om extensionen.
4. Ladda om kopplad ChatGPT-tab.
5. Öppna panelen och aktivera Nano.
6. Kontrollera config/runtime v7 och continuity v2 i export.
7. Kör desktopacceptansen.

## Rollback

v0.5.3 kan inte förväntas förstå v7-state. För rollback:

1. Exportera v0.6.0-state.
2. Stoppa run.
3. Rensa/återställ extension storage.
4. Ladda v0.5.3.
5. Importera endast en v6-kompatibel export från före uppgraderingen.
6. Koppla target på nytt.

Redigera inte schemaetiketten manuellt.
