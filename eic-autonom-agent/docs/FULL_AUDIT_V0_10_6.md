# Optional full audit sink — v0.10.6

## Default

`fullAuditLoggingEnabled=false`.

## Windows directory

The extension does not create or scan `C:\temp`. To enable filesystem logging, the operator selects the already-existing directory with Chrome's directory picker. Browser File System Access exposes a granted handle and directory name, not a trustworthy absolute Windows path. The operator is responsible for selecting the actual `C:\temp`.

## Format and bounds

- UTF-8 NDJSON.
- Redacted before queueing.
- Queue maximum: 2,000 entries.
- Batch maximum: 200 entries.
- Segment maximum: 4 MiB.
- Retention maximum: eight v0.10.6 segments.
- Write acknowledgement occurs only after the file write closes.
- Queue/storage/sink failures are fail-soft for the mission runtime.

## Event classes

The sink receives redacted application/audit events, UI command boundaries, runtime/continuity storage readback, Nano lifecycle, capture, recovery and errors. It is diagnostic evidence only and does not promote external claims.

## Sensitive data boundary

Prompt bodies, credentials, tokens, cookies, signed URLs, carrier/session secrets and raw hidden reasoning are excluded or redacted. Full audit means full bounded diagnostic coverage, not unrestricted payload capture.
