# ROOT CAUSE — v0.12.10

## Incident

Desktop Chrome v0.12.9 repeatedly reported:

`AUTOSTART_PRECONDITION_FAILED: Ingen ChatGPT-flik är vald.`

The same runtime evidence also recorded a successful native
`LanguageModel.create()` admission and local canary, followed by a later
Autostart failure and a stale Nano presentation.

## Discriminated mechanism

The failure is an Autostart transaction-ordering defect, not a LanguageModel
availability failure.

`autostartClick()` previously:

1. applied the selected scenario profile, which could mark an existing verified
   Nano base stale;
2. ran `evaluateAutostartPrecondition()` against cached `selectedTabId`;
3. rejected when that cached id was absent;
4. only later, in unreachable code for that case, attempted `LINK_ACTIVE_TAB`.

This contradicted the Autostart plan contract: every packaged Autostart preset
owns active-tab linking. The precondition required the result of a step that the
same transaction was supposed to perform.

The v0.12.9 runtime log independently shows native LanguageModel admission and
canary verification before the final repeated `NO_SELECTED_TAB` failure. The
target was later linked successfully by the manual link path, further
discriminating target-selection ordering from model-host failure.

## Violated invariant

An operation must not require a resource as a pre-existing condition when that
operation itself owns deterministic acquisition and readback of that resource.

A failed staged Autostart must also not invalidate a previously verified Nano
base before the target-binding gate has been resolved.

## Repair

v0.12.10:

- lets `evaluateAutostartPrecondition(..., {linkActiveTab:true})` defer cached
  target identity to the authoritative post-link readback;
- keeps the mandatory native `LanguageModel.create()` call inside the explicit
  operator gesture and before the first awaited message hop;
- performs `LINK_ACTIVE_TAB` and `assertAutostartTabBinding()` before config
  commit;
- stages scenario/Nano profile changes with `markNanoStale:false`;
- preserves/restores a previously verified base session if a staged replacement
  fails before commit;
- commits the staged config only after target binding and Nano admission;
- uses `AKTIVERA NANO` rather than the ambiguous `OMSTART KRÄVS` badge.

## Claim boundary

This is a source/log causal repair. Desktop Chrome acceptance of the exact
v0.12.10 package remains a separate runtime gate.
