# Changelog v0.9.11

- Corrected the v0.9.10 language-attestation defect observed in Desktop Chrome.
- Added `expectedOutputs: [{ type: "text", languages: ["en"] }]` to passive
  `LanguageModel.availability()` and every `LanguageModel.create()` path.
- Kept `expectedInputs` absent because the agent can carry multilingual evidence and
  Swedish is not a supported Prompt API language declaration in this Chrome runtime.
- Added `outputLanguages` and `outputLanguageAttested` to Nano-host telemetry v4.
- Advanced the forward-only export contract to `eic.autonom.export.v17`.
- Preserved explicit user activation, canary gating, the 1,200-second asset-progress
  bound, the 1,500-second admission bound and all existing owner/safety gates.
- No backward-compatibility or migration adapter was added.
