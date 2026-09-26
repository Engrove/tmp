# GFW operating delta — Greenfield v1.8.8

This is version-bound client knowledge, not a live client attestation or a new
permission source. Use the current operative responseContract and exact runtime
owner receipts for actions. The source baseline is P63 artifact12194 (v1.8.7);
the v1.8.8 patch and build receipt describe the changed implementation.

## Changed recovery behavior

1. The stale-session 30/60/90/120-minute ladder may be deferred while a fresh
   page snapshot reports generating=true AND stopVisible or streaming=true.
   The generation grace ends no later than four hours from the acknowledged
   prompt's send time. composerBusy alone is insufficient. A completed response
   still goes through normal causal response capture.
2. When several ladder milestones are overdue, allow at least 60 seconds after
   an actual recovery request before the next destructive step. Original
   milestones remain nominal deadlines, not a reason to storm the renderer.
3. A bound process GPT, then the remembered EIC GPT, wins over an incidental
   different GPT active in the tab. No known EIC root still uses the existing
   EIC_GPT_ROOT_UNKNOWN path; no generic-root fallback is introduced.
4. An empty redirected landing page is not recovery of an unanswered thread.
   Preserve and revisit the known conversation URL. Missing historical identity
   remains unknown; never reconstruct it or replay an unknown effect blindly.

The overlay's generation grace is a client recovery budget, NOT mission
pauseUntil and NOT remaining quantum or provider compute time. No new
runtimeControl action for generation grace exists.

## Unchanged controls

SET_SCHEDULE is own-slot; duplicates elsewhere may still run. SET_QUANTUM affects
the next quantum. Operator ceilings, model eligibility (including the unchanged
Pro policy), in-flight quality quarantine and unknown-effect fences remain.
A source change is not permission to force rotations, weaken safety, restart
other workers or widen a mission mandate.

## Uptake

Consume this delta at the next ordinarily eligible boundary, not by waking
closed slots. Check actual sender/version and current advertised contracts;
older envelopes remain valid. GF-045 should inspect actual behavior/receipts and
avoid interpreting a generation deferral as a broken schedule. GF-056 remains
periodic/q1/background and is not entitled to bypass its pauseUntil. The maximum
one full GF-056 risk review per rolling 24 hours is unchanged. GF-055 may use
these mechanisms in its existing succession inventory.

No change to the HUMAN_OPERATOR general plan, in-flight P0 scope, queue
membership or fleet priorities is authorized by this document.
