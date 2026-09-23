# Session Postmortem — Greenfield v1.1.12 Audit stability

## Trigger

The operator reported that Greenfield had started crashing during parallel use across
multiple Chrome windows and suspected that Audit was allowed to grow without bound.

## Source-level findings in v1.1.11

Verified from the supplied v1.1.11 source package:

1. `lib/audit-store.mjs` appended events without retention or rotation.
2. `readAudit()` used `auditEvents.getAll()` and filtered/sorted in JavaScript.
3. every write serialized through the same `auditCounters/__global__` record.
4. WAIT polling could emit repeated `PROCESS_TICK`, `PAGE_STATE_OBSERVED` and
   `RESPONSE_OBSERVATION_HELD` events at high frequency.
5. `PAGE_STATE_OBSERVED` included top-level assistant text plus the full
   `autonomousTurn` object, which itself included assistant text.

## Runtime causal hypothesis

Supported but not live-proven:

- parallel windows increase both event production and side-panel read pressure;
- an ever-growing shared IndexedDB can amplify memory/transaction/quota pressure;
- full-store `getAll()` reads can become increasingly expensive as history grows;
- process-scoped Audit persistence failure can surface as terminal `AUDIT_FAILURE`.

No Chrome heap dump, quota exception trace or browser crash dump was available in the
source-only investigation, so the exact runtime crash mechanism is not claimed as proven.

## v1.1.12 correction

- persistent Audit defaults to off;
- UI checkbox controls persistence;
- off mode keeps only a volatile 25-event FIFO for display and performs no Audit IndexedDB writes;
- on mode has 5,000-event retention;
- high-frequency unchanged diagnostics are coalesced at 5 seconds;
- persistent read path uses indexed reverse cursors;
- global counter contention is removed from the write path;
- repeated raw assistant text is removed from `PAGE_STATE_OBSERVED`;
- side-panel rendering reads FIFO state, not persistent history.

## Validation boundary

Package regression tests prove source-level invariants only.
Live multi-window soak testing is still required to verify the operator-visible crash has
been eliminated in Desktop Chrome.
