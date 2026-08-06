# v0.5.1 migration och rollback

## Migration

v0.5.1 använder config/runtime schema v4 men behåller de existerande v3 storage-nycklarna för säker in-place-kompatibilitet.

`migrateV3ToV4()`:

- bevarar Nano-mandat, target-mandat, ny sessionsprompt och Max Autonomous Mode;
- bevarar kopplade flikar, valt target och pågående run;
- autoomklassificerar inte ett äldre PAUSE-state;
- lägger till background wait-fält;
- lägger till Mjölnar-ledger;
- defaultar Mjölnar till `disabled` och `SHADOW`;
- defaultar TTL-fritt background wait till aktiverat;
- är idempotent.

v0.4.1/v2-data går fortsatt genom befintlig v2→v3-migrering och därefter v3→v4.

## Rollback

1. Exportera v0.5.1-state.
2. Stoppa aktiv run.
3. Ladda tidigare extensionkandidat.
4. Den äldre versionen kan läsa sina befintliga v3-nycklar; v0.5.1 raderar inte v2-backup.
5. Mjölnar-ledger och backgroundfält ignoreras av äldre kod.

Rollback återställer inte en redan utförd extern action. D1-actions har därför separat registrerad rollback och owner-readback.

## Fail closed

Korrupt continuity stoppar promptleverans. Okänd Mjölnarstate, stale snapshot, target mismatch eller okänd dispatch-effekt pausas och får aldrig blind retry.
