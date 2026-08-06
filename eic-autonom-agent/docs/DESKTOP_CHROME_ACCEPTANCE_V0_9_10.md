# Desktop Chrome acceptance v0.9.10

## Preconditions

- Chrome 138 or later.
- v0.9.10 browser package loaded as unpacked extension.
- Side panel open.
- No active mission.
- `Starta valt uppdrag` disabled before model readiness.

## Emit path

1. Open the panel.
2. Verify passive preflight reports the current `LanguageModel.availability()` state.
3. Click `Kontrollera / aktivera LanguageModel` once.
4. Export after activation settles.
5. Require:
   - `providerPolicy=STANDARD_LANGUAGE_MODEL_ONLY`;
   - `modelKind=LanguageModel`;
   - `providerContract=CHROME_EXTENSION_PROMPT_API_MINIMAL_V1`;
   - `userActivationActiveAtStart=true`;
   - `canaryStartedAt` and `canaryCompletedAt`;
   - `canaryOutputChars>0`;
   - `canaryVerified=true`;
   - `status=available`.
6. Start one continuation mission.
7. Require a real Nano attempt trace with positive input, `startedAt`, non-deterministic transport and no repair-only substitution.

## Block paths

- No `LanguageModel`: `UNAVAILABLE`.
- Create outside active click: `USER_ACTIVATION_REQUIRED`.
- No positive asset progress for 1,200 seconds: `EXTERNAL_MODEL_ASSET_BLOCKER`.
- Positive progress stalls for 1,200 seconds: `DOWNLOAD_STALLED`.
- Create exceeds 1,500 seconds: `CREATE_TIMEOUT`.
- Canary empty/fails: `CANARY_FAILED`.
- Canary exceeds 120 seconds: `CANARY_TIMEOUT`.

Every block path must leave mission start disabled and write one bounded session-aware application-log chain.

## Owner evidence

Attach the v16 runtime export. For Chrome-owned asset failures, also attach the Event Logs dump from `chrome://on-device-internals`.
