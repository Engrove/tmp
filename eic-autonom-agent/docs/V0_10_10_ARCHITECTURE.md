# EIC Autonom Agent v0.10.10 — Core-surface review replay architecture

## Purpose

v0.10.10 closes the v0.10.9 integration gap where the first automatic Nano review of application settings, Nano mandate, target/EIC mandate and continuity could be deferred while session initialization or mission Nano owned the local model, but never replayed.

## Invariant

The first source-bound automatic core-surface review in an application session is exactly-once:

1. Session Capture and Session Memory produce source identities.
2. If session initialization blocks ordinary work or mission Nano owns the model, the application stores `eic.autonom.core-review-deferral.v2`.
3. The deferral binds `appSessionId`, `captureId`, `memoryId`, `missionId` and `runId`.
4. Replay remains blocked until session-context initialization is `READY`, no mission Nano request is pending and the Nano host is not busy.
5. Replay creates one `PENDING_ANALYSIS` review with trigger `AUTO_INITIAL_CAPTURE`.
6. The deferral is consumed. A review already present for the same application session consumes the deferral without creating a duplicate.
7. The sidepanel gives this first automatic review the next local model turn before ordinary mission Nano.
8. Later reviews remain manual.

## Ownership

- Background runtime owns deferral creation, persistence, replay eligibility and exactly-once consumption.
- Sidepanel owns the local LanguageModel inference.
- Session Capture and Session Memory own source identities.
- The review proposal is local candidate data until operator acceptance or eligible low-risk TTL application.
- Transcript-derived context remains untrusted and cannot grant permissions, owner truth or external effects.

## Replay triggers

Replay is attempted after:

- successful mission Nano completion, including the transition of session initialization to `READY`;
- Nano host state updates that release the model.

The helper is idempotent and may be called repeatedly.

## Priority and concurrency

A pending automatic review with a `READY` session-init state is processed before an ordinary pending mission Nano request. The same dispatch lock and local model busy state prevent concurrent inference.

## Failure behavior

- Missing source identities keep the deferral pending.
- A busy host or pending mission Nano keeps the deferral pending.
- A prior review for the same app session consumes the deferral without duplication.
- If the panel or local model is unavailable, the review remains visibly `PENDING_ANALYSIS`.
- No mandate or authority change is applied without existing operator/TTL safety gates.
