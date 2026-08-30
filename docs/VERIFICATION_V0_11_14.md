# v0.11.14 Verification

Status: **LOCAL SOURCE/PACKAGE VERIFICATION — DESKTOP CHROME LIVE ACCEPTANCE PENDING**

## Required invariants

1. Exact v0.11.13 preimage SHA-256 is verified before mutation.
2. The exact previously blocking v0.11.13 `EIC_NEXT` text is not classified level 10 solely
   because it names `USER_PAUSE`; `humanDecisionRequired` must be false.
3. Structured `pauseOrigin=USER_PAUSE` remains level 10 and human-required.
4. Authentication/credential/irreversible lexical level-10 cases remain level 10.
5. v0.11.13 owner-bound state-space invariants remain unchanged.
6. Release identity and current-only storage namespace are coherent at v0.11.14.
7. Fresh post-package extraction repeats syntax, JSON, focused classifier, owner-bound state-space
   and payload-integrity checks.

## Focused counterexamples

- `CONTINUE` test instruction containing `USER_PAUSE/AWAITING_OPERATOR_DECISION` => not level 10.
- Same text with structured `pauseOrigin=USER_PAUSE` => level 10.
- `Log in with a password` => level 10.
- `Permanently delete data` => level 10.

## Claim boundary

Passing these checks proves the local candidate only. Desktop Chrome must confirm the original
false block is gone and the structured user-pause boundary still latches correctly.
