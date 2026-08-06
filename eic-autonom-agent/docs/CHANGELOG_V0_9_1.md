# EIC Autonom Agent v0.9.1 — changelog

## Bounded work unit

- Added deterministic `eic.autonom.observation-loop.v1` state.
- Added stable observation identity derived from stable goal, active work unit, owner locators,
  claim boundary and normalized observation content.
- Added deterministic context/Twin/receipt reference reuse for unchanged identity.
- Added strict two-cycle `NON_PROGRESSING_LOOP` cutoff.
- Added exactly-one post-cutoff owner-read, subsystem-pivot or bounded-stop consumption.
- Added explicit `SUBTASK_DONE`, `PROGRAM_CONTINUE`, `PROGRAM_DONE` and
  `EIC_AUTONOMY` terminality projection.
- Added Nano activation-key reuse for unchanged trusted local host session, version and binding.
- Added matched block/emit fixtures and strict unknown-field rejection.
- Added compact Decision Capsule validation with at most two locators.

## Preserved boundaries

Trusted-session, owner-route, claim, approval, browser-risk, release, deployment and
installation gates are unchanged. Session Context, Twin Case and receipts remain routing
or continuity records, not repository or runtime proof.

## Deferred

The Nano timeout remains 180 seconds in this unit. The mandated 1 800-second change is a
separate work unit requiring owner-read of the constant, consumers, migration/configuration,
UI, fixtures, validator, abort and recovery semantics.
