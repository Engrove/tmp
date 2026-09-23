# Greenfield Session Health v1.3.2

## Purpose

Session Health gives Greenfield and EIC a compact, replayable set of **observed proxy signals**
for deciding whether a ChatGPT session is still a good collaboration surface.

It is not a token meter, not a model-context-window meter, and not an authority to rotate a
session. It reduces guesswork around `ROTATE_SESSION_NOW`.

## Ownership

Greenfield owns browser-observed telemetry only.

EIC owns the semantic decision whether session quality has materially degraded. Nano may provide
a stateless prompt-only second opinion when EIC has supplied all facts required for that isolated
assessment.

`generation`, `turn` and `sessionSeq` remain lineage/fencing values. They are never interpreted as
noise scores.

## Persistent per-session state

Greenfield persists:

- `sessionSeq`
- `sessionStartTurn`
- `promptsPosted`
- `managedPromptChars`
- `capturedResponseChars`
- bounded recent timing samples
- `recoveryChurn`
- the current active prompt timing receipt

The telemetry resets when Greenfield rotates to a new ChatGPT session. Mission identity,
run identity and ordinary cross-session continuity do not reset.

## Timing model

For each autonomously posted prompt:

```text
postedAtMs
firstResponseObservedAtMs
completedAtMs
```

Derived values:

```text
ttfrMs       = firstResponseObservedAtMs - postedAtMs
completionMs = completedAtMs - firstResponseObservedAtMs
totalMs      = completedAtMs - postedAtMs
```

`postedAtMs` is captured only after the global prompt gate allows the actual post. Therefore:

- a `PAUSE_PROCESS` wait is not part of TTFR;
- the profile-global 0–90 second prompt-post delay is not part of TTFR;
- waiting before the post boundary cannot inflate Session Health latency.

If Greenfield does not observe an intermediate generating state, the first observed changed
assistant response is the fallback first-response signal. TTFR is therefore an observation proxy,
not provider-side first-token telemetry.

## Clean baseline

Only samples with no Greenfield recovery churn during that response turn are eligible to seed the
clean TTFR baseline. The baseline is the median of prior clean samples once at least three prior
clean samples exist.

The latest clean TTFR can then be compared with that baseline as `ttfrRatio`.

This is deliberately relative to the current session rather than a universal seconds threshold.

## Context-load proxy

Greenfield does not claim access to the model's true token usage or hidden context window.

Instead it accumulates only the A2A prompt characters Greenfield posted and assistant response
characters it captured in the current managed session:

```text
managedContextChars = managedPromptChars + capturedResponseChars
```

This is a bounded observable proxy. It does not include hidden system/developer context, tokenizer
details, provider-side caches or unseen model state.

## Pressure bands

The local pressure band is a deterministic observability aid, not a calibrated probability:

```text
LOW       no local proxy signal
WATCH     one local proxy signal
ELEVATED  two local proxy signals
HIGH      three or more local proxy signals
```

Current proxy signals are deliberately simple and inspectable:

- `LONG_SESSION`
- `LARGE_MANAGED_CONTEXT`
- `TTFR_RISING`
- `TTFR_HIGH_RELATIVE`
- `RECOVERY_CHURN`

Thresholds are implementation heuristics, not claims about token limits. They should be calibrated
later from real Greenfield telemetry rather than treated as universal model facts.

## EIC decision rule

The A2A `responseContract.sessionHealthControl` states the boundary compactly:

```text
telemetry = ADVISORY_PROXY_NOT_TOKEN_COUNT
decision  = corroborate pressure with semantic drift/repetition/contradiction/stale assumptions
```

EIC should normally:

- keep working when telemetry is low and semantic continuity is good;
- treat `WATCH` as an observation, not a rotation request;
- inspect semantic continuity when pressure is elevated;
- use Nano for a bounded prompt-only second opinion when ambiguity remains;
- return `ROTATE_SESSION_NOW` when the combined evidence indicates material session-health risk.

Greenfield never manufactures `ROTATE_SESSION_NOW` from the local pressure band.

## Nano boundary

Nano is not a sensor. When useful, EIC may ask Nano to assess only the bounded facts embedded in
one `NANO_TASK:` prompt, for example:

- invariant mission;
- current objective;
- current Session Health capsule;
- a small set of recent continuation summaries.

A suitable Nano task checks semantic drift, repetition, contradiction and objective/mission
divergence. Nano cannot inspect Greenfield state, owner routes, files or prior chat beyond supplied
prompt content.

## Compact A2A transport

v1.3.2 serializes the same A2A envelope as minified JSON.

This is a transport optimization only. JSON structure, mission authority, response controls,
claim boundaries, Nano prompt-closure, PAUSE semantics and session-rotation semantics remain
machine-readable.

Whitespace is not protocol meaning.

## Verification boundary

Source tests can verify:

- deterministic telemetry math;
- pause/global-gate exclusion from TTFR;
- clean-baseline handling;
- session reset on rotation;
- minified valid JSON;
- continued response-control semantics;
- no automatic control action inside Session Health.

Live Chrome/ChatGPT timing quality, semantic usefulness and long-run threshold calibration require
operator-run acceptance and real telemetry. They are not claimed by deterministic source tests.
