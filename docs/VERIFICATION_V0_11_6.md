# v0.11.6 verification

Status: LOCAL SOURCE/PACKAGE CANDIDATE VERIFIED — DESKTOP CHROME LIVE ACCEPTANCE PENDING

## Required behavior

1. A normal decision exceeding 6,000 characters but remaining within the closed decision contract is not terminalized solely by the historical threshold.
2. The hard decision limit is derived from the exact closed `DECISION_SCHEMA`, not a historical field constant.
3. A malformed/incomplete output beyond the derived hard limit still fails boundedly.
4. Raw-chunk, stream-idle and wall-deadline liveness controls remain hard.
5. First-pass normal decision and its single JSON-format repair use the same two-tier policy.
6. Baseline/core-review mode-specific output limits are unchanged.
7. v0.11.5 actor/capability separation and one-diagnostic/no-repeat behavior remain present.

## Executed source verification

- JavaScript/module syntax: **92/92 PASS**.
- Focused schema-bound + actor/diagnostic regression: **16/16 PASS**.
- Derived closed-schema serialized upper bound: **256,567 characters**.
- Derived hard normal-decision limit with margin: **258,615 characters**.
- Required-only maximal decision fixture: **6,221 characters**; it crosses the 6,000 advisory threshold and remains below the hard limit.
- All-declared-properties ordinary-character fixture: **22,707 characters**; it remains below the derived hard limit.
- Bounded event/state-space model: **87 reachable states / 380 explored transitions / 0 safety violations / 0 liveness deadlocks**.

## Claim boundary

Source and package checks prove only this exact local candidate. Final package closure includes
ZIP CRC verification, complete payload-hash readback and a fresh-extraction rerun of all 92
JavaScript/module syntax checks plus the 16 focused schema-bound/actor/diagnostic regressions.
Desktop Chrome runtime behavior, model-provider behavior, installation identity and reload
acceptance require separate live evidence.
