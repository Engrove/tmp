# EIC Autonom Agent v0.5.2 — migration och rollback

## Schema

- config: `eic.autonom.config.v5`
- runtime: `eic.autonom.runtime.v5`
- run: `eic.autonom.run.v5`
- window context: `eic.autonom.window-context.v3`
- export: `eic.autonom.export.v5`

Storage-nycklarna behålls från v3 för in-place-kompatibilitet.

## Migration

`migrateV4ToV5()`:

- bevarar mandat, kontinuitet, kopplade flikar, target mode och pågående run;
- bevarar gamla pause-states utan autoomklassificering;
- lägger till takeover flag;
- lägger till response identity;
- lägger till Nano claim/heartbeat/output/repairtelemetri;
- konverterar pending Nano-request konservativt;
- är idempotent.

v2/v3-data går först genom befintliga migrationer och därefter v4→v5.

Efter uppgradering kan en befintlig waiting-session kräva `TAKEOVER_BOOTSTRAP`, särskilt när continuity saknar exact conversation binding. Ingen generisk prompt skickas under detta bootstrap.

## Import

v0.5.2 accepterar export schema v3, v4 och v5. Config migreras till v5 och continuity återförseglas. Import av run/window-state görs inte implicit som extern runtime-sanning.

## Rollback

1. Exportera v0.5.2-state.
2. Stoppa aktiv run.
3. Ladda tidigare kandidat.
4. Äldre version kan läsa gemensamma v3 storage keys men ignorerar v5-fält.
5. Kontrollera manuellt att inget pending Nano-/effect-journal-event återstår före fortsatt användning.

Rollback gör inte en redan utförd extern effekt ogjord. Mjölnar D1-actions har separat rollback/readback-kontrakt.

## Fail-closed

Korrupt continuity, stale claim, tom Nano-output, target mismatch eller okänd tidigare effekt blockerar continuation. Ingen migration får omvandla dessa till success.


## Exakt konversationslocator

v0.5.1 och tidiga v0.5.2-kandidater kunde identifiera en Custom GPT-session med GPT-id i stället för exakt conversation-id. v0.5.2 reparerar `linkedTabs`, aktiv run och entydig continuity från sparad target-URL. Om samma legacy locator pekar på flera conversations skrivs continuity inte om; nästa svar går genom konservativ takeover.

Efter uppgradering ska extensionen och den kopplade ChatGPT-fliken laddas om en gång.
