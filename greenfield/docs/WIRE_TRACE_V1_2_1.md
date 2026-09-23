# Wire trace — Greenfield v1.2.1 response ownership recovery

`content.js canonicalEntries`
-> structural owner resolver
-> `EXPLICIT_TURN_SHELL | ROLE_BOUNDARY_ANCESTOR | COHERENT_ROLE_REPLICA | ROLE_NODE_FALLBACK`

`content.js resolveAutonomousTurn`
-> exact dispatched user id / bounded ordinal recovery
-> assistant between dispatched user and next user
-> `nextUserTurnId`, `responseSlotClosed`

`lib/turn-causality.mjs autonomousResponseObservation`
-> expected/paired user identity
-> `pairedUserResolvedBy`
-> assistant owner kind/trust/replica count
-> visibility/generation/text/hash/count

`lib/response-stability.mjs classifyResponseObservation`
-> normal path: structural owner trusted
-> exceptional path: `ROLE_NODE_FALLBACK + USER_TURN_ID + exact causal match + visible + open slot`
-> hidden/ordinal/closed/mismatched -> held

`advanceResponseCandidate`
-> structural: normal stability threshold
-> causal fallback: >= 5000 ms AND >= 5 reads
-> `STABLE_TERMINAL_RESPONSE_CAUSAL_FALLBACK`

`background.js tickWaiting`
-> `RESPONSE_CAUSAL_FALLBACK_ADMITTED`
-> optional protocol parse
-> normal response capture / ANALYZING

Overlay noise path:
`background syncOverlay(reason=observation)`
-> content `updateOverlay`
-> unchanged text/title returns `changed=false`
-> background does not append another observation-only overlay sync event.
