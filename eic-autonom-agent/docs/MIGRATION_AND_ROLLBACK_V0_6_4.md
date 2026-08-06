# Migration and Rollback — EIC Autonom Agent v0.6.4

## Schemapåverkan

Ingen schemabump. Config/runtime/export ligger kvar på v8 och continuity på
`eic.nano.continuity.v2`. v0.6.4 lägger endast till fält som `normalizeContinuity()` och
`createRun()` fyller i med defaults:

| Fält | Plats | Default |
|---|---|---|
| `antiLoop.concreteActionCount` | continuity | `0` |
| `antiLoop.lastActionClass` | continuity | `"UNKNOWN"` |
| `position.workUnitSource`, `position.updatedAt` | continuity | `""` / nu |
| `blockers[].assertedTurn`, `lastAssertedTurn`, `closedReason` | continuity | turnindex / `""` |
| `run.sessionInitGate`, `run.sessionInitReadiness` | runtime | saknas = spärrar ingenting |
| `nanoTelemetry.lastInputBudget` | runtime | saknas |
| `recovery.exhaustionCycles` | runtime | `0` |

## Uppgradering

1. Ladda om extensionen (load unpacked) på v0.6.4.
2. Befintliga runs fortsätter. En run utan `sessionInitGate` behandlas som redan initierad,
   så en pågående körning fryser inte vid uppgradering.
3. Öppna blockerare behåller `open: true` tills de antingen återasserteras eller passerar
   sex tysta turer och stängs med `STALE_NO_REASSERTION`.

## Rollback

Installera om v0.6.3-paketet. Durable state är framåtkompatibelt: v0.6.3 ignorerar de nya
fälten. Observera att rollback återinför D1–D9 samt saknad sessionsinitieringsspärr.

## Backout-signal

Om Nano efter uppgradering rapporterar `withinBudget: false` med `degradeAttempt: 2` i
`nanoTelemetry.lastInputBudget`, är värdens contextfönster mindre än den konservativa
uppskattningen. Sänk `charsPerToken` i `lib/nano-input-budget.mjs` innan rollback övervägs.
