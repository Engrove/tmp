# Changelog v0.11.15

## Fixed

- Response-candidate settling no longer relies on an in-memory `setTimeout` alone.
- A named one-shot `chrome.alarms` wake is scheduled with every response-settle probe and restored after MV3 service-worker initialization.
- A persisted response candidate carries a bounded settle deadline.
- Trusted terminal EIC completion evidence normalizes stale `WAITING_FOREGROUND` back to response processing before foreground wait can pre-empt settlement.
- A same candidate that cannot be owner-settled inside the bounded window records typed `RESPONSE_SETTLE_LIVENESS_TIMEOUT` evidence and fails terminally instead of waiting indefinitely.
- Side-band effect reconciliation now synchronizes chat-control/protocol-repair ACK receipts with the authoritative effect journal.

## Preserved

- v0.11.14 lexical `USER_PAUSE` correction.
- v0.11.13 owner-bound `AWAITING_OPERATOR_ACTION` / `AWAITING_OPERATOR_DECISION` transition authorization.
- v0.11.11 one-shot local-state diagnostics and v0.11.10 local-rearm bridge.
- Baseline correction, Nano completeness/output bounds, actor/capability and effect-integrity controls.
