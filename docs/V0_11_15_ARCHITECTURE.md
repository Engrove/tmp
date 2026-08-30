# v0.11.15 architecture

## Response-settle owner

A response candidate is durable run state. Its identity is `(latestAssistantHash, documentEpoch)`.
Every candidate receives a persisted settle deadline. The owner has two wake mechanisms:

1. a fast in-worker timer for low-latency repeated reads;
2. a named one-shot `chrome.alarms` wake for MV3 service-worker suspension/restart.

Initialization restores a wake for every nonterminal run that still owns a response candidate.

## Foreground reconciliation

Trusted terminal EIC evidence (`protocolCompletionOverride`) and an owner-readable assistant response
take precedence over stale `WAITING_FOREGROUND`. The run is normalized to `WAITING_FOR_RESPONSE`
before the ordinary response-settle gate runs.

## Bounded failure

If the same candidate identity survives beyond the bounded settle deadline without becoming
owner-readable, runtime records `eic.autonom.response-settle-failure.v1` with code
`RESPONSE_SETTLE_LIVENESS_TIMEOUT` and transitions to `ERROR_TERMINAL`. This prevents an
unbounded scheduler wait.

## Side-band ACK consistency

`reconcileEffect()` mirrors an authoritative ACK into matching chat-control/protocol-repair receipts.
The effect journal remains the acknowledgement owner; receipt state is a synchronized projection.

## Human boundaries

No operator-action or operator-decision transition semantics changed in this release.
v0.11.13 receipt-bound exit authorization remains authoritative.
