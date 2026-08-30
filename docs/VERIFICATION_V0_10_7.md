# Verification — EIC Autonom Agent v0.10.7

## Baseline

- Source: exact v0.10.6 source ZIP.
- SHA-256: `ff7a6a4136b178c4fbd35fb476f61e906fcc93e43682729df82a6cebfbf0938c`.
- Baseline regression before modification: 802/802 PASS.

## Focused hotfix gates

Command:

`node --test tests/v0107-delivery-regulator.test.mjs tests/v0104-attention-router.test.mjs`

Result: 8/8 PASS.

Covered twins:

- valid unresolved-owner EIC-AA/5 CONTINUE emits a complete required-control contract;
- concrete bounded continuation emits a positive direct program delta;
- genuine incomplete zero-delta CONTINUE becomes a stable new-evidence wait;
- background lifecycle consumes the rejected response identity without `SOFT_PAUSED`;
- owner-evidence wait is visible in the attention surface.

## Full regression

Command: `npm test`

Result: 807/807 PASS.

## Validator and syntax

Command: `npm run validate`

Result:

- validator PASS;
- current-version contract PASS;
- 157/157 JavaScript/MJS syntax checks PASS.

A separate `node --check` traversal over the same 157 files also returned 157/157 PASS.

## Packaging and archive integrity

Command: `npm run package`

Result:

- SOURCE package PASS;
- STANDARD package PASS;
- BROWSER package PASS;
- 131/131 build-info file hashes verified in every profile;
- package-digest recomputation PASS;
- ZIP CRC PASS;
- unsafe archive paths: 0;
- symlinks: 0;
- encrypted entries: 0.

## Frozen-source acceptance

The final generated source ZIP was extracted into a clean directory and rerun with:

- `npm test`;
- `npm run validate`;
- `npm run package`.

Result: full regression, validator, syntax and packaging PASS from the frozen source tree.

## Claim boundary

Verification applies to the local v0.10.7 source/package candidate. It does not prove:

- installed Desktop Chrome runtime behavior;
- that the original browser profile has loaded v0.10.7;
- live external owner-route effects;
- Forgejo persistence, merge, tag or release;
- deployment, installation or publication.

Installed-runtime acceptance remains governed by
`docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_7.md`.
