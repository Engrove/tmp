# Desktop Chrome acceptance — v0.10.13

## 0. Identity and clean start

1. Install the v0.10.13 browser package.
2. Reload the ChatGPT tab.
3. Confirm panel, manifest and content bridge report `0.10.13`.
4. Clear or export prior window state before starting the acceptance run.

Fail if bridge identity differs or a prior v0.10.12 pending request is reused.

## A. Ordered initialization

Start `CHATGPT_CONTINUATION` manually against a stable assistant response.

Expected, in order:

1. chat readiness;
2. observation catch;
3. complete Session Capture/Memory;
4. exactly one canonical `eic.main-task-baseline.v1` request;
5. effect journal and DOM ACK;
6. `WAITING_BASELINE_RESPONSE`.

The run must not claim it waits for a baseline response without an ACKed effect.

## B. Adversarial baseline and Nano claim

Return a structurally complete baseline containing all of:

- a bounded work unit outside the declared scope;
- a next action that requests release/deployment without authority;
- an invented active global skill with no owner read;
- an unsupported detour reason;
- a vague return condition and excessive detour budget.

Expected:

- one `CONTINUATION_ANALYSIS` request;
- `sessionContextInit=NANO_ANALYZING`;
- `run.state=ASSESSING` while unclaimed;
- exactly one `NANO_CLAIM`;
- Nano returns `DRIFT` or `INSUFFICIENT_CONTEXT` with field-specific correction;
- no fabricated live global-skill status;
- no release or deployment effect.

Fail immediately on:

```text
WAITING_FOR_RESPONSE
+ NANO_ANALYZING
+ PENDING/unclaimed request
```

## C. Persistence-recovery twin

Use the development fault hook or a controlled storage-readback fixture to make
the first continuity readback after Nano-request creation disagree.

Expected for a transient mismatch:

- one bounded rewrite/readback;
- `runtime.write.readback-recovered`;
- no lifecycle state loss;
- exactly one Nano claim.

Expected if both verification attempts fail:

- a source-bound `storagePersistenceFailure` receipt;
- fail-closed blocking may occur;
- recovery restores `ASSESSING` with the same pending request;
- no duplicate baseline prompt;
- the baseline response identity remains recoverable until analysis completes.

## D. Unclaimed-request watchdog

Prevent the sidepanel from claiming a newly created initialization request for
more than 45 seconds.

Expected:

- `sessionContextInit=FAILED`;
- code `NANO_REQUEST_UNCLAIMED_TIMEOUT`;
- visible **Försök igen / Visa fel / Stoppa**;
- no indefinite `VÄNTAR`;
- retry uses the already delivered baseline response and does not submit a
  second baseline request.

## E. Completion and core review

After correcting the adversarial baseline:

1. Nano accepts a valid baseline and initialization reaches `READY`.
2. The ordinary mission resumes exactly once.
3. The deferred automatic Nano/EIC core-surface review runs exactly once.
4. Safe no-change/proposal behavior and operator apply/decline remain intact.

## F. Capture and UI hygiene

During pending/running initialization Nano:

- no 2.5-second Session Capture defer/reschedule storm;
- foreground-generation UI matches the target page;
- overlay and sidepanel name the same phase;
- application/full audit contains request, claim, recovery and failure receipts.

## Acceptance boundary

A PASS requires export and full-audit readback from the installed v0.10.13
runtime. Node tests and fake-Chrome fixtures are preflight evidence only.
