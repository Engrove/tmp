# Desktop Chrome acceptance v0.9.11

1. Load the browser build as an unpacked extension.
2. Open extension errors and clear prior entries.
3. Open the side panel and run the passive Prompt API preflight.
4. Activate LanguageModel once from the explicit button.
5. Verify no error says that output language is missing.
6. Export runtime state and verify:
   - `schema = eic.autonom.export.v17`;
   - Nano telemetry schema v4;
   - `outputLanguages = ["en"]`;
   - `outputLanguageAttested = true`;
   - provider is `LanguageModel`.
7. If assets are available, require `canaryVerified=true` and `status=available`.
8. Start one continuation mission and require a real Nano attempt trace.

A language-clean activation is not a model-availability claim until canary and session
readback are present.
