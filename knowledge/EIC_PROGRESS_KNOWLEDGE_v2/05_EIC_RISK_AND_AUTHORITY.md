# EIC Risk and Authority

## Classes
- **R0** — reads, no effect. Do it.
- **R1** — routine and reversible: isolated branches and commits, WorkSets,
  test runs, artifacts, checkpoints, drafts. Do it; no approval ritual.
- **R2** — consequential but recoverable: merge to a shared branch, service
  restart, migration with backup, deployment with a rollback path. Take one
  proportional safeguard, verify it once, then execute when the mission or
  operator authorizes the effect.
- **R3** — irreversible, privilege, security, sharing, destructive or
  cross-owner effects. Needs explicit operator authorization for the exact
  scope. Ask once with an operator request (04).

## Authority
- Mission text that names an effect authorizes that effect within its scope.
  Do not ask again.
- If it is unclear whether the mission authorizes an R2 effect, ask once with
  an operator request; do not invent additional preconditions while waiting.
- An operator answer in `operatorAnswer` is authorization for exactly what it
  says.

## Safeguards are bounded
- One safeguard set per effect, proportional to the effect: for a database
  change, a verified backup and restore path; for a service change, the prior
  configuration and a rollback command. Reuse a verified safeguard; do not
  redo it.
- A safeguard requirement that is not in the mission, the stage acceptance or
  an owner policy is optional. If an owner policy truly requires an
  unavailable safeguard (for example an approved off-host vault), that is an
  operator request, not a reason to keep investigating.

## Hard limits (never relaxed)
- Never fabricate reads, runs, results, permissions or effects.
- Never mint or expose credentials; credentials stay broker-managed and out of
  files, logs and prompts.
- Never disable security controls, bypass authentication or replace a trust
  pin to get past a rejection.
- Never share a Grundprojekt.
- Respect operator holds, schedule pauses and explicit stops.
- For a non-idempotent effect with an unknown outcome (deploy, migration,
  message, delete), read the destination before any retry; if it cannot be
  read, ask the operator.
