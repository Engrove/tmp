# v0.10.11 architecture — prompt-critical delivery and initialization liveness

## Problem statement

The v0.10.10 live run reached a state that no component could leave:

```
sessionContextInit.state = CATCH_CAPTURED
run.state               = WAITING_FOR_RESPONSE
currentTurn             = null
effectJournal           = []
promptHistory           = []
mainTaskBaseline        = null
```

Three independent defects combined into one permanent stall.

1. **Delivery depended on a detached callback.** `scheduleDeterministicDecision` persisted
   `DISPATCHED`, then handed the application step to
   `setTimeout(() => applyNanoDecisionCommand(...).catch(console.warn), 0)`. `DISPATCHED` was
   therefore a statement of intent, not a receipt.
2. **The exception had no owner.** Every failure gate *inside* the application step persists and
   audits before returning — but the gates in its prologue throw, and the only handler was
   `.catch(console.warn)`. The run's revision sequence shows zero writes between the dispatch
   write and the next unrelated write, on both attempts: the failure left no durable trace at all.
3. **Nothing was live-bounded.** `SESSION_CONTEXT_INIT_STATE.FAILED` was defined, had an overlay
   and was excluded from attention routing — and was never assigned anywhere in the codebase.
   `sessionContextInitBlocksWork` returns true for every non-`READY` state, so the gate blocked
   all work forever. The only remaining timer, `responseDeadlineAt`, renews itself for another
   two hours in Max Autonomous Mode with no escalation counter.

The terminal step then made recovery impossible: on `CALLBACK_ATTEMPTS_EXHAUSTED` the observation
was recorded as processed although no prompt had been built or sent, while the resume plan
demanded *"a new owner-read or target response that changes the observation identity"*. The only
actor that could produce a new assistant response was the agent, and the agent was blocked on
exactly that observation — a circular wait.

## Design

### 1. In-band application

`applyNanoDecisionCommand` is split into a locked entry point and
`applyNanoDecisionCommandUnlocked`, matching the existing `tickWindow`/`tickWindowUnlocked` and
`executePreparedEffectUnlocked` idiom. `tickWindowUnlocked` already owns the operation queue, so
re-entering `enqueue` would deadlock — that is exactly why v0.10.10 detached the callback. The
unlocked variant lets the tick apply the decision in the same queue slot:

```
tickWindowUnlocked
  → buildDeterministicDecision
  → prepareDeterministicDispatch          (persist DISPATCHED)
  → writeRuntimeBundle + notifyPanels
  → applyDeterministicDecisionInBand      (same operation, awaited)
       → applyNanoDecisionCommandUnlocked
            → currentTurn + effectJournal
            → executePreparedEffectUnlocked
            → EIC_SUBMIT_PROMPT → DOM ACK
```

`DISPATCHED` is still persisted *before* the application step, so a service-worker death mid-apply
still leaves a lease that `evaluateDeterministicDispatch` can retry. That is the only remaining
purpose of `DETERMINISTIC_CALLBACK_LEASE_MS`, and it is the semantics the constant was written for.

### 2. Owned failures

`applyDeterministicDecisionInBand` catches, classifies and persists. Classification maps the
throw sites in the application prologue to stable codes:

| Code | Origin |
|---|---|
| `STORAGE_PERSISTENCE_FAILURE` | storage circuit open |
| `RUN_NOT_ASSESSING` | run left ASSESSING before the apply |
| `STALE_REQUEST_ID` | pending request replaced |
| `TARGET_PAGE_READ_FAILED` | `readPage` / content-bridge failure |
| `NANO_COMPLETION_REJECTED` | completion gate |
| `DECISION_CALIBRATION_FAILED` | action calibration |
| `DETERMINISTIC_DISPATCH_EXCEPTION` | anything else |

Each failure writes `run.deterministicDispatchFailure`, an audit entry, and an
`mission.deterministic.dispatch-failed` application-log entry. Before v0.10.11 the application log
contained no mission-domain events at all.

### 3. Bounded re-arm before reconciliation

Within `DETERMINISTIC_CALLBACK_MAX_REARMS`, `rearmDeterministicDispatch` resets the dispatch
bookkeeping while preserving the `requestId`, so the gate returns `SCHEDULE` and the next tick
rebuilds the decision and re-reads the page. Beyond the budget,
`exhaustDeterministicDispatch` drives the gate to `RECOVER` so the unchanged v0.6.3
bounded-reconciliation path owns the terminal handling.

This restores, for the callback failure class, the protection v0.7.0 already gave the grounding
failure class — see the comment above the `TAKEOVER_MAX_RECOVERY_ATTEMPTS` re-arm in
`background.js`, which describes this exact stall in the past tense.

### 4. The delivered-turn invariant

```
observationProducedDeliveredTurn(run, observation)
  ⇔ ∃ effect ∈ run.effectJournal :
        effect.status ∈ { SUBMITTING, SUBMITTED_UNCONFIRMED, ACKED }
      ∧ ( effect.sourceObservationHash  = observation.responseHash
        ∨ effect.sourceObservationEpoch = observation.documentEpoch )
```

Only an observation satisfying this may advance `lastProcessed*`. The invariant is deliberately
*not* the one an early reading of the incident suggests — `WAITING_FOR_RESPONSE ⇒ currentTurn`
would be wrong, because in `CHATGPT_CONTINUATION` with
`activation = WAIT_FOR_NEXT_COMPLETED_ASSISTANT` the agent legitimately waits for a response it did
not cause. The illegal configuration is *waiting with nothing armed*:

```
sessionContextInit ≠ READY
∧ state = WAITING_FOR_RESPONSE
∧ pendingObservation = null
∧ pendingNanoRequest = null
∧ currentTurn = null
```

which is precisely the exported v0.10.10 state.

### 5. Initialization liveness

`SESSION_CONTEXT_INIT_STALL_LIMIT_MS` bounds only the phases the controller owns end to end:

| Phase | Bound | Rationale |
|---|---|---|
| `WAITING_CHAT_READY` | none | operator/target pace |
| `CATCH_ARMED` | none | waits for a target response |
| `CATCH_CAPTURED` | 120 s | local handoff, milliseconds in the happy path |
| `BASELINE_REQUEST_DISPATCHED` | 120 s | local build + submit + ACK |
| `WAITING_BASELINE_RESPONSE` | none | target generation (`responseDeadlineAt`) |
| `NANO_ANALYZING` | none | local inference (`NANO_WALL_TIMEOUT_MS`) |

On a stall, `applySessionContextInitFailure` assigns `FAILED`, clears the burned deterministic
source, and holds the run in `PROGRAM_BLOCKED`. `pauseRequiresHuman` reports a failed
initialization as human-required, which stops the `SOFT_PAUSED`/`PROGRAM_BLOCKED` reclassifiers
from bouncing the run back into `RECOVERING`. `FAILED` is terminal in
`advanceSessionContextInit`, so the transition fires exactly once and cannot spin.

The operator route is `RETRY_SESSION_CONTEXT_INIT`, bounded by
`SESSION_CONTEXT_INIT_MAX_OPERATOR_RETRIES`, which re-arms the chain from phase 1 and reuses
nothing from the failed generation. It sends no prompt itself.

### 6. Capture backoff

`autoCaptureDeferDelayMs` doubles the retry delay per consecutive deferral and saturates at 30 s.
There is deliberately no attempt ceiling: the 30 s watchdog tick re-triggers capture anyway, so a
cap could only lose a capture, never save work. The counter clears as soon as a capture is allowed.

## Non-goals

- The lease and attempt constants are unchanged. Retuning them would have addressed a symptom of
  the detached callback, not the callback itself, and would have invalidated the v0.6.3
  regression fixtures.
- No migration or compatibility path is added. The forward-only law from v0.9.3 stands.
