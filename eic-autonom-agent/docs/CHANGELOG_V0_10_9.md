# Changelog v0.10.9

## Fixed

- All manual and Autostart mission paths now enter one universal session-context initialization gate.
- Startup first inspects the linked ChatGPT state and waits until a stable session catch can be armed.
- The initial `eic.main-task-baseline.v1` request is dispatched deterministically by application code.
- The symbolic `baselineRequestPrompt` failure path is removed from the initial intake.
- Ordinary prompts, special modes and effects wait until catch, baseline response and Nano analysis are complete.
- Takeover fallback stop criteria are state-shaped rather than imperative actions.
- A non-terminal Nano stream is aborted after a bounded material-output idle interval and retried at most once with a fresh task session.
- ChatGPT receives a closable translucent process overlay scoped to the current need key.

## Compatibility

v0.10.9 is current-version-only under the v0.9.3 forward-only policy.
