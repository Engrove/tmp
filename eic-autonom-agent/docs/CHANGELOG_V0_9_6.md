# EIC Autonom Agent v0.9.6 — changelog

## Nano-host admission

- `LanguageModel.create()` begins synchronously in the operator click stack; no async digest or other `await` precedes it.
- At most one host-create operation may exist at a time.
- Host creation is bound to an `AbortController` and a ten-minute watchdog.
- Availability, download, loading, available, timeout, aborted and error are separate states.
- Download progress is shown only for actual `downloadprogress` events. After 100%, the UI switches to indeterminate extraction/loading.
- Nano-host status, availability, progress and create timestamps are persisted as bounded runtime telemetry.
- Every mission requiring Nano is disabled until a non-stale session is actually available.
- The activation button becomes an explicit abort control while host creation is pending.

## Development identity

`manifest.json` carries one stable public development key so unpacked builds loaded from versioned directories retain the same extension identity. The key is public identity material, not a signing secret.

## Boundaries

- Forward-only policy remains active.
- No compatibility adapter or migration path was added.
- No release, deployment, installation or Chrome runtime result is implied by source/package verification.
