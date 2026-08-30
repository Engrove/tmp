# v0.11.4 verification

Status: LOCAL SOURCE/PACKAGE CANDIDATE VERIFICATION — DESKTOP CHROME LIVE ACCEPTANCE PENDING

## Required behavior

1. `EIC_NEXT_ACTOR: EIC_AI_SESSION` is valid EIC-AA/5 syntax.
2. `EIC_AI_SESSION`, `AGENT`, `NANO`, `EXTERNAL_SYSTEM` and operator actors have explicit non-overlapping capability roles.
3. `AGENT` cannot inherit EIC owner-route capability from owner prose.
4. `NANO` receives only explicit bounded context and an actor-filtered action catalog; it is never an executor.
5. `EXTERNAL_SYSTEM` cannot select local or target/chat-control transport.
6. True external dependencies enter `PROGRAM_BLOCKED` without chat-control.
7. Existing built-in workspace profiles refresh to actor-aware mandate versions.
8. Existing EIC-AA/5 actor values remain parse-compatible.

## Executed local verification

- JavaScript/module syntax check: **91/91 PASS**, zero syntax failures.
- Focused actor/capability regression: **13/13 PASS** in `v0114-actor-capability-routing.test.mjs`.
- Event/state-space analyzer: **27 reachable states / 100 explored transitions / 0 safety violations / 0 liveness deadlocks / frontier_inconclusive=false**, bound to exact `execution-routing`, `background`, `nano-pipeline` and `core-profiles` bytes.
- Package verification rehashes all payload files, recomputes `packageDigest`, checks ZIP CRC/path safety/symlink absence and reruns the focused tests against a fresh post-package extraction.

The exact test counts, implementation hashes and package identity are recorded at candidate build time in project chronology. They are local candidate evidence only.

## Claim boundary

This document does not claim installation, Desktop Chrome runtime acceptance, Forgejo persistence,
deployment, release publication or live external-owner behavior.
