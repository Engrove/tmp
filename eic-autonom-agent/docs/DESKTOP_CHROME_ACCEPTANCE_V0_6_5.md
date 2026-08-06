# Desktop Chrome acceptance — v0.6.5

Local tests do not prove browser installation, current ChatGPT DOM behavior or Prompt API runtime behavior. Perform these checks in the actual target browser after loading the unpacked v0.6.5 package.

## Build identity

1. Load the unpacked extension.
2. Confirm sidepanel displays v0.6.5.
3. Export state.
4. Confirm `appVersion` and `build.version` are `0.6.5`.
5. Confirm `build.packageDigest` is non-empty.

## Protocol completion with trailing UI text

1. Produce a turn-bound `DONE` answer with the four contract lines.
2. Ensure the rendered page has one or more benign UI/tool lines after the answer.
3. Confirm the observation reports a valid target result and protocol completion candidate.
4. Confirm the run completes or applies the deterministic protocol path without a Nano detour.

## Nano dispatch concurrency

1. Keep the sidepanel open with polling enabled.
2. Trigger a Nano assessment lasting longer than one poll interval.
3. Confirm exactly one `NANO_CLAIM` is recorded for the request.
4. Confirm no repeated `RUNNING` claim errors and no lock reset while inference streams.

## Input-budget fail-closed behavior

1. Use a constrained host/context condition that makes the final measured prompt exceed budget.
2. Confirm no prompt/promptStreaming model call starts for that over-budget candidate.
3. Confirm `NANO_FAILURE` records `NanoBudgetExceededError`.
4. Confirm deterministic recovery or a bounded pause follows.

## Swedish destructiveness

Classify:

`Utför merge till main endast för exakt verifierad snapshot; stoppa före release och deployment.`

Expected:

- level 9;
- Hjalmar mental control required;
- no level-1 `READ_ONLY` fallback.

Classify an unknown non-empty action.

Expected:

- `UNCLASSIFIED`;
- level 6;
- Hjalmar mental control required.

## Audit

Inject or trigger a sidepanel pipeline error.

Expected:

- visible sidepanel error;
- exported audit contains an `error` entry with matching bounded detail.

## No-progress

1. Replay eight distinct decisions with deterministic progress 0.
2. Confirm transition to `SOFT_PAUSED`.
3. Confirm origin is `NO_PROGRESS_BUDGET_EXHAUSTED`.
4. Confirm watchdog ticks do not auto-resume it.
5. Confirm explicit operator resume is required.

## Lifecycle gap

1. Simulate more than one lifecycle gap over 180 seconds.
2. Confirm total deadline extension never exceeds the configured cap.
3. Confirm audit distinguishes bounded extension from cap reached.

## Claim boundary

A PASS here applies only to the tested installed build, browser version, page state and Prompt API host. Record the exported build digest and browser evidence with the result.
