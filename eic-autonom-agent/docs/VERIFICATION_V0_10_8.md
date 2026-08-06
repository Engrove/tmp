# Verification v0.10.8

## Baseline

- Input: exact v0.10.7 source ZIP.
- Baseline SHA-256: `2d7fa3263f020c71b5d66a9361a80e90d681ab593725205815609d4767f87460`.
- Baseline regression before modification: `807/807 PASS`.

## Focused v0.10.8 fixtures

Command:

```text
node --test tests/v0108-main-task-audit.test.mjs
```

Result: `11/11 PASS`.

Covered block/emit pairs and wiring:

- complete baseline parses; incomplete baseline fails closed;
- justified detour with reason/return/80-20 enabler passes; missing return condition fails;
- drift without a correction fails;
- missing baseline produces the canonical first Nano request;
- safe operator-selected audit basename passes; unsafe/path-like name fails;
- v0.10.6/v0.10.7/v0.10.8 segment names pass the version-neutral matcher;
- sidepanel source carries permission plus write/readback/delete probing;
- background source arms baseline intake and withholds protocol fast path until baseline exists.

## Full regression

Command:

```text
npm test
```

Result: `818/818 PASS`.

## Contract validator and syntax

Command:

```text
npm run validate
```

Result:

- validator PASS;
- `159/159` JavaScript syntax checks PASS.

## Package build

Command:

```text
npm run package
```

Result:

- SOURCE PASS;
- STANDARD PASS;
- BROWSER PASS;
- build-info file-hash generation PASS;
- profile package-digest generation PASS.

Final package hashes are recorded in the delivery manifest and final report generated with the package.

## Claim boundary

These results verify the local source/package candidate and the listed automated gates. They do not prove:

- installation in the operator's Desktop Chrome profile;
- File System Access picker/write behavior in that installed profile;
- live Nano baseline/track classification in that profile;
- Forgejo persistence, merge, tag or release;
- deployment, installation or publication.

Installed-runtime acceptance is specified in `docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_8.md`.
