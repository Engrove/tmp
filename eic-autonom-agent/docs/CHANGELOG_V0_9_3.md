# Changelog v0.9.3

## Binding product decision

v0.9.3 and every later release are forward-only. No backward compatibility, schema migration, emulation or compatibility adapter is a product requirement. Unsupported prior state and exports fail closed or start a fresh current-version namespace.

## Delivery and control plane

- Added a delivery regulator bound to primary goal, active milestone, bounded unit, proposed action and direct program delta.
- A zero-delta process branch stops unless one exact owner/safety action has a concrete omission failure and unlock.
- Added a six-capability admission chain for edit, test, persist, publish, install and readback.
- Separated unit completion, milestone continuation, program blocking and terminal program completion.

## Context engineering

- Replaced full prompt/history replay with a compact reference-plus-delta context router.
- Nano no longer copies previous assistant prose or complete conversation excerpts into its decision request.
- Prompt contracts describe goals, interfaces and hard boundaries while allowing judgment inside those boundaries.
- Runtime documentation is reduced to current router and current-contract documents.

## Evidence and transport

- Added explicit evidence classes: owner live, owner receipt, owner historical, derived view, local candidate, routing context and dry run.
- Added opaque masking for session locators, lock/confirmation tokens, preflight receipts and credential/secret references before rendering.
- Strong effect claims remain bound to owner receipts.

## Forward-only cleanup

- Removed active migration modules and old-schema import support.
- Removed UI compatibility aliases and schema-less command acceptance.
- Removed legacy mandate exports and compatibility profiles.
- Removed the unversioned standard-package alias.
- Historical documents remain archival and non-normative.

## Source basis

The change was designed from the operator-provided EIC/Nano audit and Claude Code context-engineering analysis, then implemented against the exact v0.9.2 source baseline. External context-engineering ideas were applied only where they preserved EIC owner-route, trusted-session, claim and effect boundaries.
