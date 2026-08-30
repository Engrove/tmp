# v0.11.20 architecture

## Incident

The v0.11.19 Desktop Chrome acceptance reached `sessionContextInit=READY`, but a later Nano decision
selected `WAIT_OWNER_EVENT` while also requesting control through model-authored `USER_PAUSE`. The
runtime opened a level-10 `AWAITING_OPERATOR_DECISION` gate. Pressing **Kvittera materiellt beslut
och verifiera readback** twice produced the same terminal UI command failure:
`Cannot read properties of undefined (reading '0')`.

The accepted baseline itself already identified T003-R1 as the bounded work unit and its
`nextHighLeverageAction` was to let the contextless counterpart answer that test unchanged. The
post-READY ordinary handoff nevertheless exposed the baseline response's init-only `EIC_NEXT`
("validate this main-task baseline ...") again, creating an unnecessary re-validation branch before
the false USER_PAUSE.

## Root cause 1 — runtime wrapper written as runtime root

`readRuntimeBundle(windowId)` returns a wrapper:
`{ runtime, continuity, audit, context }`.

Three mutation paths destructured that wrapper as though it were the root runtime and passed the
wrapper to `writeRuntimeBundle()`. The writer then dereferenced `runtime.windows[...]`; on the
wrapper, `windows` is undefined. This exactly matches the live TypeError.

### Invariant

Every runtime write receives the root runtime object. `writeRuntimeBundle()` now rejects an invalid
root with `RUNTIME_ROOT_REQUIRED`.

Affected paths repaired together:
- operator-action evidence receipt;
- boundary authorization receipt;
- session-context purge.

## Root cause 2 — boundary key derived before the boundary existed

The hard USER_PAUSE branch previously derived `boundaryKey(run)` before transitioning the run into
`AWAITING_OPERATOR_DECISION`. Because the key includes pause origin/timestamp, the pending decision
was bound to a `NONE` pause while the final run was bound to `USER_PAUSE`.

### Invariant

State transition first; canonical boundary identity second. The operator decision and authorization
receipt are bound to the final run state.

## Root cause 3 — model-authored control inflated a no-effect route

Nano's requested control was evaluated before the registered execution route. A model could
therefore turn `WAIT_OWNER_EVENT` into a level-10 caller-visible decision even though the route is a
passive/no-effect controller action.

### Control-minimization invariant

A model-authored USER_PAUSE may be internalized only when all of the following hold:
1. target protocol is valid and `CONTINUE`;
2. target protocol does not itself request USER_PAUSE, OPERATOR_ACTION_REQUIRED,
   OPERATOR_ACTION or OPERATOR_DECISION;
3. the execution plan is `NANO_SELECTED`;
4. the selected registered disposition is `LOCAL_EXECUTE`, `WAIT_OWNER_EVENT`, or
   `WAIT_EXTERNAL_EVENT`;
5. the executor is not human.

Any material transport, fallback route, target/user/safety/privacy/authorization boundary or
owner-human boundary remains caller-visible.

## Root cause 4 — init-only trailer reused after READY

The typed baseline commit intentionally hands the accepted response into one ordinary post-READY
Nano cycle. Before v0.11.20 the original target trailer was copied verbatim, including the
init-episode `EIC_NEXT` and actor. This could make the ordinary cycle request baseline validation
again.

### Invariant

The READY handoff stores the original target result separately for audit and exposes an actor-neutral
`SESSION_CONTEXT_READY_HANDOFF` projection whose `next` is the accepted baseline
`current.nextHighLeverageAction`.

## Authorization readback

A boundary click now follows:
1. validate decision/run/key/acknowledgement;
2. stage ACCEPTED receipt and boundary authorization;
3. write the root runtime;
4. re-read the scoped runtime;
5. verify receipt id, boundary receipt id, boundary key and `RECOVERING` state;
6. only then emit the success audit and resume the controller.

The success audit is not the effect owner; root runtime readback is.

## Release identity

v0.11.20 uses current-only config/runtime/storage/Session DB/alarm identities so a newly loaded
candidate cannot silently consume v0.11.19 transient state as if it were current.

## Claim boundary

Local replay and source/package checks can prove the repaired invariants in the candidate source.
Only a fresh Desktop Chrome episode can prove that installed v0.11.20 executes the fixed paths.
