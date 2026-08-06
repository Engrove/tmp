# ADR 002 — Explicit controller and target roles

## Status
Accepted for v0.9.0 planning.

## Decision
Model `CHATGPT_CONTROLLER` and `WEB_TARGET` as separate surface identities with independent tab,
origin, document-epoch, lifecycle and permission state.

## Rationale
v0.8.2 `selectedTabId` represents a selected ChatGPT continuation target. Overloading it for an
arbitrary website would create ambiguous recovery, origin and effect ownership.

## Consequences
WP05 introduces pairing and lifecycle state. Existing ChatGPT attachment behavior remains
compatible through migration/adapters.
