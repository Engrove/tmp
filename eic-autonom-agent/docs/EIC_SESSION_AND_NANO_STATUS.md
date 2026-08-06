# Session och Nano-status — v0.6.1

## Nano-bassession

Skapas endast genom direkt användargest. Den innehåller privat Nano Core Mandate v2 och canary, inte dynamisk targettext eller continuity.

## Task-session

Varje chunk, syntes, decision och repair får en isolerad clone när API:t stöder det. Tasken förstörs efter resultat. Fresh clone retry används en gång vid session-/contextrelaterat taskfel.

## Statusorsaker

- `MANDATE_CHANGED`: ny bas krävs.
- `BASE_CONTEXT_OVERFLOW`: basen overflowade.
- `BASE_SESSION_INVALID`: basen förlorades/är ogiltig.
- `CONTEXT_HIGH_WATERMARK_NO_CLONE`: compatibility fallback ackumulerade context.
- `DOWNLOAD_REQUIRED`: Chrome kräver aktivering/nedladdning.
- `CREATE_FAILED`: create misslyckades.

`NANO_GROUNDING_REJECTED` är ett beslutsfel, inte host absence.
