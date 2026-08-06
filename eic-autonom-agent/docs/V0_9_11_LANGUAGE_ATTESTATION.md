# v0.9.11 Prompt API language attestation

## Runtime evidence

Desktop Chrome rejected the v0.9.10 activation request because no output language was
specified. The browser listed the supported output languages as `de`, `en`, `es`, `fr`
and `ja`. Swedish is not a supported Prompt API output declaration in this runtime.

## Current contract

- Use only `globalThis.LanguageModel`.
- Use English (`en`) as the internal Nano output language.
- Pass `expectedOutputs: [{ type: "text", languages: ["en"] }]` to every
  `LanguageModel.availability()` and `LanguageModel.create()` call.
- Do not declare Swedish output.
- Do not declare `expectedInputs`: the agent can carry multilingual evidence and must
  not falsely attest that all input is English or pass an unsupported Swedish code.
- The activation create remains synchronous inside explicit user activation.
- The canary and durable base sessions use the same output-language contract.
- User-facing Swedish remains the responsibility of the target ChatGPT session, not
  the local Nano transport contract.

## Claim boundary

This contract removes the browser-reported language-attestation error. It does not by
itself prove that Chrome model assets are available or that a canary inference succeeds.
