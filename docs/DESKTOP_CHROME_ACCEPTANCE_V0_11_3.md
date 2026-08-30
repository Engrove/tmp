# Desktop Chrome acceptance — v0.11.3

Status: NOT RUN

## Primary live oracle: baseline causal chain

1. Start a fresh `CHATGPT_CONTINUATION` mission.
2. Let the deterministic `SESSION_CONTEXT_BASELINE_REQUEST` reach the ChatGPT conversation exactly once.
3. Return a valid `eic.main-task-baseline.v2` whose `current.nextHighLeverageAction` begins with a meta verb such as `Validera`, `Granska`, `Analysera`, `Läs`, `Verify` or `Review`.
4. Verify:
   - exactly one baseline Nano request is bound by `sessionContextInit.nanoRequestId`;
   - Nano `ACCEPT` progresses `DECISION_READY -> COMMITTING -> COMMITTED -> READY`;
   - no `META_ONLY_ACTION` is raised for the baseline;
   - no generic deterministic recovery/local action runs before READY;
   - no second baseline/target prompt is sent;
   - after READY, exactly one ordinary `CONTINUATION_ANALYSIS` Nano request owns the same bound observation.

## Execution-order oracle

5. Drive an ordinary Nano decision to `WAIT_OWNER_EVENT`.
6. Verify:
   - execution disposition is resolved before delivery regulation;
   - material target-dispatch delta is 0;
   - exactly one `CHAT_CONTROL_CONTINUATION` appears in ChatGPT;
   - repeated watchdog/panel/content ticks before the response produce no duplicate wake;
   - terminal Nano cleanup leaves no stale host-busy owner.

7. Drive a genuine `TARGET_DISPATCH` twin with `directProgramDelta=0`.
8. Verify that the material delivery regulator may block it, but the resulting AI-actionable wait still materializes exactly one chat-control continuation.

## Lifecycle/reconcile oracle

9. Interrupt/reload after an ACKED baseline response but before durable baseline commit.
10. Verify local reconciliation can re-observe the same baseline response without sending another target prompt even if an ordinary processed marker equals the response identity.
11. Exercise same-owner response hash churn while baseline Nano is claimed:
    - stale Nano result is rejected;
    - current baseline response rebinds locally;
    - one baseline target prompt total;
    - eventual READY or explicit typed baseline failure.

## Causal wait oracle

12. No `WAITING_FOR_RESPONSE` state may exist with all of:
    - no outbound causal effect;
    - no explicit external event owner;
    - no active response timeout.
13. If response timeout is suspended, verify a real chat-control/effect or external observer owns the wake.

## Failure conditions

- accepted baseline routed through ordinary continuation grounding;
- pre-READY ordinary Nano/recovery/local program mutation;
- `NANO_ANALYZING` owned by a request whose id/type differs from the baseline binding;
- delivery regulator intercepts non-target execution dispositions;
- ACKED baseline response becomes permanently ineligible solely because of a generic processed marker;
- `pendingNanoRequest == null` with stale Nano host ownership;
- UI-only AI-actionable wait;
- waiting state without a causal wake producer;
- duplicate baseline or chat-control prompt.
