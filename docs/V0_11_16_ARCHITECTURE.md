# v0.11.16 architecture

## Response-settle owner drain

The persisted response candidate remains the durable owner state introduced in v0.11.15.
After effect reconciliation, a same-identity candidate with trusted terminal protocol evidence
gets response-settle priority when its persisted probe is due or its settle deadline is overdue.

That priority is evaluated after effect ACK reconciliation but before autonomous Nano recovery,
session-init recovery, deterministic fallback and other continuation branches that can otherwise
return early. Those branches are deferred for that tick until the candidate is either processed
or bounded-failed.

## Bounded terminal outcome

Trusted terminal protocol completion never receives an unbounded grace period.

- before the deadline, the candidate may schedule another durable probe;
- at or after the deadline, an unchanged authoritative candidate must either be processed or
  record `eic.autonom.response-settle-failure.v1` /
  `RESPONSE_SETTLE_LIVENESS_TIMEOUT` and transition terminally;
- a terminal response that is settled but remains completion-policy-ineligible is also typed-failed
  after the deadline rather than polled forever.

True foreground streaming/composer-busy evidence never receives owner-drain priority.

## Completion threshold

`protocolCompletionOverride` is authoritative terminal evidence. Such a response uses the normal
settle threshold even if the page has not set `latestAssistantComplete=true`. This avoids requiring
an extra soft-candidate read after the protocol trailer already proves bounded completion.

## Core Surface Review no-op normalization

A proposed config patch is material only when the same setting has a corresponding
`CHANGE_RECOMMENDED` or `MANUAL_REVIEW` finding. `OK` findings cannot carry a material patch.

An explicit `NO_CHANGE` verdict suppresses config and surface changes even if stray structured
fields are populated. The canonical proposal therefore becomes `NO_CHANGE`, is stored as already
resolved, and cannot create a `MATERIAL` owner event.

## Human boundaries

No owner-bound action/decision transition semantics changed in this release.
v0.11.13 receipt-only exits remain authoritative.
