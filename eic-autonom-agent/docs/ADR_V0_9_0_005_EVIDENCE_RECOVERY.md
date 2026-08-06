# ADR 005 — Bounded evidence and fail-closed recovery

## Status
Accepted for v0.9.0 planning.

## Decision
Browser observations and effects produce bounded receipts and evidence references. Sensitive
headers/fields are redacted before persistence or prompt delivery. Recovery after navigation,
reload, worker restart, debugger detach or origin change requires fresh identity and permission
checks.

## Rationale
Screenshots and F12-like data can contain secrets and can become stale after document changes.

## Consequences
WP07, WP10 and WP11 must enforce quotas, redaction, epoch binding, explicit origin approval and
readback. Metadata alone cannot prove screenshot delivery or response-body content.
