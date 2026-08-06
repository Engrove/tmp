# EIC Autonom Agent v0.9.7 changelog

## Scope

This bounded unit addresses the field-observed Nano download stall and adds a session-aware rotating application log. It does not claim installation, runtime acceptance, release, deployment or publication.

## Changes

- Added a 180-second material-progress watchdog while the Chrome Prompt API host is in `downloading`.
- The first valid progress observation arms the watchdog.
- Repeated equal progress values, including repeated `0 %`, do not reset the deadline.
- A material increase resets the deadline.
- Progress `1.0` moves admission to `loading` and disarms the download watchdog.
- A stall aborts the in-flight create call and emits `stalled` / `DOWNLOAD_STALLED`.
- The existing 600-second outer host-create watchdog remains unchanged.
- Owner telemetry now includes last progress event, last material progress, progress value, stall deadline and stall timeout.
- Added `eic.autonom.application-log.v1`.
- Application logs are session-aware and may bind host, window, tab, run, mission and correlation identities.
- Logs rotate at 120 entries or 64 KiB per segment and retain at most six segments.
- Rotation exposes dropped-segment and dropped-entry counters.
- Transport secrets, credentials, authorization values and prompt/body fields are redacted before persistence.
- Ordinary snapshots expose only an application-log summary.
- Explicit export schema v14 includes the bounded application log.
- No backward compatibility or migration adapter was added.

## Claim boundary

The implementation and automated verification are source/package claims only. Desktop Chrome behavior remains pending an interactive block/emit acceptance run.
