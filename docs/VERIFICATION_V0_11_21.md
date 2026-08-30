# Verification v0.11.21

## Claim boundary

This document covers source/package verification only. It does not claim Desktop Chrome
installation, installed-byte identity, live runtime acceptance or production readiness.

## Focused requirements

1. Current source resolves role-bearing nodes to a safe conceptual conversation-turn owner.
2. Multiple assistant role fragments under that owner deduplicate to one message entry.
3. Mixed-role containers do not become a shared owner.
4. Timed completed reasoning disclosure `Arbetade i 51 sekunder >` is classified as lifecycle UI.
5. English timed reasoning disclosure is classified equivalently.
6. A real `eic.main-task-baseline.v2` payload is not classified as lifecycle UI.
7. Canonical response extraction reads the safe turn owner and preserves `pre`/`code` visibility.
8. Runtime page-state selection and Session Capture use the same canonical entry path.
9. A live-shaped v0.11.20 failure fixture with a reasoning fragment plus final baseline no longer
   selects the 24-character reasoning fragment as the semantic response.
10. `parseMainTaskBaseline()` accepts the preserved valid baseline payload after lifecycle filtering.
11. Release/config/runtime/export/storage/Session DB/alarm identities are internally coherent.
12. Existing JavaScript/MJS source parses.
13. Every JSON file parses.
14. State registry remains complete for source-declared enumerations.
15. Package file hashes, canonical package digest and ZIP structure reproduce from a fresh package
    extraction.

## Regression boundary

The patch must not alter:
- v0.11.20 runtime-root receipt persistence/readback;
- post-transition boundary identity;
- genuine human-boundary enforcement;
- bounded no-effect USER_PAUSE internalization;
- post-READY baseline handoff projection;
- v0.11.19 conversation isolation, Session Memory provenance, protocol parsing, passive external
  wait, retry-fence rotation and terminal Nano ownership.

## Live acceptance remains required

Local/source fixtures cannot prove the current ChatGPT rendered DOM. The exact packaged v0.11.21 ZIP
must be loaded into Desktop Chrome and tested through baseline delivery -> conceptual response
extraction -> baseline Nano ACCEPT -> READY before any production-unblock claim.
