# ADR 006 — Manual WP gates

## Status
Accepted by operator instruction on 2026-08-04.

## Decision
Do not use the autonomous addon to implement v0.9.0. Execute one WP manually, present evidence and
wait for explicit approval before the next WP.

## Rationale
The operator explicitly replaced the transcript's autonomous Nano method with manual approval
between every step/gate.

## Consequences
The ledger state `WAITING_APPROVAL` is a hard process gate. It is not an implementation blocker and
must not be bypassed by automation.
