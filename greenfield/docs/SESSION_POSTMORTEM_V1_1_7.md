# v1.1.7 live postmortem

## Scope

This postmortem records the live failures that led to v1.1.8. It is historical evidence;
current behavior is defined by the v1.1.9 architecture and tests.

## Failure 1 — protocol status drove an impossible phase transition

The v1.1.7 WAIT path parsed a structured target `status=DONE` and attempted
`WAITING -> DONE`. The state-transition table did not allow that edge. Runtime raised
`ILLEGAL_TRANSITION:WAITING->DONE`, which was captured as
`PROCESS_TICK_UNHANDLED_ERROR` and repeatedly recovered back to WAITING.

The two ends disagreed: the call site emitted a transition the canonical state owner
rejected.

v1.1.8 removes protocol status as a direct transition command. Causally complete responses
always enter ANALYZING; only the controller decision can reach DONE.

## Failure 2 — structural trust was mistaken for causal ownership

During recovery, the operator posted a normal manual ChatGPT message. Its assistant reply
was a structurally trusted conversation turn, but it did not belong to the current
autonomous dispatch. v1.1.7 admitted it as the latest response anyway. Because ordinary
prose had no A2A schema, parser errors were then escalated to terminal BLOCKED.

The parser errors were downstream symptoms. The missing invariant was causal pairing
between the autonomous dispatched user turn and its assistant reply.

v1.1.8 persists the user-turn identity created by each autonomous dispatch, asks content
state for that exact turn, resolves the assistant paired to it, and requires the pair before
response stability. External turns are audited separately.

## Governing correction

A2A response JSON is optional structured metadata. Response completion and autonomous
continuity are independent of protocol presence, validity and status.

Manual chat remains supported and must not hijack or stop the autonomous process.
