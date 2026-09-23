# Timed Mission Pause — Greenfield v1.3.1

## Purpose

Give the receiving EIC session one explicit machine control for the case where **waiting for
time to pass is itself the next correct action**, without confusing that need with Greenfield's
profile-global 0–90 second prompt-post spacing gate.

## EIC response instruction

When time itself is the next dependency and no useful autonomous work should occur first, EIC
may return:

```json
{
  "schema": "eic.a2a.response.v1",
  "status": "CONTINUE",
  "sessionAction": "PAUSE_PROCESS",
  "pauseSeconds": 1800,
  "sessionReason": "Wait for the external maintenance window to mature.",
  "nextSuggestedAction": "Re-read the owning maintenance/runtime surface and continue from fresh state."
}
```

Rules:
1. Use `PAUSE_PROCESS` only for a time-based continuation dependency.
2. `pauseSeconds` is an integer in `[300, 86400]`.
3. `status` remains `CONTINUE`; a pause is not DONE or BLOCKED.
4. `nextSuggestedAction` must contain the bounded action to execute after wake-up.
5. Do not use this control for ordinary thinking time, rate spacing, a human approval, or an
   unresolved non-temporal blocker.
6. The existing 0–90 second global prompt-post delay is independent and may still delay the
   eventual post after the mission pause has ended.

## Runtime invariant

`ANALYZING -> PAUSED -> SENDING`

Before entering `PAUSED`, Greenfield completes normal response parsing, Hjalmar D2 and
continuation admission, then creates the next objective, composes/hashes the next A2A prompt,
and persists one `missionPause` receipt tied to that exact continuation.

The durable record carries `pauseId`, duration, requested/not-before timestamps, reason,
source-response hash, next objective id and next-prompt hash.

## Wake semantics

The requested instant is a **not-before time**, not an exact execution SLA.

Greenfield uses a one-shot Chrome alarm as the normal wake mechanism. Because the package
supports Chrome 138+, alarm persistence across browser sessions is not trusted as the state
owner. At service-worker/browser hydration, Greenfield reads the persisted process:
- if the pause is still armed and in the future, recreate the one-shot alarm;
- if the not-before time has passed, enqueue immediate resume;
- if alarm synchronization fails, retain the durable pause and use the periodic watchdog only
  as a recovery fallback.

A sleeping/offline computer can therefore resume later than requested. It must not fabricate
that work ran at the requested timestamp.

## Manual early resume

The side panel exposes **Resume pause now**. It changes the pause receipt to `RESUMED_EARLY`,
moves the process to `SENDING`, and sends only the already-composed continuation. Repeated
resume calls when the process is no longer paused are idempotent no-ops.

## Mission vs objective

`mission` and `objective` are different semantic layers:
- `mission`: invariant operator mandate and scope for the whole Greenfield run;
- `objective`: bounded current work package for this turn.

At `MISSION_START`, v1.3.1 uses a compact bootstrap objective:

> Start the mission from fresh owner-verified state. Select and execute the first bounded work
> package within mission scope, then continue autonomously.

The full operator mission is carried once in `mission`. This avoids a large identical
mission/objective duplicate while retaining explicit scope on every A2A envelope.

## Failure rules

- malformed/out-of-range `pauseSeconds` -> structured response control is invalid;
- `PAUSE_PROCESS` without `CONTINUE` or without a next action -> invalid;
- missing/corrupt persisted pause or pending continuation while phase is `PAUSED` -> BLOCKED,
  because reconstructing intended work would risk replay or invention;
- alarm delay -> resume when runtime becomes available and record actual timing;
- global prompt-post gate remains unchanged and separate.
