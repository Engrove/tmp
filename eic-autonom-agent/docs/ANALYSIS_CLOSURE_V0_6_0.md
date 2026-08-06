# Analysclosure — EIC Autonom Agent v0.6.0

## Korrigerade v0.6.0-fynd

| Finding | Korrigering | Regression |
|---|---|---|
| Nested EIC-AA/3 och 3/4-radskollision | raw prompt exakt, contract inspection, inget wrapping | `start-session.test.mjs` |
| Startanalys tappades | `seedContinuityFromStartAnalysis` före submit | `start-continuity.test.mjs` |
| Meta-only start action | lokal validation + bounded repair | `start-session.test.mjs` |
| Constraints/digest/chunks tappades | binds i start record/receipt/continuity | start tests + wiring |
| Schema fallback utan full kontroll | lokal validation efter varje synthesis | start tests |
| Interim 15-teckensresponse analyserades | response candidate med två hash reads + settle | `response-stability.test.mjs` |
| Full response ersatte inte gammal observation | freshness gate före claim/decision/submit | wiring tests |
| Repair använde stale input | decision freshness körs före varje repair-resultat | wiring tests |
| Nano context ackumulerades | immutable base + task clone/destroy | wiring/validator |
| Generiskt “OMSTART KRÄVS” | explicit stale reason + host telemetry | wiring/validator |
| Groundingfel märktes host missing | `NANO_GROUNDING_REJECTED` | state/wiring |
| Parser tillät trailing text/motsägelser | strikt exakt trailer | parser regressions |
| Export v6/version 5 | export v7/version 7 | validator/migration |
| Raw whitespaceidentitet ändrades | exact source digest + separat DOM digest | start/effect tests |
| Språkclaim mismatch | private/system/task instructions på engelska; targetdata citerad | validator |

## Lokal verifiering

Rapportens slutvärden genereras vid leverans av aktuell source. Desktop Chrome-runtime är separat acceptansyta och ska verifieras enligt `DESKTOP_CHROME_ACCEPTANCE_V0_6_0.md`.
