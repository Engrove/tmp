# EIC Autonom Agent v0.12.0

## Causal control-plane refactor

v0.12.0 is built from the exact v0.11.22 BROWSER preimage
`b43db1430214fb4594ea9d6f9de8db97636325cd1381f5728d0fa863823daad6`.

The release replaces the previous implicit response/effect ownership chain with a
dedicated causal CONTROL aggregate and one transition authority for the critical
ownership lifecycle.

### Principal changes

- Explicit causal planes: `MISSION`, `CONTROL`, `OBSERVATION`, `ACCEPTANCE_HARNESS`.
- CONTROL effects use `OPEN -> DELIVERED -> ACKED -> RESPONSE_BOUND -> RESPONSE_CONSUMED -> CLOSED`.
- `ACKED` is transport evidence only; it no longer permanently owns arbitrary future assistant responses.
- A response enters EIC-AA parsing only after an explicit bound CONTROL response contract exists.
- A new material human/user event retires stale CONTROL response ownership.
- `WAIT_EXTERNAL_EVENT` is registered as a quiescent causal wait and wakes only when its predicate changes.
- `NANO_DISCRIMINATION_FAILED` installs a same-generation policy fence that generic recovery cannot bypass.
- Terminal run transition retires nested pending observation/current turn/effect/wait authority atomically.
- Main-task baseline schema v3 is explicitly `plane: "MISSION"`; acceptance-harness state cannot silently become mission routing state.
- Historical `userTurnIds` are not accepted as proof that the latest user message is the extension's own control prompt.

## Claim boundary

This package is source-built and regression-validated in the local build environment.
Desktop Chrome live acceptance is a separate release gate.
