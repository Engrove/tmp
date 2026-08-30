# v0.11.18 architecture

## Failure boundary

The first v0.11.17 live run reached `CATCH_CAPTURED`, created the canonical baseline request state and
then repeatedly re-entered response-owner handling without delivering the baseline prompt. The
mission Nano analysis had not started. This places the defect before Nano and before any trailer/tag
parser can be relevant.

## Root cause

v0.11.17 correctly transferred the settled catch response from `responseCandidate` into
`pendingObservation`, but SESSION_CATCH ownership did not treat that pending observation as a causal
source before an outbound effect existed. On the next tick the unchanged DOM response could therefore
be admitted as a new candidate. Since RESPONSE_OWNER precedes SESSION_INIT_OWNER, that source
generation could starve baseline dispatch.

The exact causal exclusion set is now:

- `pendingObservation`;
- the source response of the current outbound effect; and
- the last processed response.

None of those identities may simultaneously own an active response-settle generation.

## v0.11.18 ownership repair

`deriveResponseObservationOwner()` projects SESSION_CATCH source hash/identity from
`run.pendingObservation`.

`classifyResponseCandidateOwnership()`:
- rejects page/candidate identities that match the pending observation as `SOURCE_OBSERVATION`;
- rejects a persisted candidate that no longer matches current page evidence as `PAGE_MISMATCH`;
- preserves identity-first equality, allowing a distinct later assistant turn with byte-identical
  rendered text.

`responseObservationCycleInvariant()` rejects a pending observation that is still active as the
response candidate.

The control-plane selector allows RESPONSE_OWNER only for an `ACTIVE` candidate that is not a source
or pending-observation owner.

## Liveness ordering

The existing transient session-init stall check remains 120 seconds. It is moved above
response-settle priority after effect reconciliation, so `CATCH_CAPTURED` and
`BASELINE_REQUEST_DISPATCHED` cannot be hidden indefinitely behind response/Nano/recovery precedence.
No longer timeout, extra retry or fallback model path is introduced.

## Preserved boundaries

No change is made to human-boundary semantics, Nano output/completeness contracts, baseline
correction fencing, execution routing, prompt contracts, effect-journal semantics or Core Surface
Review behavior. Desktop Chrome live acceptance remains a separate owner boundary.
