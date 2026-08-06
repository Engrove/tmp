# Features — EIC Autonom Agent v0.6.2

## Nytt i v0.6.2

| Område | Beteende |
|---|---|
| Protocol fast path | Giltig terminal `CONTINUE`, `PAUSE` eller `DONE` tillämpas utan Nano-mellanstopp |
| Import recovery | Bevarad giltig v0.6.1-observation utan aktiv request återköas automatiskt |
| Grounding | Svenska effektverb, dotted routes, snake-case ids och `key=value` stöds |
| Nano failure | INVALID/groundingfel blir deterministic recovery i Max Autonomous Mode |
| PAUSE | Nivå 1–9 omvandlas till continuation/replan; endast nivå 10 kräver människa |
| Mjölnar | Lokal risk- och delegationskontroll för faktiska effekter, inte för ren protokollparsing |
| Durable state | Schema v8 bevaras; v0.6.1-export kan importeras och självrepareras |

## Beslutsordning

```text
stabilt komplett assistantsvar
  → exakt terminal trailer
  → giltig?
       ja: deterministic protocol fast path
       nej: Nano continuation analysis
  → lokal destructiveness 1–10
  → nivå 1–5 CONTINUE
  → nivå 6–9 Hjalmar mental control + CONTINUE/owner-read
  → nivå 10 HUMAN_REQUIRED
```

## Förbjudna effektiva stopp

Följande får inte lämna runnen i ett passivt vänteläge utan aktiv recoveryplan:

- Nano JSON-parsefel;
- `META_ONLY_ACTION`;
- lease-expiry;
- Nano-host timeout efter etablerad continuity;
- en låg-/medelrisk `PAUSE`;
- import av en giltig pending observation utan request.

## Säkerhetsgränser

Direkt operatörs-Stop/Paus och deterministisk nivå 10 stoppas fortfarande. Fast path skapar ingen ny permission och gör inte måltext till owner-evidens.
