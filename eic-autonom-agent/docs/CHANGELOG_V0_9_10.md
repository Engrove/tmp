# Changelog v0.9.10

## Corrected

- Removed the unsupported `LEGACY_NATIVE_FIRST` policy and all active `ai.languageModel` selection.
- Raised the manifest floor to Chrome 138.
- Separated passive availability probing from native model activation.
- Made the actual `LanguageModel.create()` call the first native model operation in the explicit activation click.
- Reduced admission create options to `monitor` and `AbortSignal`.
- Removed `expectedInputs`, `expectedOutputs`, sampling settings and mandate text from admission.
- Added a 120-second local inference canary.
- Added a clean mandate-bound base session after canary success.
- Prevented mission start from initiating model creation.
- Required canary evidence for base-session reuse and task-session admission.
- Advanced Nano-host telemetry to v3 and export to v16.
- Added user-activation, preflight and canary evidence to the session-aware rotating application log.

## Preserved

- Forward-only policy.
- 1,200-second material-progress watchdog.
- 1,500-second outer create watchdog.
- Trusted-session, owner-route, effect, claim and completion gates.
- No automatic provider fallback or mission retry.
