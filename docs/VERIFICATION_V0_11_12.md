# v0.11.12 Verification

Status: **LOCAL SOURCE/PACKAGE CANDIDATE VERIFICATION — DESKTOP CHROME LIVE ACCEPTANCE PENDING**

## Required checks

1. Exact v0.11.11 preimage ZIP SHA-256 is verified before mutation.
2. `operatorActionBoundaryEligible()` accepts only a valid `OPERATOR_ACTION_REQUIRED` + `OPERATOR_ACTION` tuple with bounded completion states.
3. `protocolFastPathEligible()` includes that tuple while ordinary `CONTINUE` remains Nano-routed.
4. `tickWindowUnlocked()` performs the operator-action latch immediately after `parseTargetResult()` and before observation identity, baseline parsing, Nano routing, protocol repair and deferred mission logic.
5. The immediate latch marks the response identity processed before waiting.
6. `enterOperatorActionWait()` clears pending Nano/observation/candidate state, suspends timeout and enters `AWAITING_OPERATOR_ACTION`.
7. A still-undispatched prepared effect is cancelled; ACKED/submitted history is not rewritten.
8. `executePreparedEffectUnlocked()` refuses dispatch while `AWAITING_OPERATOR_ACTION` is active.
9. `applyNanoDecisionCommandUnlocked()` has a defensive operator-action latch before Nano/session-init application.
10. `tickWindowUnlocked()` still returns immediately while awaiting operator action.
11. `pauseRequiresHuman()` and snapshot `boundaryRequiresOperator` include `AWAITING_OPERATOR_ACTION`.
12. `controlRun("RESUME")` cannot resume `AWAITING_OPERATOR_ACTION`; only `submitOperatorActionEvidence()` owns that state.
13. Existing v0.11.11 typed one-shot local-state diagnostics remain byte-identical in their owning modules except version-neutral callers.
14. v0.11.10 cross-boundary bridge, v0.11.8 correction fence, v0.11.7 JSON completeness, v0.11.6 output bounds and actor/capability routing remain preserved.
15. Fresh post-package extraction repeats syntax, focused invariants and payload-hash verification.

## Executed local verification

- Exact v0.11.11 preimage ZIP SHA-256: `47500212046ff5d76907868c40aca7378bcda222fc1cfd1f664cf36edcc89a48`.
- JavaScript/module syntax: **94/94 PASS**.
- JSON parse: **22/22 PASS**.
- Focused operator-action dominance regression: **32/32 PASS**.
- Operator-action eligibility matrix: **128 states / 128 checks / 0 violations**.
- Preserved modules remain byte-identical to exact v0.11.11 for `lib/execution-routing.mjs`, `lib/prompt-contract.mjs`, `lib/operator-action.mjs`, baseline correction, Nano JSON completeness, Nano output bounds and session-context init.
- Fresh post-package extraction must repeat the same syntax, JSON, focused and matrix checks, plus ZIP CRC/path/symlink/encryption and payload-hash verification.

## Claim boundary

Passing these checks proves only the local v0.11.12 source/package candidate. Desktop Chrome must separately show that an observed `OPERATOR_ACTION_REQUIRED` response immediately enters operator wait and produces no Nano request, protocol-repair/chat-control prompt, deferred mission start or prepared target dispatch until a valid operator-action receipt is submitted.
