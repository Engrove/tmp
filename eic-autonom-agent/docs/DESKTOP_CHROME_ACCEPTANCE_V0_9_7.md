# Desktop Chrome acceptance — v0.9.7

## Preconditions

- Load the v0.9.7 browser package under the stable extension identity.
- Open a supported ChatGPT controller tab.
- Keep `chrome://on-device-internals` available for owner-side diagnosis.
- Do not start a mission until Nano is `KLAR`.

## Block twin — stalled download

1. Start Nano activation in an environment where model download remains at the same value.
2. Confirm `Starta valt uppdrag` is disabled.
3. Confirm the application log records:
   - `nano.host.create-started`;
   - the first material progress event;
   - the exact stall deadline.
4. Wait 180 seconds without a larger progress value.
5. Confirm:
   - UI becomes `STANNAT`;
   - reason is `DOWNLOAD_STALLED`;
   - create is aborted;
   - no mission or run is created;
   - export contains the session-aware log and stall telemetry.

## Emit twin — progressing download and available host

1. Start Nano activation.
2. Confirm larger progress values reset the stall deadline.
3. At 100 %, confirm UI changes to indeterminate `LÄSER IN`.
4. Confirm the 180-second download watchdog is disarmed while loading.
5. When Chrome returns a session, confirm status `KLAR`.
6. Confirm `Starta valt uppdrag` becomes enabled only then.
7. Start one continuation mission and export state.
8. Confirm a non-null Nano trace with positive input size, actual start time and transport.

## Application-log checks

- Entries share one application-session ID across ordinary service-worker restarts within 30 minutes.
- Panel/host, window, run and mission identities are present where applicable.
- Segment rotation remains at six segments maximum.
- Dropped counters increase when old segments are evicted.
- No credentials, bearer tokens, session locators, prompt bodies or response bodies appear.
- Ordinary snapshot traffic carries only the log summary; explicit export carries the bounded log.

## Stop

Stop after block and emit twins. Do not merge, release, deploy or publish from this acceptance run.
