# Architecture — EIC Autonom Agent v0.6.3

## Översikt

```text
ChatGPT DOM
  → trusted content snapshot
  → response stability + protocol parser
  → observation
  → protocol fast path eller Nano
  → decision grounding
  → destructiveness/Hjalmar control
  → optional Mjölnar delegation
  → turn compiler
  → effect journal + prompt submit
  → DOM acknowledgement/readback
```

Durable state ligger i `chrome.storage.local`. Sidepanelen är UI och Nano-host, inte source of truth.

## Deterministic lifecycle

### Requeststate

```text
PENDING/claimed Nano
DETERMINISTIC_PENDING:
  ARMED
    → DISPATCHED(attempt=1)
      → completed/consumed
      → callback lease väntar utan write
      → DISPATCHED(attempt=2)
      → RECOVERING om callback fortfarande saknas
```

`deterministicScheduledAt`, `deterministicDecisionDigest`, `deterministicDispatchState` och `deterministicDispatchAttempts` persisteras före callback.

### Grounding lifecycle

```text
decision
  → validate
  → valid: apply
  → invalid deterministic:
       one local repair
       → valid: apply
       → invalid: source exhausted, clear request, RECOVERING
  → invalid Nano:
       protocol rescue, one Nano repair eller bounded deterministic recovery
```

En `DETERMINISTIC_RECOVERY` får aldrig skapa samma `DETERMINISTIC_RECOVERY` efter ett identiskt groundingfel.

## Observation ownership

En observation binds till:

- exact conversation locator;
- document epoch;
- assistant response hash;
- response identity;
- target turn id;
- current effect acknowledgement.

Cross-epoch recovery tillåts endast när hash, conversation, turn och ACKED effect matchar.

## Revision discipline

`stateRevision` ökar vid durable mutation. Under en aktiv deterministic callback-lease returnerar `tickWindow` endast snapshot. Detta förhindrar revisionstorm från:

- watchdog;
- content mutation events;
- panel refresh;
- alarms;
- lifecycle wakeups.

Audit-coalescing minskar loggbrus men är sekundärt till state-gaten.

## Mjölnar separation

Mjölnar har två skilda banor:

1. **Semantic preclassification**
   - risknivå;
   - Hjalmar control;
   - candidate/read-required UI;
   - ingen action/effect claim.

2. **Delegated effect**
   - trusted local request;
   - static action registry;
   - exact target;
   - idempotency key;
   - dispatch;
   - owner readback;
   - först därefter `VERIFIED_EFFECT`.

## Runtime states

Relevanta states:

- `WAITING_FOR_RESPONSE`;
- `WAITING_BACKGROUND`;
- `ASSESSING`;
- `DELIVERING`;
- `RECOVERING`;
- `SOFT_PAUSED`;
- `HARD_BLOCKED`;
- `HUMAN_REQUIRED`;
- `DONE`.

`ASSESSING` får inte bli en självskrivande steady state. Varje pending request måste ha en ägare, lease och terminal/recoveryväg.

## Security

- targettext är untrusted data;
- inga nya permissions från modelltext;
- ingen auth/CAPTCHA/secretautomation;
- ingen generell DOM-click/exekvering;
- Mjölnar använder statisk action registry;
- target claims är inte owner evidence;
- local deterministic repair får endast precisera target, owner-read och outputkontrakt.
