# Desktop Chrome acceptance — v0.10.5

## Baseline

1. Remove or disable older unpacked copies.
2. Load the unpacked v0.10.5 browser package.
3. Clear extension errors.
4. Open one stable ChatGPT conversation.
5. Record the extension ID and service-worker/sidepanel identity.
6. Export state before testing.

## A. State identity

- UI version is `0.10.5`.
- Config/runtime are v13.
- Export is v20.
- Repeated refreshes preserve the same selected linked tab and surface pair.
- No `FORWARD_ONLY_RESET` is produced for current v13 state.

## B. Non-confirming Autostart

Run `Verifierad analys`, `Utforskning & design`, `Avgränsad leverans` and `Mjölnar D0`.

For each:

- one click starts the flow;
- active ChatGPT tab is linked and selected;
- controller surface matches the selected tab;
- configured quick profile and capture policy are materialized;
- LanguageModel is activated or reused;
- mission starts only after readback;
- no extension error is produced.

## C. D1/D2 confirmation and gesture

For D1 and D2:

1. first click arms the exact preset and starts no model/session/mission;
2. second click within 30 seconds performs Autostart;
3. changing preset or waiting past expiry requires re-arming;
4. `userActivationActiveAtStart=true`;
5. no `NanoUserActivationRequiredError`;
6. no `Uncaught (in promise)`;
7. selected tab and controller remain present after refresh.

## D. Failure paths

- Run with a non-ChatGPT active tab: mission must not start and the error must identify tab binding.
- Force a native model activation rejection: no mission starts and only one handled Autostart error is recorded.
- Create a tab/controller mismatch in imported test state: mission must fail closed before start.

## E. Preserved v0.10.4 scenarios

Re-run:

- automatic capture deduplication;
- Pause/Stop capture cancellation;
- five-minute review TTL;
- attention priority/navigation;
- all seven preset materializations.

## Evidence

Collect screenshots, extension errors, runtime export, capture fingerprint, Nano host telemetry, selected tab/controller identity and exact package hash.

## Claim boundary

Passing source tests is not installed-runtime acceptance. This checklist requires direct observation in the operator's Desktop Chrome.
