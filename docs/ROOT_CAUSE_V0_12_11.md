# v0.12.11 root cause — Nano owner-liveness and stale inference cancellation

## Evidence basis

The exact v0.12.10 Desktop Chrome NDJSON/export shows:

- session-context baseline Nano completed and `READY` was durably committed;
- ordinary `CONTINUATION_ANALYSIS` request
  `nano-request-06a6af17-882d-43bd-8687-efc7cc59a9d1` was claimed once;
- `attempts=1`, `requeueCount=0` and `unclaimedRearmCount=0`;
- the same local request remained in inference for many minutes;
- at 11:55:36.112Z its heartbeat was still accepted;
- from 11:55:56.080Z heartbeats were rejected with
  `Nano heartbeat saknar aktiv request.`;
- local LanguageModel inference nevertheless continued until 11:58:58;
- it then attempted `NANO_DECISION` twice and `NANO_FAILURE` once, all rejected
  because background no longer owned an `ASSESSING` Nano request.

This excludes a request/requeue loop for the observed episode. The loop-like
symptom came from a single orphaned local inference whose owner had already
moved on.

## Root cause

Two contracts were incomplete.

1. `NANO_HEARTBEAT` owner rejection was treated as telemetry transport failure.
   The local provider task received no cancellation signal when background
   invalidated the request/claim.
2. Ordinary continuation analysis inherited the global 1,800,000 ms wall
   timeout. The 60-second stream-idle watchdog only trips when output stops
   changing, so continuously generated but non-terminal output could run for
   many minutes.
3. During adversarial pre-release verification, the owner-error classifier was
   also found to be too strict when a transport wrapper prepended its own error
   code before the owner-invalidated message. v0.12.11 therefore matches the
   structured owner signal anywhere in the combined code/message envelope,
   rather than only at character zero.

A target-side foreground generation is a new causal owner event. An ordinary
Nano result grounded in the prior observation is stale once that event is
accepted. v0.12.10 changed run ownership but did not propagate this change into
the local LanguageModel task.

## v0.12.11 invariant

A local Nano inference may continue only while the exact
`requestId + claimId + ASSESSING owner state` remains authoritative.

- owner rejection aborts the local provider task;
- target foreground generation explicitly supersedes a running ordinary Nano
  request before the run leaves `ASSESSING`;
- an owner-invalidated invocation must not emit `NANO_DECISION` retry or
  `NANO_FAILURE`;
- ordinary continuation inference has a 180-second local mode deadline and the
  background request has the same absolute deadline; renewable heartbeats cannot
  extend it, and deadline expiry cannot requeue the same running request;
- the global configurable 1,800-second wall ceiling remains unchanged for
  paths that explicitly use it.

## Claim boundary

The supplied v0.12.10 runtime evidence supports this root cause. It does not
prove that every possible future waiting state is faulty. In particular,
`WAITING_TARGET` while ChatGPT is genuinely generating is not classified as a
bug by this repair.
