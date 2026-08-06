# Desktop Chrome acceptance — v0.6.6

## Nano language

1. Load the unpacked v0.6.6 extension.
2. Open the side panel and activate Nano from a user gesture.
3. Confirm that `LanguageModel.availability()` and `LanguageModel.create()` do not report an unsupported `sv` language option.
4. Run one analysis containing Swedish target-session text and confirm that the controller still returns its constrained result.

## Extension reload lifecycle

1. Keep a supported ChatGPT tab open with the content bridge active.
2. Reload the unpacked extension from `chrome://extensions`.
3. Mutate the ChatGPT DOM or wait for a mutation.
4. Confirm that no repeated `Uncaught Error: Extension context invalidated` is added by `content.js`.
5. Trigger a new bridge read from the side panel; reload the ChatGPT tab if Chrome has not yet installed the new content-script context.
6. Confirm that `EIC_PING` reports version 0.6.6 and a fresh `documentEpoch`.

## Acceptance boundary

Passing these steps verifies this desktop profile and Chrome build only. It does not establish universal Prompt API language support or production deployment.
