# v0.10.13 architecture — semantic Nano recovery

## The broken state

v0.10.12 proved the bridge, catch, full capture, deterministic baseline delivery,
effect journal and DOM ACK. The failure occurred after the returned baseline had
created a local Nano request:

```text
sessionContextInit = NANO_ANALYZING
pendingNanoRequest = PENDING, unclaimed
run.state = WAITING_FOR_RESPONSE
```

The request was semantically ready for local analysis, but the UI claim gate
required `ASSESSING`. Generic lifecycle recovery had restored a target-wait state
and thereby made the preserved request impossible to claim.

## One semantic owner

`lib/nano-analysis-recovery.mjs` owns four decisions:

```text
pendingSessionInitNanoRequest(run)
nanoRequestClaimEligible(run)
nanoAnalysisStateNeedsRepair(run)
evaluateUnclaimedNanoRequestStall(run)
```

The semantic source of truth is the conjunction of:

- `sessionContextInit.state === NANO_ANALYZING`;
- `pendingNanoRequest.status === PENDING`;
- no existing claim.

`run.state` remains useful scheduling state, but it is not allowed to erase the
meaning of a pending initialization analysis.

## Recovery law

Before generic recovery may produce `WAITING_FOR_RESPONSE`, the runtime checks
whether an initialization Nano request is pending. If so it restores:

```text
run.state = ASSESSING
sessionContextInit.state = NANO_ANALYZING
pendingNanoRequest = preserved and re-claimable
```

The sidepanel applies the same semantic helper. A valid request can therefore be
claimed even if a stale redundant run state survived a service-worker or storage
recovery boundary.

The forbidden invariant is:

```text
NANO_ANALYZING
+ PENDING/unclaimed request
+ WAITING_FOR_RESPONSE
```

That is not a legitimate wait for ChatGPT; the required next actor is the local
Nano host.

## Bounded liveness

A pending initialization request has a 45-second claim window. If no claimant
starts it, the runtime moves initialization to `FAILED` with
`NANO_REQUEST_UNCLAIMED_TIMEOUT` and exposes **Försök igen / Visa fel / Stoppa**.
The deadline is checked by the background owner, so it does not depend on a
successful Nano claim.

This is deliberately separate from the long model wall timeout. The latter
governs a claimed inference; this deadline governs whether inference starts at
all.

## Source consumption

The target response identity is preserved on the request but is not committed to
`lastProcessedResponseIdentity` merely because the request was created.
Consumption occurs only when a deterministic or Nano decision has completed and
the observation is actually being cleared. A local persistence failure cannot
therefore require an impossible new target response.

## Continuity readback

`writeRuntimeBundle` still verifies primary and backup state after every write.
v0.10.13 adds one bounded rewrite/readback when the continuity digest mismatches.
This handles a transient mutation or competing write without weakening fail-
closed behavior.

If the second verification fails, a `storagePersistenceFailure` receipt records
the expected and observed digests, revision, writer, request ID and semantic
resume state. The emergency path may block the run, but subsequent lifecycle
recovery must restore the recorded Nano substate rather than invent a target-
response wait.

## Capture ownership

Automatic Session Capture is suspended while initialization Nano is pending or
running. This removes the repeated defer/reschedule loop and makes the ordered
owner chain explicit:

```text
capture baseline response
→ create Nano request
→ claim and analyze
→ schedule post-analysis capture/review
```
