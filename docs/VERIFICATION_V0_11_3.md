# v0.11.3 verification

Status: SOURCE VERIFICATION PASS — DESKTOP CHROME LIVE ACCEPTANCE NOT RUN

## Required source behavior

- Baseline ACCEPT is a typed commit event and cannot enter ordinary continuation grounding.
- Exact typed request identity owns `NANO_ANALYZING` during session initialization.
- Ordinary Nano/recovery/local program mutation is blocked before durable READY.
- Durable READY hands the same bound observation to exactly one ordinary Nano without another target prompt.
- Execution disposition is resolved before material delivery regulation.
- Delivery regulation applies only to material `TARGET_DISPATCH`.
- ACKED baseline response reconciliation is lifecycle-aware and can re-observe its own response without treating generic continuation consumption as ownership.
- Terminal Nano paths release host/request ownership through one common finalizer.
- Waiting states require a causal wake producer.
- AI-actionable waits use exactly-one `CHAT_CONTROL_CONTINUATION`; UI state is never treated as transport to EIC AI.

## Executed verification

### Complete source suite

The complete source test set was executed in bounded serial shards after the v0.11.3 causal-ordering changes.

- Distinct tests: **1134**
- PASS: **1134**
- FAIL in final bounded pass: **0**
- SKIP: **0**

One first-attempt Step2 half-shard produced a single nonreproduced fake-runtime timing failure (19/20). The exact same 20-test subset immediately reran **20/20 PASS**, and the complementary half ran **20/20 PASS**. This transient is retained as harness-contention evidence rather than hidden.

An earlier file-level concurrency=2 source-shard run also exposed one fake-Chrome owner-claim timing failure in the Step6 harness. The exact Step6 file reran **13/13 PASS**, and the same shard reran serial **110/110 PASS**. No production/runtime claim is inferred from those harness timing observations.

### v0.11.3 causal/model tests

- Focused causal + state-space files: **14/14 PASS**
- 32 complete focused stress runs:
  - concurrency 1: 8 runs / 112 tests / 112 PASS
  - concurrency 2: 8 runs / 112 tests / 112 PASS
  - concurrency 4: 8 runs / 112 tests / 112 PASS
  - concurrency 8: 8 runs / 112 tests / 112 PASS
  - aggregate: **448/448 PASS**
- Stateful guard/model checks execute cross-products for exact baseline owner identity, PRE_READY admission, READY commit relation, lifecycle-scoped response re-observation, material-delivery eligibility and causal waiting.

### Live-shaped Step2 integration twins

The four critical dynamic twins were executed repeatedly against the full background command path:

1. meta-verb baseline ACCEPT (`Validera ...`) commits READY without generic grounding;
2. repeated same-observation local micro-action emits exactly one AI-visible control wake without Nano requeue;
3. direct `WAIT_OWNER_EVENT` reaches chat-control before material delivery regulation;
4. exhausted `HOST_STREAM_STALLED` wakes AI exactly once without Nano reentry.

- Six repeated runs: **24/24 PASS**
- Full Step2 file, split into two bounded 20-test shards: **40/40 PASS** on the final rerun.

### Validator and package gate

`npm run validate`, release identity/coherence and post-package browser bridge checks are run after this source evidence is frozen. Candidate delivery is allowed only when those final gates pass.

## Desktop Chrome

Status remains **NOT RUN** for v0.11.3.

The primary live oracle is:

1. a valid baseline whose `nextHighLeverageAction` begins with `Validera`, `Granska`, `Analysera`, `Läs`, `Verify` or equivalent must still follow `ACCEPT -> COMMITTED -> READY`;
2. no ordinary Nano/recovery/local mutation may execute before READY;
3. a direct AI-actionable `WAIT_OWNER_EVENT` must emit exactly one ChatGPT `CHAT_CONTROL_CONTINUATION`, with material `TARGET_DISPATCH` delta 0;
4. no terminal Nano path may leave stale host `busy=true`;
5. an ACKED baseline response may be re-observed by baseline reconciliation without a duplicate target prompt.

## Claim boundary

This document reports source-side executed checks only. Desktop Chrome installation/runtime acceptance, Forgejo persistence, deployment and publication are separate owner surfaces and are not claimed here.
