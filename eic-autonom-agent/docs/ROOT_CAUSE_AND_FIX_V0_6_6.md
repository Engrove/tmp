# Root cause and fix — v0.6.6

## Scope

This release addresses two desktop-Chrome defects observed in the installed v0.6.5 extension:

1. the Prompt API session declared Swedish (`sv`) although the active Chrome LanguageModel capability did not accept that language identifier;
2. an old content-script `MutationObserver` continued calling `chrome.runtime.sendMessage()` after Chrome invalidated the extension context during reload or update.

## Root cause 1 — unsupported Nano language declaration

`MODEL_OUTPUT_OPTIONS` declared both `sv` and `en` for text input and output. `LanguageModel.availability()` and `LanguageModel.create()` receive these options, so an unsupported language can reject the session before inference.

### Fix

The declared Prompt API capability is English-only:

```js
expectedInputs: [{ type: "text", languages: ["en"] }]
expectedOutputs: [{ type: "text", languages: ["en"] }]
```

The same options are still supplied to `availability()` and `create()`. Swedish ChatGPT content remains quoted untrusted target material inside the English controller prompt; it is not advertised as a browser capability.

## Root cause 2 — synchronous invalid-context exception

The previous implementation attached `.catch()` directly to `chrome.runtime.sendMessage()`. After an extension reload, the call can throw synchronously with `Extension context invalidated` before a Promise exists. The `.catch()` therefore never runs.

### Fix

`scheduleDirty()` now:

- checks that `chrome.runtime.id` is available;
- wraps `sendMessage()` in `try/catch`;
- handles asynchronous rejection through `Promise.resolve(pending).catch(...)`;
- stops its timer, observer and badge when the context is invalid.

## Root cause 3 — stale same-version bridge

The bootstrap returned early when a bridge with the same version already existed. After a same-version extension reload, that object could belong to an invalidated context and prevent a fresh listener from being installed.

### Fix

Every injection disposes the previous bridge and installs a new bridge. Reinjection is therefore self-healing even when the version string is unchanged.

## Safety boundary

The fix does not claim that Chrome reloads the ChatGPT tab automatically. A tab that still hosts an invalidated content-script context may need a normal page reload before the new extension context is active. The code change prevents repeated console errors and allows programmatic reinjection to replace a stale bridge.
