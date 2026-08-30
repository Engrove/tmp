# Verification v0.11.18

## Claim boundary

This document covers source/package verification only. It does not claim Desktop Chrome installation,
runtime behavior or production acceptance.

## Required source checks

1. Exact v0.11.17 incident fixture classifies the duplicated catch response as
   `SOURCE_OBSERVATION`, clears the candidate, blocks candidate admission and marks the page as source.
2. Candidate-to-pendingObservation transfer remains atomic.
3. A page-mismatched persisted candidate classifies as `PAGE_MISMATCH`.
4. A distinct assistant response identity remains admissible even when its rendered hash matches a
   prior response.
5. RESPONSE_OWNER is unreachable for source/pending-observation ownership.
6. `CATCH_CAPTURED` is not stalled at 119999 ms and typed-fails at/after 120000 ms.
7. `BASELINE_REQUEST_DISPATCHED` has the equivalent bounded typed failure.
8. The state registry contains every source-owned enum value and records 45 groups / 299 values.
9. All JavaScript/ESM sources pass `node --check`; all JSON files parse.
10. `background.js` contains no raw `run.responseCandidate = null` lifecycle clear.

## Packaging

After `build-info.json` is regenerated from the final payload:

- every payload file SHA-256 must match `build-info.json`;
- `packageDigest` is SHA-256 of canonical JSON `{"files": <sorted file->sha256 map>}`;
- ZIP entries must have no duplicates, unsafe paths, symlinks or encryption;
- ZIP CRC must pass;
- the same focused ownership, stall, state-space, syntax and JSON checks are repeated against a fresh
  extraction.

Desktop Chrome live acceptance is required before runtime or production PASS.
