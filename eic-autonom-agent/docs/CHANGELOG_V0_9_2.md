# EIC Autonom Agent v0.9.2 — changelog

## Scope

v0.9.2 is a bounded state-integrity release built from the exact v0.9.1 source package.
It does not change browser permissions, release authorization, deployment authorization or
the separation between Session Context and repository/runtime proof.

## Delivered

- Immutable `active_task_binding` with project, workstream, task fingerprint, audit run,
  mandate version/hash and source turn.
- Explicit `TASK_SWITCH` requirement for project/workstream/task changes.
- Immutable mandate registry: same version plus different SHA-256 fails closed.
- Protocol-invalid target responses enter repair-only flow and do not count as normal progress.
- Separate Nano attempt and deterministic recovery traces with explicit `decisionOwner`.
- Deterministic fallback/recovery status is `DEGRADED_RECOVERY`, not Nano-complete.
- Target-facing self-referential Nano instructions are rejected.
- Claims and inferences are semantically separated; work units and stop conditions are validated.
- Strong artifact/commit/issue/test/runtime/project-update/install/deploy/release claims require
  a fresh owner readback receipt before terminal completion.
- Continuation prompts use full mandate text only for initial delivery or a changed version/hash.
- A single Nano wall-timeout owner is set to `1 800 000 ms`.
- v0.9.1 observation identity, deduplication, two-cycle `NON_PROGRESSING_LOOP` and
  subtask/program terminality remain in force.

## Boundaries

Source and package evidence do not prove an installed extension, Desktop Chrome runtime,
Forgejo persistence, release, deployment or publication.
