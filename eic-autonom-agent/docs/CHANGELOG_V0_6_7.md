# Changelog v0.6.7

## Dynamic WAITING trigger

- Added DOM-ordered `latestMessageRole` and `latestMessageHash`.
- Added trailer-independent `latestAssistantCandidate`.
- Added role-first trigger rule: latest user prompt waits; latest stable assistant response processes.
- Changed `WAITING` activation so an existing assistant response is armed instead of discarded as baseline.
- Prevented a new user task fingerprint from reprocessing the previous assistant body.
- Added dynamic completion state for stale Stop/composer-busy UI.
- Preserved explicit streaming and trusted background-task blocking.
- Added three-read/four-second stability policy for soft-busy assistant candidates.
- Added a self-scheduled response stability probe.
- Kept EIC trailer parsing as an optional deterministic fast path, not a trigger prerequisite.
- Added deterministic v0.6.7 regression fixtures.
