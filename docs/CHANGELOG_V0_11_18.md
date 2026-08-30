# Changelog v0.11.18

## Fixed

- Prevented a captured SESSION_CATCH assistant response from being re-admitted as the next active `responseCandidate` before the baseline effect exists.
- `pendingObservation` is now part of the causal source exclusion set used by response ownership classification.
- Persisted candidates that no longer match the current page response are retired as `PAGE_MISMATCH`.
- RESPONSE_OWNER can no longer win control-plane precedence for a source/pending-observation generation.
- The existing 120-second `CATCH_CAPTURED` / `BASELINE_REQUEST_DISPATCHED` stall invariant is evaluated independently of response/Nano/recovery priority.

## Preserved

- No timeout increase, retry loop, Nano restart, tag/parser tolerance or baseline bypass was added.
- Identity-first response matching remains authoritative, so a genuinely new assistant turn with byte-identical rendered text is still admissible.
- v0.11.17 atomic `RESPONSE_CANDIDATE -> PENDING_OBSERVATION` transfer and effect-source ownership remain intact.
- Human-boundary, baseline-correction, execution-routing, prompt-contract, effect-journal and Core Surface Review semantics remain unchanged.

## Added

- `PAGE_MISMATCH` response candidate disposition.
- v0.11.18 source-derived state registry and release documentation.
