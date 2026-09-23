# Session postmortem — Greenfield v1.2.1

## Incident

Captured v1.2.0 runtime Audit (SHA-256
`dee62a325572bbd99a3bae661ad3ee440995d532466867f072b1bcd220a5ea3a`) showed a
complete visible assistant response held indefinitely in `WAITING`.

Repeated observation facts:
- `generating=false`;
- expected autonomous user turn equals paired user turn by exact id;
- assistant is present inside that turn;
- no later user turn closes the response slot;
- assistant id/hash/text length remain stable;
- owner resolution is `ROLE_NODE_FALLBACK`, `ownerTrusted=false`;
- response stability returns `OBSERVATION_OWNER_UNTRUSTED`;
- runtime schedules another 900 ms fast recheck.

The protocol parser and Hjalmar are downstream and never receive the response. FORENSIC/Audit
is therefore displaying the liveness loop rather than causing it.

## Root mechanism

v1.1.7 correctly made bare role-node fallback non-terminal after a hidden renderer fragment
had previously repeated stable bytes. That structural rule became too strong when current
ChatGPT renderer structure could no longer provide one recognized turn shell / homogeneous
single-role ancestor for an otherwise causally exact complete response.

The defect is a proof-composition gap:
- structural owner proof can degrade with renderer structure;
- exact dispatched-user-turn causal proof can remain intact;
- v1.2.0 required structural proof absolutely, so exact causal proof could not make progress.

## v1.2.1 repair

1. Preserve structural owner trust as the primary path.
2. Recognize duplicate role nodes as `COHERENT_ROLE_REPLICA` only when they share one
   non-empty message id and byte-coherent normalized text.
3. Deduplicate canonical entries by stable role/message id.
4. Permit a slower `CAUSAL_VISIBLE_FALLBACK` only when:
   - owner kind is exactly `ROLE_NODE_FALLBACK`;
   - user resolution is exactly `USER_TURN_ID`;
   - expected and paired user ids are equal and non-empty;
   - response slot is not closed;
   - document is visible;
   - response is no longer generating;
   - text/hash/count invariants are coherent;
   - the same candidate is stable for at least 5 seconds and 5 reads.
5. Emit `RESPONSE_CAUSAL_FALLBACK_ADMITTED` when this exceptional path is used.
6. Make unchanged observation-time linked-tab overlay updates idempotent so the Audit window
   does not continually repaint/sync unchanged overlay state.

## Preserved negative gates

- hidden `ROLE_NODE_FALLBACK` fragments remain non-admissible;
- ordinal-only user reconciliation does not unlock the fallback;
- causal mismatch remains blocked before parsing;
- a closed autonomous response slot cannot be bypassed;
- later manual user/assistant turns cannot become the autonomous response.

## Verification boundary

Source/package regressions can verify the state machine and captured incident fixture. They
cannot prove live ChatGPT DOM behavior after installation. Desktop Chrome live acceptance
therefore remains NOT_RUN until the operator loads v1.2.1 and exercises the affected path.
