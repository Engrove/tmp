# EIC Autonom Agent v0.9.2 — verification

## Direct source runs

- Focused state-integrity suite: `23/23 PASS`.
- Full Node regression: `624/624 PASS`.
- Validator: `PASS`.
- JavaScript/MJS syntax: `126/126 PASS`.
- Frozen-source rerun: focused `23/23 PASS`, full regression `624/624 PASS`, validator `PASS`, syntax `126/126 PASS`.

The counts above are copied from direct command summaries and exit status; they are not
arithmetically inferred.

## Discriminating fixtures

The focused suite contains both block and emit behavior for task switching, immutable mandate
versions, owner-receipt claims and Nano/recovery trace ownership. Block-only behavior is not
described as full utility coverage.

## Claim boundary

These runs verify the exact local source tree only. Desktop Chrome behavior, installation,
Forgejo state, release state and deployment remain separate owner domains.
