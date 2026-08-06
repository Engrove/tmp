# v0.10.11 incident analysis — the v0.10.10 baseline stall

Source evidence: `eic-autonom-agent-v0.10.10-export-1786038813069.json`,
window full-audit NDJSON for window `1974095883`, and the v0.10.10 source ZIP
(`89272943dfd4dea320f0ccc8d5d723c99a84fc67ea155a2e666189b58cd2484a`).

## Observed end state

```
sessionContextInit.state = CATCH_CAPTURED   (17:49:12.477Z, never advanced)
run.state                = WAITING_FOR_RESPONSE
mission                  = WAITING_TARGET
currentTurn              = null
effectJournal            = []
promptHistory            = []
mainTaskBaseline         = null
pendingNanoRequest       = null
pendingObservation       = null
```

No prompt was ever delivered. The export was taken at 17:53:33Z, more than three
minutes after the run went quiet, and the state was unchanged.

## Timeline

| UTC | Event | Verdict |
|---|---|---|
| 17:46:04 | background owner initialized | PASS |
| 17:47:46 | Nano host preflight — model available | PASS |
| 17:48:44 | `LanguageModel.create()` | PASS |
| 17:48:59 | canary inference, 10 chars | PASS |
| 17:49:09 | mission started | PASS |
| 17:49:12.518 | stable assistant catch, baseline prompt scheduled | PASS |
| 17:49:12.611 | dispatch attempt 1, revision 26 written | dispatch only |
| 17:49:12.6–34.8 | nine cancelled capture cycles, 3 writes each | noise |
| 17:49:34.787 | dispatch attempt 2, revision 53 | dispatch only |
| 17:50:04.780 | `CALLBACK_ATTEMPTS_EXHAUSTED` | FAIL |
| 17:50:10.451 | full transcript capture, 24 turns | too late |
| 17:50:10.927 | deterministic source exhausted | terminal |

Attempt spacing is 22.2 s and 30.0 s, not the 15 s lease: `WATCHDOG_MINUTES = 0.5`
is the only recurring driver of `tickWindow`, so each attempt consumed a whole
watchdog period and the two attempts were two identical replays.

## Root cause

`applyNanoDecisionCommand` destructured `{ config, continuity, runtime, audit }`
from `loadBundle(windowId)`, but the v0.10.10 deferred-review feature added this
call inside the same function:

```js
maybeReplayDeferredCoreSurfaceReview({
  context, run, applicationLog, audit, windowId, reason, now
});
```

`applicationLog` was never in scope. Evaluating the argument threw
`ReferenceError: applicationLog is not defined` on **every** deterministic
decision that reached that point — which is every baseline dispatch, before the
function's first `writeRuntimeBundle`.

The v0.10.11 runtime harness reproduces this on its first execution of
`background.js` against the unfixed code. It is not an inference.

## Why nothing observed it

Three amplifiers turned a one-line defect into a permanent stall.

1. **The exception had no channel.** The decision was applied from
   `setTimeout(() => applyNanoDecisionCommand(...).catch(console.warn), 0)`. The
   same function invoked through the UI command router would have produced a
   `ui.command.failed` full-audit entry with the message. The internal path had
   no envelope. The window audit confirms the silence: revisions 26→27 and
   53→54 contain no write from the application step at all.

2. **The observation was burned anyway.** On `CALLBACK_ATTEMPTS_EXHAUSTED` the
   run recorded the observation as processed — `lastProcessedResponseIdentity`,
   `lastProcessedAssistantHash`, `lastProcessedAssistantComplete = true` —
   although no prompt had been built or sent, and set a resume plan requiring
   *"a new owner-read or target response that changes the observation identity"*.
   The only actor that could produce a new assistant response was the agent, and
   the agent was blocked on that observation. Circular wait.

3. **Nothing was live-bounded.** `SESSION_CONTEXT_INIT_STATE.FAILED` existed,
   had an overlay card and was excluded from attention routing — and was never
   assigned anywhere in the codebase. `sessionContextInitBlocksWork` returns true
   for every non-`READY` state. The only remaining timer, `responseDeadlineAt`,
   renews itself for another two hours in Max Autonomous Mode with no escalation
   counter, so the stall was permanent in the literal sense.

## Why 835 tests passed

32 of 77 v0.10.10 test files loaded `background.js` with `fs.readFileSync` and
asserted on its **source text**. No test executed the service worker, and there
was no `chrome` test double anywhere in the repository. A source-text suite
cannot observe a `ReferenceError`.

## What the incident was not

- **Not a Nano-host problem.** Canary passed, `availability = available`,
  `busy = false`, `nanoTelemetry.lastStartedAt = null`,
  `lastInputChars = 0`. No inference ever started. The UI's
  `TAKEOVER_BOOTSTRAP / DETERMINISTIC_BASELINE_PENDING / 0 s` meant the run was
  waiting for the deterministic delivery that precedes Nano.
- **Not caused by the capture storm.** `shouldDeferSessionCapture` defers while
  a Nano request is pending or the run is ASSESSING; the capture completed 5.7 s
  *after* the deterministic request cleared. The pending request blocked capture,
  not the other way round. The audit also deduplicates by design — one entry with
  `repeatCount: 20`. The real cost was write amplification, not timing.
- **Not a mislabelled state alone.** `lastTransition` is
  `WAITING_FOR_RESPONSE → WAITING_FOR_RESPONSE`; the run never left the state it
  legitimately started in. In `CHATGPT_CONTINUATION` with
  `activation = WAIT_FOR_NEXT_COMPLETED_ASSISTANT`, waiting without a
  `currentTurn` is correct at takeover. The illegal configuration is waiting with
  *nothing armed*, which is what v0.10.11 forbids.

## Prior art in the same file

`background.js` already carried this comment above the grounding-failure path:

> `v0.7.0: a takeover that cannot be grounded is a *local host* problem, not a`
> `target problem. v0.6.9 sent it straight to RECOVERING behind a resume plan`
> `that demanded a changed target response — an event the addon deliberately`
> `never triggers, so the run was terminal.`

v0.7.0 gave that path a bounded re-arm (`TAKEOVER_MAX_RECOVERY_ATTEMPTS`). The
callback-exhaustion path added later had no equivalent and reproduced the
described failure exactly. v0.10.11 restores the protection for that path.

## Fixes

See `docs/V0_10_11_ARCHITECTURE.md` and `docs/CHANGELOG_V0_10_11.md`. Live
acceptance for the fixed chain is `docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_11.md`.
