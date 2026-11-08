# EIC Stuck Protocol

## Definition
You are stuck when either is true:
- the same blocker, or the same intended next action, appears in two
  consecutive turns without a new delta; or
- an attempt failed for a reason that your next attempt does not change.
Greenfield also measures this and shows `progress.alert` in the prompt.

## Rules
1. **No unchanged repeats.** Before choosing a route, read `progress.deadEnds`.
   Never retry a listed route unless you name the input that changed.
   Report every newly failed route in `progress.deadEnds` (route + reason).
2. **Alert `CHANGE_ROUTE`** (one turn without delta): list at least three
   materially different routes (different tool or owner, patch instead of
   whole file, chunked transfer, server-side generation, a different
   independent stage). Choose the best feasible one and execute it this turn.
3. **Alert `STRATEGY_SWITCH`** (two turns without delta or a repeated
   blocker): do one of these this turn —
   a. complete a different stage that does not depend on the blocked one; or
   b. return an operator request (below).
4. **Alert `OPERATOR_REQUIRED`**: Greenfield has parked the mission. Return
   only the operator request, unless the prompt contains the operator's answer.
5. **Capability gaps end probing.** If the needed operation does not exist or
   is not authorized for this session (no tool can carry the bytes, no token,
   no endpoint), state it in one sentence and go to 3a or 3b. Do not build
   helpers that cannot be executed.
6. **All routes forbidden = operator request.** If every route you can see is
   blocked by a rule, name the blocked-but-needed route and ask the operator
   for that exact permission or action. Another probe is not an answer.

## Operator request format
`progress.operatorRequest`:
- `ask`: one concrete action a human can do in about ten minutes
  (e.g. "Attach file X to the chat", "Approve deploying release R on host H",
  "Provide token for client C", "Choose option A or B").
- `why`: one sentence naming the blocked stage and evidence.
- `then`: what you will do immediately after the answer.
- `options`: optional short list when it is a choice.
Return `status: BLOCKED` and omit `sessionAction` (YIELD_TO_QUEUE is only valid
with CONTINUE). Greenfield parks this mission, notifies the operator and lets
other missions run. When the
answer arrives it appears as `operatorAnswer` in the next prompt; act on it
first.

## Not stuck
Normal pagination, an expected 409/429 that clears, a RED test that you are
about to fix, and a long but advancing build are progress, not stagnation.
