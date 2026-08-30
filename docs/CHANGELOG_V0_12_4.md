# v0.12.4

## Fixes

- Prevents an Agent-authored EIC-AA/5 prompt from being reclassified as a new
  MISSION user event immediately after dispatch.
- Adds `EIC_AGENT_VERSION` and `EIC_AGENT_TURN_ID` to every Agent-authored
  EIC-AA/5 continuation prompt and `agentVersion` to the canonical JSON envelope.
- Recognizes legacy v0.12.3 compact JSON `turnId` as Agent-owned control input.
- Recovers a persisted v0.12.3 false self-supersession once by re-arming the
  exact orphaned CONTROL turn instead of leaving `WAITING_FOR_RESPONSE` with
  `activeEffectId=""`.
- Adds explicit `agentVersion` to short audit items, application-log entries,
  full-audit entries, currentTurn/effect records and protocol-repair receipts.

## Invariant

An Agent-authored CONTROL prompt must never advance MISSION materialGeneration
or close its own causal effect. `WAITING_FOR_RESPONSE` must have a live response
owner/effect, not merely a legacy ACKED currentTurn.
