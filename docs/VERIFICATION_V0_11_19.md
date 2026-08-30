# Verification v0.11.19

## Claim boundary

This document covers source/package verification only. It does not claim Desktop Chrome installation,
runtime behavior or production acceptance.

## Required focused checks

1. A conversation locator change clears conversation-owned baseline/intent/work-unit/claims while
   rebinding the new locator/task fingerprint.
2. Same-conversation locator reconciliation does not erase current task state.
3. Every new mission clears the prior main-task baseline and re-enters baseline requested state.
4. The removed stale-baseline fallback cannot force an ordinary response into `NANO_ANALYZING`.
5. Fenced/rendered `eic.main-task-baseline.v2` parses structurally with the EIC-AA trailer present.
6. Known-incomplete canonical response extraction is not Nano-eligible and cannot advertise complete
   baseline response recovery.
7. Session Memory rejects summaries outside the current conversation/capture/turn set and cannot
   evaluate `RESET_REQUIRED` memory as FRESH.
8. Both pre-delivery and post-delivery operator retries rotate `needKey` and reset the exhausted
   baseline correction fence/generation; post-delivery reconcile preserves delivered anchors.
9. The protocol parser accepts explanatory earlier protocol examples plus the final exact trailer
   followed only by EIC metadata; semantic prose after the trailer remains rejected.
10. A true external dependency enters passive `WAIT_EXTERNAL_EVENT`, not `PROGRAM_BLOCKED`, and does
    not prepare a chat-control continuation.
11. Transcript Capture excludes transient `request-placeholder-*` assistant turns.
12. Baseline-correction exhaustion calls the shared Nano terminal finalizer before returning, so
    deferred Capture can be rearmed.
13. v0.11.18 response-owner CATCH causal exclusion remains in source.
14. All JavaScript/ESM sources pass `node --check`; all JSON files parse.

## Packaging

After `build-info.json` is regenerated from the final payload:

- every payload file SHA-256 must match `build-info.json`;
- `packageDigest` is SHA-256 of canonical compact JSON `{"files": <sorted file->sha256 map>}`;
- ZIP entries must have no duplicates, unsafe paths, symlinks or encryption;
- ZIP CRC must pass;
- focused checks are repeated against a fresh extraction.

Desktop Chrome live acceptance remains required before runtime or production PASS.
