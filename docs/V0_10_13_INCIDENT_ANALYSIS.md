# v0.10.13 incident analysis — v0.10.12 Nano claim starvation

## Runtime evidence

The v0.10.12 Desktop Chrome run
`run-6c6f3785-6137-43c5-989e-d6b66ed3af80` successfully:

1. linked the 0.10.12 content bridge;
2. caught a stable assistant observation;
3. delivered exactly one canonical baseline request;
4. obtained an effect-journal/DOM ACK for
   `turn-3e73accb-1b31-4576-93d7-565437c572ed`;
5. completed a 34-turn Session Capture and Session Memory;
6. observed the adversarial baseline response;
7. created a `CONTINUATION_ANALYSIS` request.

At request creation, one runtime persistence operation failed with
`CONTINUITY_PRIMARY_READBACK_MISMATCH`. A later write succeeded, but generic
lifecycle recovery ended in `WAITING_FOR_RESPONSE`.

The export then showed:

```text
sessionContextInit = NANO_ANALYZING
pendingNanoRequest.status = PENDING
pendingNanoRequest.claimedAt = null
run.state = WAITING_FOR_RESPONSE
mainTaskBaseline = null
```

The full audit contained no `NANO_CLAIM`, `NANO_HEARTBEAT`, `NANO_DECISION` or
`NANO_FAILURE`. Nano did not reject or slowly process the adversarial response;
it never received it.

## Root cause

Two individually reasonable mechanisms disagreed about the next actor:

- lifecycle recovery selected a generic target-readable state,
  `WAITING_FOR_RESPONSE`;
- the sidepanel required `run.state===ASSESSING` before calling
  `processPendingNano`.

The preserved pending request and `NANO_ANALYZING` phase were not considered by
either transition as an overriding semantic substate. The request therefore
remained valid but unclaimable.

The response identity had already been recorded as processed, so the same
baseline response could not be observed again to recreate the request. No
unclaimed-request watchdog covered `NANO_ANALYZING`, and the long Max Mode
response timer did not govern local Nano claim. The state was consequently
self-sustaining.

## What was not the cause

- The content bridge was current and readable.
- The baseline prompt was delivered and ACKed.
- The target page had completed generation.
- The local LanguageModel had passed admission/canary.
- The adversarial baseline was not rejected by Nano; Nano never started.

## Storage mismatch boundary

The audit proves that the primary continuity readback digest did not match once.
It does not identify the exact writer or field mutation that caused the mismatch.

v0.10.13 therefore addresses both layers:

1. make a transient readback mismatch diagnosable and retry once;
2. preserve/recover the correct semantic Nano state even when persistence still
   fails.

It does not claim to have proven the underlying Chrome storage race that produced
the original one-shot mismatch.

## Regression fixture

The executable fake-Chrome test corrupts two consecutive runtime readbacks at
the exact handoff where the baseline response creates the Nano request. It then
asserts:

- fail-closed storage handling is entered;
- the pending request remains source-bound;
- recovery restores `ASSESSING`;
- the request is claimed exactly once;
- no duplicate baseline prompt is sent;
- the response identity is not consumed before analysis;
- the forbidden false-wait state never becomes terminal.
