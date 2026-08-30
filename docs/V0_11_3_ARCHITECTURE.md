# v0.11.3 architecture — causal session-init composition

## Incident

The v0.11.2 Desktop Chrome run proved that individually reasonable mechanisms were composed in an invalid order. A valid baseline Nano `ACCEPT` was projected into an ordinary `requestedAction`, rejected by generic grounding as `META_ONLY_ACTION`, followed by pre-READY generic recovery. A later ordinary `WAIT_OWNER_EVENT` was intercepted by delivery regulation before execution routing, consumed the baseline response identity, suspended its timeout and returned before common Nano cleanup. Baseline reconciliation then could not re-observe its own ACKED response.

The result was a causal deadlock: no baseline, no pending Nano request, no chat-control prompt, suspended response timeout and stale Nano-busy ownership.

## Typed phase model

Session initialization is a type-state protocol:

```text
P0 pre-baseline
  -> P1 baseline effect PREPARED/SUBMITTING
  -> P2 baseline effect ACKED / waiting response
  -> P3 stable baseline response
  -> P4 exact baseline Nano RUNNING
  -> P5 baseline ACCEPT / DECISION_READY
  -> COMMITTING
  -> COMMITTED
  -> READY
  -> exactly one ordinary Nano handoff on the same owner-bound observation
```

`P5` cannot enter ordinary continuation grounding, autonomy, delivery regulation or generic recovery.

## Ownership invariants

1. `NANO_ANALYZING` during session init requires a typed baseline request whose `requestId` exactly equals `sessionContextInit.nanoRequestId`.
2. Any ordinary pending Nano request while initialization is incomplete is not a valid baseline owner and is rejected locally.
3. Before durable `READY`, ordinary Nano/recovery/local program mutation is forbidden. Session-init control and exact durable commit replay are the only permitted progress paths.
4. Durable baseline `ACCEPT` closes baseline ownership through one terminal finalizer and hands the same bound observation to one ordinary continuation Nano without sending another target prompt.

## Routing order

Execution routing precedes material delivery regulation:

```text
Nano decision
  -> resolve microActionId
  -> resolve executionDisposition
     |- LOCAL_EXECUTE
     |- WAIT_OWNER_EVENT
     |- EXTERNAL_OWNER_EXECUTE
     |- CHAT_CONTROL_CONTINUATION
     |- TERMINAL
     `- TARGET_DISPATCH
           -> material delivery regulator
           -> target effect if admitted
```

The delivery regulator cannot intercept local, wait, external-owner or terminal semantics.

## Lifecycle-scoped response consumption

A response identity is not globally "consumed" for every state machine. Baseline reconciliation owns its ACKED response until the baseline lifecycle commits or fails. If an ordinary marker references the same response, an incomplete baseline lifecycle may still re-observe it when the current baseline turn and delivery receipt match.

This prevents a generic continuation from destroying the only input that can complete session initialization.

## Terminal Nano finalization

Every terminal Nano path uses one ownership finalizer that:
- clears the pending Nano request;
- clears or explicitly preserves the observation;
- projects the terminal runtime status;
- clears Nano host busy ownership.

No terminal path may return with `pendingNanoRequest === null` while stale Nano host ownership remains true.

## Causal wait invariant

`WAITING_FOR_RESPONSE` is legal only when at least one wake producer exists:
- a PREPARED/SUBMITTING/SUBMITTED_UNCONFIRMED/ACKED outbound effect that can produce a response;
- an explicit external-event owner that the controller can observe; or
- an active response timeout.

`timeoutSuspended === true` with no other wake owner fails closed. AI-actionable waits are emitted as exactly-one `CHAT_CONTROL_CONTINUATION`; sidepanel/UI state is never an AI transport.

## Verification strategy

v0.11.3 adds executed causal tests rather than relying only on source-branch presence:
- exact typed baseline-owner identity;
- meta-verb metamorphic baseline acceptance (`Continue`, `Validera`, `Granska`, `Analysera`, `Läs`, `Verify`, `Review`);
- live-shaped baseline ACCEPT through the real Step2 harness;
- disposition-before-delivery reachability;
- lifecycle re-observation;
- causal wait guards;
- existing commit/readback, same-owner churn, service-worker replay, local no-delta, chat-control and host-failure twins.

## Claim boundary

This document defines the source/package candidate architecture. Desktop Chrome v0.11.3 runtime acceptance remains a separate owner surface until explicitly executed.
