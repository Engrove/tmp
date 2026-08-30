# v0.11.19 architecture

## Problem set

v0.11.19 responds to three materially different live-session families, not one retry/timer defect.

### 1. Cross-conversation false grounding

A clean conversation could inherit `mainTaskBaseline`, intent and work-unit state from the previous
conversation. `continuityIsGrounded()` then treated that stale projection as current, skipped the
fresh baseline bootstrap and allowed ordinary current responses to be routed toward pre-READY Nano.

**Invariant:** conversation-owned continuity never crosses a conversation identity boundary.

`promoteContinuityConversation()` now creates a fresh continuity body when the conversation changes.
Only scope metadata is retained. A mission start additionally clears any prior baseline and resets
track control to `BASELINE_REQUESTED`, so a second mission in the same chat also owns a fresh gate.

### 2. Rendered response / parser split-brain

Live evidence showed a complete rendered `eic.main-task-baseline.v2` answer while runtime/Nano
received only a tiny representation and reported `MAIN_TASK_BASELINE_NOT_FOUND`. Runtime observation
and transcript capture previously used different DOM extraction paths, and role-bearing fragments
could be nested.

**Invariant:** every consumer of a target response uses one canonical top-level rendered-message
representation.

`content.js` now:
- chooses only the outer role-bearing message node;
- preserves structured `<pre>/<code>` content;
- strips only known local/copy controls rather than every button wrapper;
- prefers the raw rendered representation when it is materially richer or carries structured
  payload lost by the cleaned clone;
- exposes extraction completeness/diagnostics;
- uses the same canonical record for runtime observation and transcript Capture;
- excludes transient request-placeholder assistant turns.

`responseEligibleForNano()` rejects a known-incomplete canonical extraction. Baseline recovery is
marked complete only when the runtime-owned extraction bit is complete. Therefore extraction/transport
failure cannot masquerade as semantic DRIFT and consume the one baseline-correction generation.

### 3. Session Memory provenance

A prior v0.11.18 run produced a `FRESH` memory whose provenance included turns and summaries from the
previous conversation.

**Invariant:** Session Memory is a projection of the exact current conversation/capture/task, not a
cross-conversation accumulator.

Memory synthesis filters summaries by current conversation, current capture and current capture turn
set. Any rejected summary makes the result `RESET_REQUIRED`; freshness evaluation preserves
`RESET_REQUIRED`/`STALE` and cannot upgrade invalid provenance to `FRESH`. The v0.11.19 Session DB
and active-pointer namespaces are fresh.

### 4. Retry episode identity

A failed baseline-correction episode could be manually retried and later reach READY while still
carrying the prior `EXHAUSTED` correction fence and the same `needKey`.

**Invariant:** every explicit operator retry is a new bounded analysis episode, while a
post-delivery retry must still preserve the already delivered baseline anchors and must not resend
that prompt.

The retry rotates `needKey` (`...:1 -> ...:2`) and clears correction generation/fence. A pre-delivery
retry also clears catch/baseline anchors and restarts from chat readiness. A post-delivery reconcile
keeps catch/baseline response ownership but re-analyzes it under the new retry episode.

A terminal `BASELINE_CORRECTION_EXHAUSTED` return now also runs the shared Nano terminal ownership
finalizer before persistence. This releases deferred automatic Capture instead of leaving the Nano
host marked busy after a semantically terminal init failure.

### 5. Investigative session external dependency

An investigative workflow can legitimately reach a point where only a genuinely independent producer
can create the next evidence (for example a blind decoder). Treating that condition as
`EXTERNAL_SYSTEM_UNAVAILABLE_TO_AGENT -> PROGRAM_BLOCKED` conflates "Agent must not impersonate the
producer" with "the program has failed".

**Invariant:** a true external dependency is a quiescent wait, not a synthetic failure or same-chat
proxy.

`WAIT_EXTERNAL_EVENT` suspends timeout, persists the required unlock evidence and returns to
`WAITING_FOR_RESPONSE` without material target dispatch or chat-control. A later materially changed
response or explicit manual resume may re-enter the controller.

### 6. Protocol churn in explanatory sessions

Investigative answers may mention older EIC-AA lines and EIC's global footer may follow the five-line
trailer. Counting every marker in the last lines produced unnecessary `PROTOCOL_REPAIR` turns.

**Invariant:** authority belongs to the last exact contiguous EIC-AA/5 trailer. Only non-semantic EIC
metadata may follow it. Later protocol markers or arbitrary semantic prose still fail closed.

## Preserved v0.11.18 liveness repair

The CATCH response cannot be re-admitted as RESPONSE_OWNER after it is transferred to
`pendingObservation`; source/effect/processed identities remain causally excluded. The existing
`CATCH_CAPTURED` and `BASELINE_REQUEST_DISPATCHED` bounded stall checks are unchanged.
