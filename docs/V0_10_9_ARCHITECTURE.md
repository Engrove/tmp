# v0.10.9 architecture — universal session-context initialization

## Problem

v0.10.8 observed the target response and started `TAKEOVER_BOOTSTRAP`, but the initial main-task request was left to model output. Nano returned the symbol `baselineRequestPrompt` instead of the canonical prompt, validation rejected the result, deterministic recovery used an action-shaped stop criterion, and a later stream remained non-terminal until the long wall timeout.

## State machine

Every start creates `eic.autonom.session-context-init.v1`:

1. `WAITING_CHAT_READY`
2. `CATCH_ARMED`
3. `CATCH_CAPTURED`
4. `BASELINE_REQUEST_DISPATCHED`
5. `WAITING_BASELINE_RESPONSE`
6. `NANO_ANALYZING`
7. `READY`

`FAILED` is terminal for a bounded initialization failure.

Manual starts and Autostart use the same gate. A special mission is stored as a deferred mission request and starts only after initialization reaches `READY`.

## Catch ownership

The current ChatGPT page is read before mission execution. If the page is generating, background-active or ends in a user turn, the app waits. When one complete stable assistant response exists, its response identity is bound as the catch observation.

## Deterministic baseline request

When no valid baseline exists, `MAIN_TASK_BASELINE_REQUEST_PROMPT` is inserted directly into a deterministic decision. The initial prompt is not authored or shortened by Nano. The prompt is the only prompt allowed through the initialization dispatch gate.

After the target responds with a valid `eic.main-task-baseline.v1` object, Nano analyzes track alignment, 80/20 and global-skill routing context. Fast paths remain disabled until this analysis completes.

## Universal effect gate

`executePreparedEffectUnlocked` rejects every ordinary prompt while session initialization is not `READY`. The only exception is `SESSION_CONTEXT_BASELINE_REQUEST`. This is the final prompt-dispatch choke point, so special-mode and recovery paths cannot bypass initialization.

## Host lifecycle

Streaming uses a bounded next-chunk idle deadline. A task session that has produced output but does not reach terminal completion is aborted with `HOST_STREAM_STALLED`. Existing task retry policy permits at most one fresh-session retry.

## Overlay

The content script renders a translucent, extension-owned overlay with phase, detail and progress. It is excluded from transcript scans through `data-eic-own-ui=true`. Closing the overlay stores a dismissal only for the current `needKey`. A new phase or later need receives a different key and is shown again.

The overlay is a derived view and never owns runtime state.
