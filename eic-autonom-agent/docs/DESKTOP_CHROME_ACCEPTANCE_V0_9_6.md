# Desktop Chrome acceptance — v0.9.6

Use a fresh unpacked browser package.

## A. Identity and idle gate

1. Load the unpacked v0.9.6 build from a versioned directory.
2. Verify the extension ID remains the same when the same manifest key is reused in a later build.
3. Link a ChatGPT controller tab.
4. Before Nano is ready, verify **Starta valt uppdrag** is disabled.

## B. Host activation

1. Click **Kontrollera / aktivera Nano** once.
2. Export during activation.
3. Verify telemetry contains:
   - `schema=eic.autonom.nano-host-telemetry.v1`
   - non-empty `hostId`
   - `busy=true`
   - `createStartedAt` and `createDeadlineAt`
   - a current status other than `unknown`.
4. If Chrome downloads the model, verify percentage changes only from download events.
5. At 100%, verify the UI switches to **Extraherar / läser in…** with indeterminate progress.
6. Verify a second activation click aborts the single pending create operation rather than starting another.

## C. Ready emit twin

1. Activate again and wait for **KLAR**.
2. Verify telemetry reports `status=available`, `availability=available`, `busy=false`.
3. Verify **Starta valt uppdrag** becomes enabled.
4. Start one continuation mission.
5. Export and verify a non-null Nano attempt/trace with positive input, actual start time and transport.

## D. Block twins

- `unavailable`: mission start remains disabled.
- `timeout`: watchdog reports TIMEOUT, mission remains absent, and retry is available.
- `aborted`: mission remains absent and activation can be retried.
- no session despite stale `available` telemetry: mission remains disabled.

## Claim boundary

PASS requires direct Desktop Chrome observation and export readback. Source/package tests alone are insufficient.
