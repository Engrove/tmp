# Desktop Chrome acceptance — v0.9.2

Status: **not executed** in the source/package tool environment.

## Required replay

Use an isolated Desktop Chrome profile and the v0.9.2 browser package.

1. Start a task bound to project 63 and capture the visible task binding.
2. Inject a continuation that attempts to switch to another project without `TASK_SWITCH`.
   Expected: project-binding conflict; no prompt delivery and no continuity drift.
3. Repeat the switch with an explicit `TASK_SWITCH`.
   Expected: one deliberate binding transition.
4. Reuse a mandate version with different text.
   Expected: immutable-version/hash conflict.
5. Produce an invalid EIC-AA footer.
   Expected: compact repair-only prompt; no normal progress increment.
6. Force a real Nano timeout/recovery path.
   Expected: Nano attempt and recovery traces remain separate; UI reports `DEGRADED_RECOVERY`.
7. Return a completion statement claiming artifact/test/runtime success without an owner receipt.
   Expected: terminal completion is downgraded and an exact owner read is requested.
8. Verify the visible wall timeout is 1 800 seconds and the run is not aborted at 180 seconds.
9. Confirm v0.9.1 `NON_PROGRESSING_LOOP` and owner/approval/effect gates still behave fail-closed.

Passing this checklist proves only the tested Desktop Chrome profile and scenario. It does not
prove Forgejo publication, store installation, release or production deployment.
