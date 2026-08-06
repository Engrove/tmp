# Desktop Chrome Acceptance v0.9.9

1. Load the v0.9.9 browser package as an unpacked extension.
2. Open the side panel and export state before activation.
3. Confirm the Start button is disabled.
4. Click `Kontrollera / aktivera Nano` once.
5. Export state after admission settles.
6. Verify provider telemetry:
   - policy `LEGACY_NATIVE_FIRST`;
   - inventory includes every detected native provider;
   - selected `modelKind` is `ai.languageModel` when present;
   - provider contract is `LEGACY_NATIVE_PROMPT_API` for that route.
7. Verify status becomes `available` and Start becomes enabled.
8. Start one continuation mission.
9. Export state after the first Nano decision.
10. Verify a real Nano attempt trace with positive input, `startedAt`, duration and provider-bound host identity.
11. Fail the acceptance if the result is only deterministic recovery, if no session is created, or if the app remains in asset preparation while `ai.languageModel` was detected.

No release, deployment or publication is part of this checklist.
