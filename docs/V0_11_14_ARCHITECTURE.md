# v0.11.14 Architecture

Status: **LOCAL SOURCE/PACKAGE CANDIDATE — DESKTOP CHROME LIVE ACCEPTANCE PENDING**

## Purpose

v0.11.13 live initialization was blocked even though the target protocol result was
`CONTINUE` with `EIC_NEXT_ACTOR: AGENT`. The continuation text named the later
`USER_PAUSE/AWAITING_OPERATOR_DECISION` test. `classifyDestructiveness()` included raw
`requestedAction`/`targetNext` text in its lexical effect classifier, and `LEVEL_10`
also contained the literal regex `USER_PAUSE`. That made a control-protocol noun look
like an actual level-10 human-authority effect.

## Root-cause fix

`USER_PAUSE` is a structured protocol state, not a lexical external effect.

- `pauseOrigin=USER_PAUSE` continues to return level 10 before lexical classification.
- The bare word `USER_PAUSE` is removed from the lexical `LEVEL_10` pattern list.
- Authentication, CAPTCHA, credentials, irreversible/destructive and other level-10
  effect patterns are unchanged.
- A `CONTINUE` action may therefore discuss or test `USER_PAUSE` without becoming a
  `TARGET_REQUESTED_PAUSE` hard boundary solely because of the marker text.

This preserves the safety boundary while separating structured control semantics from
effect-text hazard semantics.

## Preservation

The v0.11.13 owner-bound transition invariant and receipt-authorized exits are unchanged.
v0.11.11 diagnostics, v0.11.10 bridge semantics, baseline correction, Nano completeness/
bounds, actor routing and effect integrity are unchanged.

## Claim boundary

Source/package tests do not prove installed Desktop Chrome behavior. Live acceptance must
confirm that the previously blocking baseline now remains `CONTINUE`, while a real structured
`USER_PAUSE` still enters `AWAITING_OPERATOR_DECISION`.
