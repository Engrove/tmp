# v0.11.8 Verification

Status: **LOCAL SOURCE/PACKAGE CANDIDATE VERIFICATION — DESKTOP CHROME LIVE ACCEPTANCE PENDING**

## Required discriminating checks

1. Exact v0.11.7 preimage is verified before mutation.
2. `parseMainTaskBaseline` still accepts a strict minimal required `eic.main-task-baseline.v2`.
3. First Nano baseline non-ACCEPT in one init episode returns `ALLOW_CORRECTION`, generation `1`.
4. Second non-ACCEPT in the same episode returns `EXHAUSTED` and must reach `BASELINE_CORRECTION_EXHAUSTED` / `PROGRAM_BLOCKED` before any third baseline target effect is built.
5. Fresh baseline response identities alone do not re-arm the correction budget.
6. A changed pre-baseline catch identity or a newly created session-init episode re-arms one correction generation.
7. v0.11.7 typed JSON-completeness behavior remains present.
8. v0.11.6 output-bound behavior remains present.
9. v0.11.5 actor/capability and one-diagnostic/no-repeat controls remain present.
10. Fresh post-package extraction repeats syntax and focused regression checks.

## Claim boundary

Passing these checks proves only the local v0.11.8 source/package candidate. Desktop Chrome runtime, installed-byte provenance, actual Nano ACCEPT/REJECT behavior, Capture/Memory and reload acceptance require separate live evidence.


## Executed local source verification

- JavaScript/module syntax: **94/94 PASS**.
- Focused baseline-fence + preservation regression: **20/20 PASS**.
- Bounded correction state-space model (depth 7): **34 reachable states / 116 transitions / 0 safety violations / 0 nonterminal liveness deadlocks**.
- Discriminating parser check: strict minimal required `eic.main-task-baseline.v2` parses with `valid=true`.
- Counterexample closure: changing only the baseline response identity does **not** re-arm correction; changing the pre-baseline catch identity or creating a new session-init `needKey` does.

Fresh post-package extraction must repeat syntax/focused checks before delivery.
