# ADR 004 — Structured one-action browser protocol

## Status
Accepted for v0.9.0 planning.

## Decision
Use versioned `EIC_BROWSER_ACTION/1` and `EIC_BROWSER_OBSERVATION/1` contracts. One AI response may
request at most one action from the approved registry.

Arbitrary JavaScript, function calls, cookie mutation and request mutation are forbidden.

## Rationale
A fixed schema permits validation of operation, element reference, document epoch, origin, risk,
expected effect and receipt before execution.

## Consequences
WP08 owns parser, validator and executor. Unknown fields/operations, stale locators and mismatched
epochs fail closed.
