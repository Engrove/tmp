# v0.11.17 architecture

## Why this release is architectural

v0.11.16 proved that the remaining response-settle failure was not another missing wake,
deadline or retry.  The failed live state held the same assistant response simultaneously as:

- the persisted `responseCandidate`;
- the source `pendingObservation` used to request the session baseline; and
- the already processed response identity.

That is an ownership violation.  The response had advanced semantically, but an early return
after `armMainTaskBaselineRequest()` bypassed the later candidate cleanup.  The v0.11.15/v0.11.16
liveness watchdog then correctly timed the persisted object but the object no longer owned a
live response generation.

v0.11.17 therefore does not add another timer, retry or foreground exception.  It changes the
response lifecycle model.

## Exclusive response ownership

A single assistant response identity may have at most one active **settle/effect-response owner**. Durable observation records may remain as historical or Nano context after processing, but they cannot keep the response candidate's liveness ownership.

The monotonic semantic lifecycle is:

`PAGE RESPONSE -> RESPONSE_CANDIDATE -> PENDING_OBSERVATION -> PROCESSED`

The transition from candidate to observation is a transfer of liveness ownership, never a copy. The transfer clears the candidate and its settle failure state before any downstream branch can return. Marking an
observation processed defensively retires a matching candidate through the same lifecycle helper. All background response-candidate retirement now goes through that helper; raw `run.responseCandidate = null` lifecycle clears are forbidden outside the central terminal state transition.

`lib/response-observation-cycle.mjs` owns:

- explicit cycle states: `IDLE`, `OBSERVING`, `SETTLED`, `CONSUMED`, `SUPERSEDED`, `FAILED`;
- owner kinds: `SESSION_CATCH`, `EFFECT_RESPONSE`, `UNBOUND`;
- candidate dispositions: `NONE`, `ACTIVE`, `EFFECT_NOT_ACKED`, `SOURCE_OBSERVATION`,
  `ALREADY_PROCESSED`, `OWNER_MISMATCH`;
- identity-first response equality;
- atomic candidate retirement and candidate-to-observation transfer;
- invariants for processed/source/effect/terminal ownership.

## Identity-first semantics

The full response identity is authoritative when both sides provide it.  Hash equality is only a
legacy/partial fallback.

This matters because two different assistant turns may render byte-identical text.  A later turn
with the same response hash but a different conversation/task response identity must remain a new
generation.  Outbound effects now persist both `sourceObservationHash` and
`sourceObservationIdentity` so the source response cannot be mistaken for its own effect response
without suppressing a genuinely new identical-text turn.

## Control-plane precedence

`lib/control-plane-phase.mjs` encodes one bounded precedence tree for competing owners:

1. terminal run owner;
2. human owner (`AWAITING_OPERATOR_ACTION` / `AWAITING_OPERATOR_DECISION`);
3. safety owner (authentication/CAPTCHA);
4. unacknowledged effect owner;
5. active causal response owner;
6. session-init owner;
7. Nano owner;
8. recovery owner;
9. ordinary delivery owner.

The phase model does not replace the existing state machines.  It resolves which already-existing
owner may act on the current tick, preventing unrelated Nano/recovery paths from pre-empting a
causally active response generation.

## Parent/child terminal coherence

Terminal run transitions now close active child lifecycle state atomically:

- active session initialization becomes `FAILED / RUN_OWNER_TERMINATED`;
- an active pending Nano request becomes failed;
- active response observation is closed;
- response candidate and response deadline ownership are removed.

The parent run can therefore not be terminal while a child machine still advertises active work.

## Binary-tree / state-space verification

The release carries a source-derived state registry rather than a hand-selected state list.
`docs/V0_11_17_STATE_REGISTRY.json` is generated from exported enum-like source registries and is
checked for drift.

The causal test tree covers the high-value cross-product only until a dominant owner prunes the
branch:

`terminal -> human -> safety -> effect -> response -> session-init -> Nano -> recovery -> delivery`

It varies every run state, every session-init state, every effect-journal status, Nano request state,
page class, candidate class and wake source. A separate response-ownership lifecycle state space also
varies cycle status, effect status, candidate identity class, page identity class and terminal/human run class.
Separate tests cover the exact v0.11.16 incident, response liveness, session-init/Nano interaction,
operator-bound transitions and preserved functional contracts.

This is intentionally not a claim that every arbitrary Cartesian combination is runtime-reachable.
The verification proves the precedence/invariant decision for every enumerated branch of the
model and rejects known impossible dual-owner states.

## Preserved boundaries

- v0.11.13 receipt-only exits from human-owned waits remain authoritative.
- v0.11.14 lexical `USER_PAUSE` handling remains unchanged.
- v0.11.15 durable response-settle wake/deadline remains, but only for the currently active response owner.
- v0.11.16 Core Surface Review `NO_CHANGE` normalization remains unchanged.
- No new authentication, CAPTCHA or destructive automation is introduced.
