# Session postmortem — Greenfield v1.1.9

## Scope

This is the historical incident record used to design v1.1.10. It is not a claim about the
current package or live Desktop Chrome acceptance.

## Incident A — autonomous WAITING producer loss

In the supplied v1.1.9 forensic Audit, the autonomous process was bound to user turn
`36a333c1-ac25-4a48-a219-44de3927bdbd`. A later user turn
`0b057053-86b5-4db3-a2ed-a4af4a361104` appeared before any assistant turn causally paired
with the expected autonomous user turn. A later assistant turn
`affa58ba-ad82-4284-9d7e-5b503314e02e` belonged after that later user boundary.

v1.1.9 continued emitting `RESPONSE_OBSERVATION_HELD` with
`AUTONOMOUS_ASSISTANT_NOT_OBSERVED`, because the content resolver did not expose that the
old autonomous response slot had been closed by the next user turn.

### Root cause

The response observer proved only "no assistant paired yet". It did not model the stronger
terminal topology fact "a later user turn now bounds the old response slot, so no future
assistant can become the missing paired producer for that slot."

### v1.1.10 correction

- content resolver exposes `nextUserTurnId` and `responseSlotClosed`;
- causality classifies the closed slot as `AUTONOMOUS_RESPONSE_PRODUCER_LOST`;
- if the target is idle, runtime re-arms one bounded owner-reconcile continuation instead
  of waiting forever;
- if the UI remains globally busy, the acknowledged WAIT remains under the fixed
  30-minute -> F5 -> 90-second -> Ctrl-F5 -> 90-second -> BLOCKER recovery ladder;
- no lost effect is assumed successful or failed and no old effect is blindly replayed.

Regression fixture:
`tests/fixtures/v1.1.9-waiting-producer-loss.json`.

## Incident B — repetition treated as a false terminal boundary

A second observed failure stopped the process when the controller candidate repeated the
active objective (`Candidate nextPrompt is identical to the current objective`). Repetition
is evidence of no progress, but by itself it is not an owner, authorization, exact-once,
or irreversible-effect boundary.

### v1.1.10 correction

Continuation admission now evaluates real exact-once/evidence barriers first. Pure prompt
repetition is recoverable:

1. prefer a materially different safe target `nextSuggestedAction` when available;
2. otherwise synthesize a deterministic bounded alternative-continuation prompt;
3. preserve completed work and require one materially different next dependency,
   discriminating owner read/test, or non-conflicting parallel item;
4. only an actual safety/effect/owner blocker can terminally block.

The same policy applies when Hjalmar repeats the previous decision prompt even when the
target supplies no newer guidance.

## Verification boundary

The v1.1.10 deterministic suite exercises both failure classes and inherited exact-once,
causal-turn, protocol-optional, Nano and manual-interleave behavior. Live multi-window
Desktop Chrome acceptance remains a separate runtime check after installation.
