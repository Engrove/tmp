# Root cause and fix — v0.6.7 dynamic WAITING trigger

## Operator-observed symptom

A linked ChatGPT tab could remain in `WAITING_FOREGROUND` after the visible answer had stopped changing. The autonomous pipeline did not begin processing unless ChatGPT also emitted the expected EIC trailer variables.

The requested behavior is role-first:

- while the latest conversation item is a user prompt, `WAITING` must remain armed;
- when the latest conversation item is an ended assistant response, the response must be processed;
- EIC-specific trailer variables may accelerate a deterministic fast path but may never be required for triggering.

## Root causes

### 1. WAITING discarded an already completed assistant answer

`startWaiting()` initialized `lastProcessedAssistantHash` and `lastProcessedResponseIdentity` from the current page. If the latest item was already a completed assistant answer, the first reconciliation treated it as historical baseline instead of work to process.

### 2. User prompts could mutate response identity without creating a response

The old response identity combined:

- conversation key;
- latest user task fingerprint;
- latest assistant hash.

When a new user prompt appeared, the task fingerprint changed while the previous assistant hash remained in the DOM. Without an explicit latest-message-role gate, the stale assistant body could be mistaken for a new response identity.

### 3. Completion depended on soft UI controls or an EIC trailer override

`latestAssistantComplete` required `generating === false`. `generating` included:

- a visible Stop button;
- a busy/disabled composer;
- an explicit assistant streaming marker.

The first two are soft UI signals and may linger after the answer text has stopped. The only override was a valid terminal EIC trailer. Ordinary answers without the trailer could therefore remain classified as foreground generation.

### 4. The stability gate did not schedule its own follow-up read

After the first candidate snapshot, the code persisted the candidate and returned. A second read depended on another DOM mutation, UI refresh, or the 30-second watchdog. A completed static response could therefore wait unnecessarily or appear stuck.

## Fix

### Role-first conversation state

`content.js` now exports:

- `latestMessageRole`;
- `latestMessageHash`;
- `latestAssistantCandidate`.

The latest DOM-ordered conversation item is authoritative for trigger direction:

- `user` -> no response candidate; remain waiting;
- `assistant` -> eligible for completion stability checking.

### Trailer-independent assistant candidate

A latest assistant response becomes a candidate when:

- it has non-empty text/hash;
- the latest message role is `assistant`;
- no explicit assistant streaming marker remains;
- no trusted structured background task is active, cancelled, or failed.

A lingering Stop button or stale composer-busy flag is treated as a soft signal. It no longer requires an EIC trailer to be overridden.

### Bounded dynamic stability

Strict UI-idle completion keeps the normal policy:

- at least two identical reads;
- configured settle interval.

A candidate that still has soft busy controls uses a stricter dynamic policy:

- at least three identical reads;
- at least four seconds of unchanged assistant hash.

This reduces premature completion if ChatGPT pauses during streaming but fails to expose a streaming marker.

### WAITING activation semantics

When `WAITING` is activated:

- if the latest item is an assistant response, that current response is armed and processed exactly once after stability verification;
- if the latest item is a user prompt, the previous assistant body remains baseline and `WAITING` continues until a later assistant turn;
- an immediate reconciliation tick is scheduled.

### Self-scheduled stability probe

The service worker now schedules a bounded follow-up tick for an unsettled response candidate. The trigger no longer depends solely on a later DOM mutation or the watchdog.

### Optional protocol fast path

`EIC_TURN`, `EIC_NEXT`, `EIC_COMPLETION_EVIDENCE`, and `EIC_AUTONOMY` remain useful when present. A coherent trailer may still use the deterministic protocol fast path. Missing or malformed variables do not suppress the response trigger; the stable assistant response proceeds to Nano analysis.

## Deliberately preserved boundaries

- A real assistant streaming marker still blocks completion.
- Trusted structured ChatGPT background work still blocks completion.
- A user prompt never becomes a response trigger.
- Authentication, CAPTCHA, destructive-action, owner-evidence, and Mjölnar boundaries are unchanged.
- Nano output remains candidate material and does not become verified fact by itself.

## Residual risk

If ChatGPT exposes neither a streaming marker nor a changing response hash during a pause longer than four seconds, while also leaving only soft busy controls, the dynamic stability gate could classify the paused text as ended. Three reads and the four-second floor reduce this risk, but desktop-browser acceptance remains required against the actual ChatGPT DOM.

## Claim boundary

The source and automated Node checks can verify the state-machine logic, source wiring, syntax, packaging, and deterministic fixtures. They cannot prove the behavior of a currently installed Chrome extension or the live ChatGPT DOM without a desktop Chrome run and readback.
