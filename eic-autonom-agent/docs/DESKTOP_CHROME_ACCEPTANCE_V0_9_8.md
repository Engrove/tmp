# Desktop Chrome acceptance v0.9.8

## Block path

1. Load the unpacked browser profile and open the sidepanel.
2. Confirm `Starta valt uppdrag` is disabled before LanguageModel readiness.
3. Click the LanguageModel activation button once.
4. Before positive progress, confirm:
   - badge/status is `PREPARING_ASSETS`;
   - progress is indeterminate;
   - the UI does not claim that a download is active.
5. If no positive progress occurs for 1,200 seconds, confirm:
   - status is `EXTERNAL_MODEL_ASSET_BLOCKER`;
   - automatic retry does not start;
   - Start remains disabled;
   - the UI points to `chrome://on-device-internals`.
6. Export state and verify the application log contains the same application session,
   host, window and correlation identity across admission start, availability,
   asset preparation, blocker and settled events.

## Emit path

1. Activate the LanguageModel where Chrome has runnable assets.
2. Confirm `DOWNLOADING` appears only after progress is greater than zero.
3. Confirm each material increase extends the 1,200-second deadline.
4. Confirm 100 percent enters `LOADING`, not a stalled state.
5. Confirm `AVAILABLE` enables `Starta valt uppdrag`.
6. Start a continuation mission and export:
   - non-null mission/run;
   - non-null Nano attempt/trace;
   - positive input count;
   - actual start timestamp and transport;
   - no deterministic takeover bypass.

## Claim boundary

Passing Node tests and packaging do not prove Chrome asset availability,
model installation, runtime inference, mission execution, release or deployment.
