# EIC Autonom Agent v0.12.2

## Summary

v0.12.2 fixes a session-context continuation deadlock discovered in v0.12.0 live exports and still present in v0.12.1.

## Causal fix

A new material MISSION user event already closed the active CONTROL effect in `causalControl`, but the legacy session-init projection could keep:

- `currentTurn.kind = SESSION_CONTEXT_BASELINE_REQUEST|SESSION_CONTEXT_BASELINE_CORRECTION`
- `sessionContextInit = WAITING_BASELINE_RESPONSE|NANO_ANALYZING`
- the legacy baseline effect as `ACKED`

That split-brain allowed `WAITING_FOR_RESPONSE` to survive without a live causal response owner.

v0.12.2 synchronizes the projections in the same runtime persistence cycle after `MATERIAL_EVENT` closes the baseline effect:

1. the superseded legacy baseline effect becomes `CANCELLED_SUPERSEDED`;
2. the legacy `currentTurn`, pending baseline observation/Nano owner and response deadline are retired;
3. any response candidate is superseded;
4. session context is re-armed at `WAITING_CHAT_READY` with a fresh `needKey`;
5. the next stable assistant generation is treated as a fresh session catch and can deterministically arm a new baseline generation.

Historical baseline ownership is never resurrected by this re-arm.

## Preserved behavior

- v0.12.1 `NANO_TASK` remains unchanged.
- causal CONTROL response binding and effect closure remain authoritative.
- `WAIT_EXTERNAL_EVENT` quiescence and Nano policy fencing remain unchanged.
