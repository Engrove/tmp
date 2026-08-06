# v0.9.10 Prompt API activation contract

## Verified source basis

Verified 2026-08-05 against current Chrome/Chromium primary sources:

- Chrome Prompt API documentation: https://developer.chrome.com/docs/ai/prompt-api
- Chrome built-in AI get started guide: https://developer.chrome.com/docs/ai/get-started
- Chrome Prompt API extension sample: https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/ai.gemini-prompt-api
- Extension sample side panel: https://github.com/GoogleChrome/chrome-extensions-samples/blob/main/functional-samples/ai.gemini-prompt-api/sidepanel.js
- Extension sample manifest: https://github.com/GoogleChrome/chrome-extensions-samples/blob/main/functional-samples/ai.gemini-prompt-api/manifest.json
- Model download UX: https://developer.chrome.com/docs/ai/inform-users-of-model-download
- Built-in AI best practices: https://developer.chrome.com/docs/ai/best-practices
- Built-in model debugging: https://developer.chrome.com/docs/ai/debug-built-in-model

## Source-derived contract

The current extension API is `globalThis.LanguageModel`. Chrome extensions are supported from Chrome 138. `LanguageModel.availability()` is a passive readiness probe. When model assets may need download, `LanguageModel.create()` must be initiated from an explicit user activation. The create monitor emits `downloadprogress`.

The official extension sample calls `LanguageModel.create()` directly from its UI event and does not route through `globalThis.ai.languageModel`. Capability declarations, sampling options and `initialPrompts` are optional.

## v0.9.10 activation design

1. Panel initialization may call `LanguageModel.availability()` with no options. It never starts a mission or claims a model session.
2. The explicit activation button calls `LanguageModel.create()` synchronously before any `await`, storage write, hash, message hop or second readiness call.
3. The admission create receives only `monitor` and `AbortSignal`. It receives no EIC mandate, language declaration, expected modality, sampling setting or legacy-provider option.
4. A resolved native session must produce a non-empty bounded canary response within 120 seconds.
5. The admission session is destroyed after the canary. It is never promoted to the durable base.
6. A clean base session is then created with the EIC system mandate in `initialPrompts`.
7. Mission start remains disabled until the clean base is available, non-stale and canary-verified.
8. Task execution clones the base when supported; otherwise it creates a fresh standard LanguageModel session with the same mandate options.

## Project-specific inference

The canary and clean-base split is an EIC design choice, not a Chrome requirement. It makes two claims separately verifiable:

- Chrome can execute a real local prompt.
- EIC can create a clean mandate-bound base without contaminating it with the admission canary.

After successful canary inference, creating a clean base without a second user gesture is treated as valid because the model is already available. Desktop Chrome acceptance remains required to verify this behavior on the target host.

## Fail-closed states

- Missing `LanguageModel`: `UNAVAILABLE`.
- Missing active user gesture: `USER_ACTIVATION_REQUIRED`.
- Asset preparation without positive progress for 1,200 seconds: `EXTERNAL_MODEL_ASSET_BLOCKER`.
- Positive download progress followed by 1,200 seconds without material increase: `DOWNLOAD_STALLED`.
- Native create over 1,500 seconds: `CREATE_TIMEOUT`.
- Empty or failed canary: `CANARY_FAILED`.
- Canary over 120 seconds: `CANARY_TIMEOUT`.

No automatic mission start, provider fallback or compatibility adapter is permitted.
