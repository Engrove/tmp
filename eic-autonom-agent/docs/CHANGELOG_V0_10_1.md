# Changelog v0.10.1

## Fixed

- Removed active four-line EIC-AA/4/legacy response-contract paths from start inspection, protocol repair and archaeology prompts.
- Canonicalized target delivery to one compact JSON envelope with an exact five-line EIC-AA/5 footer.
- Bound mandate references to acknowledged prompt effects rather than PREPARED state.
- Added a default-enabled automatic LanguageModel restart after profile/mandate changes, guarded by availability, prior canary verification and a ten-minute fingerprint cooldown.
- Added default-enabled mission-independent automatic Session Capture for new stable transcript identities.
- Persisted window-level capture/memory summaries so capture no longer requires mission creation to become visible.
- Added one-shot recovery for a lost sidepanel inference that leaves RUNNING telemetry without an owned pending Nano request.
- Rebuilt automatic Nano recreation from the current profile system prompt instead of stale create options.
- Added validator checks and matched block/emit fixtures for all corrected paths.

## Boundaries

No migration or compatibility adapter was added. No extension installation, release, publication or deployment is performed by the source package.
