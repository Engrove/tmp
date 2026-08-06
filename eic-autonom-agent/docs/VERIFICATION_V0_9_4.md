# Verification — EIC Autonom Agent v0.9.4

## Root-cause fixture

The focused test reproduces the v0.9.3 failure by pairing the Workspace-aware Nano text with `nano-core-v4`. It must fail with `MANDATE_VERSION_HASH_CONFLICT`.

The emit twin applies `nano-core-workspace-v1` with the Workspace-aware text. It must pass and create a separate immutable registry entry.

## Required commands

```text
node --test tests/v094-mandate-profile-binding.test.mjs
npm test
npm run validate
node --check <all .js/.mjs files>
npm run package
```

## Required package checks

- source, standard and browser ZIP CRC pass;
- no absolute paths, parent traversal, encrypted entries or symlinks;
- frozen source reruns focused tests, full regression, validator and syntax;
- package hashes are recorded after the final build.

## Runtime boundary

Node and package verification do not prove Desktop Chrome behavior. The interactive checklist remains a separate owner/runtime gate.


## Direct source results

- focused mandate/profile suite: 7/7 PASS;
- full regression: 633/633 PASS;
- validator: PASS;
- syntax: 118/118 PASS.

The same gates must be rerun from the final frozen source ZIP before package claims are emitted.
