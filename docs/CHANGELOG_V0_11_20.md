# Changelog v0.11.20

## Fixed

- `AUTHORIZE_BOUNDARY`, operator-action evidence submission, and session-context purge now pass the
  root runtime object to `writeRuntimeBundle()` instead of the `readRuntimeBundle()` wrapper. A
  typed `RUNTIME_ROOT_REQUIRED` invariant prevents the same wrapper/root misuse from silently
  reappearing.
- Boundary authorization now persists first and is explicitly read back before the UI/audit may say
  that a material operator decision was accepted. Failed writes therefore no longer emit a
  misleading success event.
- USER_PAUSE boundary identity is derived after the run has entered its final
  `AWAITING_OPERATOR_DECISION` state. The run, operator decision and later authorization therefore
  share one canonical boundary key.
- Model-authored `USER_PAUSE` is internalized when, and only when, Nano selected a registered
  no-effect route (`LOCAL_EXECUTE`, `WAIT_OWNER_EVENT`, or `WAIT_EXTERNAL_EVENT`) and the target
  protocol itself contains no human/operator boundary. This removes unnecessary caller-visible
  level-10 gates without weakening target/user/safety/authorization/operator boundaries.
- The first ordinary post-READY handoff no longer reuses init-only `EIC_NEXT` /
  `EIC_NEXT_ACTOR` metadata from the accepted baseline response. It projects the accepted
  baseline's `current.nextHighLeverageAction` into an actor-neutral READY handoff while retaining the
  original target result separately for audit.
- Release/runtime/config/export/Session DB/alarm identities are advanced to v0.11.20 current-only
  namespaces.

## Preserved

v0.11.19 conversation isolation, canonical response extraction, Session Memory provenance,
placeholder filtering, retry-fence reset, passive true-external wait, protocol-trailer parsing,
terminal Nano ownership finalization and v0.11.18 CATCH/source-response ownership repair remain in
place.

## Claim boundary

This release is a source/package candidate. Desktop Chrome installation, runtime behavior,
operator-boundary readback and production acceptance require a fresh live acceptance run.
