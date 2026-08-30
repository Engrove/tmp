# Verification v0.11.22

## Claim boundary

These are local source/package checks. They do not establish Desktop Chrome installed-byte
identity, live runtime acceptance, repository persistence, deployment or production readiness.

## Focused regression requirements

1. `EIC sade:` + an otherwise exact five-line EIC-AA/5 trailer canonicalizes to the exact trailer.
2. The strict protocol parser rejects the unnormalized presentation string and accepts the
   canonicalized response.
3. A concatenated completed reasoning disclosure (`Worked for 2m 54s...`) is removed while the
   final response remains intact.
4. An ordinary invalid response selects one `REPAIR`.
5. An invalid response to `PROTOCOL_REPAIR` selects `REPAIR_EXHAUSTED`, never Nano.
6. A valid response to `PROTOCOL_REPAIR` selects deterministic `FAST_PATH`.
7. DELIBERATIVE_ACCEPT requires a materially different rejected alternative and concrete basis.
8. A plain echo ACCEPT without alternative/no-material justification fails with
   `NANO_DISCRIMINATION_REQUIRED`.
9. A justified no-material-alternative ACCEPT is classified `VALIDATOR_ACCEPT`, not independent
   planning.
10. MODIFY/REJECT must be materially different from the target action.
11. Candidate actions must include both the selected action and the owner-known target/baseline candidate.
12. `executorActor` must match the executor owned by the registered selected micro-action.
13. Nano cannot self-attest independent judgment; the runtime derives it.
14. Baseline analysis remains on its dedicated baseline schema/path.

## Package checks

- all JavaScript/MJS files parse with `node --check`;
- all JSON files parse;
- current release/config/runtime/export/storage/Session DB/alarm identities are coherent;
- state-registry source values remain present;
- build-info file hashes match every packaged payload;
- canonical package digest recomputes exactly;
- ZIP CRC passes;
- no duplicate, encrypted, symlink or unsafe-path entries exist;
- focused regressions pass again from a fresh extraction of the final ZIP.

## Required live follow-up

Use the exact packaged v0.11.22 ZIP in Desktop Chrome and replay the v0.11.21 shape:
READY -> ordinary continuation -> protocol response. The run must neither produce a speaker-label
false protocol repair nor alternate repair/chat-control generations.
