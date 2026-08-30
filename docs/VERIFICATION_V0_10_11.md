# Verification v0.10.11

## Source identity

Baseline: v0.10.10 source ZIP SHA-256
`89272943dfd4dea320f0ccc8d5d723c99a84fc67ea155a2e666189b58cd2484a`

## Executed gates

- v0.10.11 focused fixtures: **16/16 PASS** (`v01011-deterministic-dispatch-liveness`)
- v0.10.11 executed runtime integration: **11/11 PASS** (`v01011-runtime-integration`)
- Full Node regression suite: **862/862 PASS**
- Static validator: **PASS**
- JavaScript/ES module syntax: **165/165 PASS**
- SOURCE package: **PASS**
- STANDARD package: **PASS**
- BROWSER package: **PASS**

The generated `build-info.json` in each profile is the owner record for its file
count, per-file SHA-256 values and package digest.

## New class of coverage

`tests/v01011-runtime-integration.test.mjs` is the first suite that **executes**
`background.js`. It imports the service worker against `tests/helpers/fake-chrome.mjs`
— an in-memory `chrome.storage`, `chrome.tabs`, `chrome.alarms`, `chrome.scripting`,
`chrome.runtime` and `indexedDB` double plus a ChatGPT page model — and drives the
real message router.

Delivery is asserted only from `page.submittedPrompts`, the harness's record of
`EIC_SUBMIT_PROMPT` messages that actually reached the page. Dispatch bookkeeping is
never accepted as evidence of delivery.

This suite reproduced the v0.10.10 root cause on its first execution against the
unfixed source: `ReferenceError: applicationLog is not defined`, thrown from
`applyNanoDecisionCommand` before any persistence.

## Covered acceptance logic

Executed against the running service worker:

- catch → deterministic dispatch → effect journal → `EIC_SUBMIT_PROMPT` → ACK;
- exactly one baseline prompt, with a journalled effect, prompt digest and
  `SESSION_CONTEXT_BASELINE_REQUEST` turn;
- no second prompt across repeated watchdog/content ticks;
- a dispatch exception is persisted to `run.deterministicDispatchFailure`, audited,
  and written to the application log with `errorCode`, `errorDetail` and `stackDigest`;
- the re-arm budget is bounded and does not send a prompt while failing;
- an undelivered observation is not recorded as processed;
- a stalled transient phase becomes `FAILED` with `PROGRAM_BLOCKED`, an
  `INTERNAL_INVARIANT` pause and a CRITICAL attention target;
- a blocked run does not spin storage revisions;
- the bounded operator retry re-arms the chain and delivers the baseline prompt;
- no `ReferenceError` reaches the prompt-critical path.

Covered as pure units:

- dispatch re-arm and immediate exhaustion verdicts;
- per-phase liveness bounds, and that only controller-owned phases are bounded;
- the stall clock restarting on each phase transition;
- `FAILED` assignment, terminality and failure codes;
- bounded operator retry with full field reset;
- unique overlay phase numbering and honest catch wording;
- exponential capture backoff with saturation.

## Safety preservation

- The established bounded-reconciliation path is unchanged and remains the terminal
  fallback after the re-arm budget.
- `DETERMINISTIC_CALLBACK_LEASE_MS` and `DETERMINISTIC_CALLBACK_MAX_ATTEMPTS` are
  unchanged, so the v0.6.3 revision-spin fixtures remain valid.
- Transcript-derived context remains untrusted; the operator retry sends no prompt.
- Mandate, profile, autonomy and owner-route changes remain operator-gated.
- Level-10 boundaries still require the real operator.
- No migration or compatibility path was added; the v0.9.3 forward-only law stands.

## Runtime boundary

The integration suite executes `background.js` against a **test double**, not Chrome.
It proves the control flow, persistence and message contracts of the fixed chain. It
does not prove installed Desktop Chrome DOM behavior, real content-script timing, or
service-worker lifecycle eviction. Those remain governed by
`DESKTOP_CHROME_ACCEPTANCE_V0_10_11.md`.
