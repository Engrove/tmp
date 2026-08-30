# Changelog v0.12.9

v0.12.9 is a repair-only release derived from the exact v0.12.8 browser package.

## Correctness repairs

- Replaces coercive nullable Chrome id validation with `nullableInteger()`. Missing
  window/tab ids no longer become numeric id `0`.
- `writeRuntimeBundle()` now distinguishes omitted window scope from explicit
  root-only scope. Window-close persistence cannot recreate a removed context.
- Worker initialization uses the current audit (`v13`) and continuity (`v5`)
  schema constants instead of stale `v11`/`v4` literals.
- Worker initialization is single-flight.
- `loadBundle()` no longer commits migration/normalization writes from observer
  reads; owner mutations retain the serialized commit path.
- CDP attach now reconciles an existing live session to durable state and
  compensates with detach when post-attach persistence fails.
- Config plus runtime import/rollback persistence uses the same storage commit.
- Session Capture cancellation is signalled before PAUSE/STOP waits on the
  owner queue.
- `autoCaptureInFlight` cleanup covers failure of the STARTED guard write.
- Session Capture commits per-window runtime ownership before refreshing legacy
  global active-id/readiness compatibility mirrors.
- Repeated identical transcript turns keep occurrence identity through ordinal
  binding; the old 240-character fallback collision is removed.
- Sidepanel snapshot refreshes are monotonic: an older response cannot overwrite
  a newer rendered snapshot.
- Full-audit and application-log persistence each have a dedicated serializer.
- Window removal reads existing state without creating a default window context.

## Release discipline

- Version: `0.12.9`.
- Focused repair regression is shipped in
  `tests/v0.12.9-repair-regression.mjs`.
- The release build manifest is regenerated from exact package bytes.
- Desktop Chrome acceptance remains a separate post-install gate.
