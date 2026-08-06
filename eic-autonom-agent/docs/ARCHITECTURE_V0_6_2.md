# Architecture — EIC Autonom Agent v0.6.2

## Kontinuitetsvägar

### A. Deterministic protocol fast path

```text
content snapshot
  → stable response identity
  → parseTargetResult
  → protocolFastPathEligible
  → DETERMINISTIC_PENDING
  → buildDeterministicDecision
  → completeNanoRequestState(source=DETERMINISTIC_PROTOCOL)
  → destructiveness/Hjalmar/Mjölnar gates
  → compile and submit exactly one next turn
```

### B. Semantisk Nano-väg

```text
stable response without valid terminal protocol
  → claimed Nano request
  → strict schema + grounding
  → decision
  → local policy gates
```

### C. Recovery-väg

```text
Nano parse/grounding failure
  → valid target protocol? protocol fast path
  → otherwise DETERMINISTIC_RECOVERY
  → bounded owner-read/replan
```

## Ny modul

`lib/protocol-fast-path.mjs` äger:

- `protocolFastPathEligible`;
- `markDeterministicPending`;
- `preservedProtocolRecoveryEligible`.

`lib/nano-pipeline.mjs` accepterar separata beslutskällor:

- `NANO`;
- `DETERMINISTIC_FALLBACK`;
- `DETERMINISTIC_PROTOCOL`;
- `DETERMINISTIC_RECOVERY`.

En deterministic completion accepteras endast om pending-requestens source matchar.

## Durable import recovery

Vid tick kontrolleras en bevarad `pendingObservation`. Om observationen fortfarande matchar exakt page identity, trailern är giltig, ingen request finns och ingen human pause gäller skapas en ny `DETERMINISTIC_PROTOCOL`-request. Denna regel reparerar den observerade v0.6.1-exporten utan att skicka dubblettprompt.

## Trust boundary

Måltexten är fortsatt data. Fast path verifierar endast det lokala EIC-AA-protokollets form och turnbinding. Externa fakta/effects kräver fortfarande owner readback.
