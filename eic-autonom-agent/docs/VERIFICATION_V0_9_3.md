# Verification v0.9.3

## Scope

This record covers the v0.9.3 source/package candidate. It does not claim repository publication, installation, deployment or Desktop Chrome runtime acceptance.

## Direct source results

Executed from the v0.9.3 worktree:

- focused forward/delivery/context fixtures: `22/22 PASS`, exit 0;
- full regression: `626/626 PASS`, exit 0;
- validator: `PASS`, exit 0;
- JavaScript syntax checks: `117/117 PASS`, exit 0;
- package build: `PASS`, exit 0.

## Frozen-source replay

The generated source ZIP was extracted into a clean directory and rerun:

- focused fixtures: `22/22 PASS`, exit 0;
- full regression: `626/626 PASS`, exit 0;
- validator: `PASS`, exit 0;
- JavaScript syntax checks: `117/117 PASS`, exit 0.

## Package integrity requirements

The delivery receipt outside the source archive records final byte sizes and SHA-256 values after the last build.

The final source, standard and browser ZIP files must satisfy:

- ZIP CRC readback;
- no absolute, parent-traversal, symlink or encrypted entries;
- current-version files only in runtime package roots;
- standard/browser common runtime files byte-identical except profile-owned `manifest.json` and `build-info.json`;
- standard profile without debugger/general optional web origins;
- browser profile with the existing bounded debugger and optional-origin contract.

## Claim boundary

Verified here: current source contracts, automated tests, validator, syntax and frozen-source reproducibility.

Not verified here:

- extension installation;
- interactive Desktop Chrome behavior;
- live ChatGPT controller/target runtime;
- Forgejo/Git persistence;
- release, deployment or Chrome Web Store publication.

Desktop Chrome acceptance remains a separate owner surface and checklist.
