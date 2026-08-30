# Root cause — v0.12.12

## Runtime incident

The supplied v0.12.11 Desktop Chrome evidence shows a post-Nano handoff failure,
not active Nano work.

The deterministic protocol-repair analysis completed and a repair effect was
prepared. Roughly 60 ms later the effect was marked `CANCELLED_SUPERSEDED`.
The audit recorded the same source/current assistant hash:

`4922c57e64c4f3d6a77dfee57b2f117cdc242df392ea2316a4f4a087ce049ef4`

The persisted document epoch also remained unchanged. The remaining
v0.12.11 cancellation predicate was the transient `page.generating` flag.

After cancellation, the run moved to `WAITING_FOR_RESPONSE` although no prompt
had been submitted and no Nano request remained. The later Session Capture/page
scan was recovery fallout, not the initiating cause.

## Violated invariant

Target activity and target owner identity are different facts.

A busy/generating target may still represent the exact same owner-bound
assistant observation. A prepared effect may be declared superseded only from a
changed readable owner identity, not from activity alone.

## v0.12.12 repair

`classifyPreparedEffectObservation()` now returns one of:

- `STABLE_SAME_OWNER`
- `SAME_OWNER_BUSY`
- `OWNER_IDENTITY_UNREADABLE`
- `SUPERSEDED`

`SUPERSEDED` requires a different readable assistant hash or document epoch.

For `SAME_OWNER_BUSY`, the prepared effect remains `PREPARED` /
`RETRY_PREPARED`, response timeout ownership is cleared, and the controller
enters explicit pre-submit foreground/background wait.

For `OWNER_IDENTITY_UNREADABLE`, the effect is preserved and owner readback is
retried fail-closed. Fast rechecks are bounded to 10 seconds, then the durable
30-second watchdog remains responsible for re-observation.

A pending prepared effect observed during foreground generation is treated as
pre-submit work, not as `WAITING_FOR_RESPONSE`; therefore the 2-hour response
deadline cannot be armed before a prompt exists.

## Acceptance oracle

With the same assistant hash and document epoch:

1. transient `generating=true` must not produce `CANCELLED_SUPERSEDED`;
2. the prepared effect must remain journalled;
3. state must become pre-submit `WAITING_FOREGROUND` or
   `WAITING_BACKGROUND`;
4. when the target stabilizes, the same effect must proceed to submit;
5. only a changed readable hash or epoch may cancel as true supersession.
