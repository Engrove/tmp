# Features — EIC Autonom Agent v0.6.1

## Egenskapsmatris

| Område | v0.6.1 |
|---|---|
| Foreground | scoped Stop + streaming/composer signals + terminal protocol override |
| Continuation | Nano, Mjölnar och deterministic protocol fallback |
| PAUSE | automatisk riskbedömning; endast nivå 10 verklig mänsklig PAUS |
| Risk | EIC_DESTRUCTIVENESS/1, 1–10 |
| Hjalmar | lokal mental kontroll för nivå 6–9; extern provenance hålls separat |
| Workbench | hård cap nivå 5, om ingen separat nivå-10-signal |
| Mjölnar | lokal trusted trigger efter action allowlist och target binding |
| Recovery | owner-read, replan, anti-loop path change, checkpoint rollover |
| Background | TTL-fritt verifierat WAITING_BACKGROUND |
| State | schema v8 och durable migration |
| Security | inga credentials, auth/CAPTCHA-automation eller arbitrary actions |

## Foreground completion override

En komplett terminal EIC-trailer får överstyra en ensam stale Stop-kontroll. Verklig assistant-streaming eller composer-busy blockerar override.

## Destruktivitetsklassificering

Beslutet bär:

- `destructivenessLevel`;
- `destructivenessRationale`;
- `exactTarget`;
- `ownerRoute`;
- `rollbackPath`;
- `readbackPlan`;
- `materialAmbiguity`.

## PAUSE-adjudikering

För nivå <10 väljs i ordning:

1. turn-bundet target `EIC_NEXT`;
2. konkret Nano `requestedAction`;
3. tekniskt distinkt alternativ;
4. lokal owner-read/replan.

För nivå 6–9 läggs en owner-read framför effekten om Hjalmar mental control saknar fakta.

## Mjölnar trust chain

```text
Nano proposal
  → local ACTION_REGISTRY lookup
  → exact target resolver
  → destructiveness classification
  → Hjalmar mental control when >5
  → idempotency ledger
  → dispatch
  → owner readback
```

Nano-proposal i sig är aldrig trusted execution provenance.

## Checkpoint och dead end

Max turns skapar en ny bounded checkpoint epoch. Dead end under nivå 10 väntar på ett exakt unlock-event och fortsätter polling/reconciliation. Ingen av dem blir automatisk human pause.

## Startpromptkontrakt

Raw new-session start bevaras exakt. Continuation stöder turn-bound 4-radstrailer och explicit turnless 3-radskontrakt enligt befintlig parserpolicy.
