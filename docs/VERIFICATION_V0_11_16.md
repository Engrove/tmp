# Verification v0.11.16

Required source/package checks:

- exact v0.11.15 preimage SHA-256 match;
- all JavaScript/module syntax checks;
- all JSON parse checks;
- response-settle liveness regression;
- exact v0.11.15 live-shaped incident:
  `stableReads=2`, probe due, terminal protocol evidence, deadline exceeded, later reconcile tick;
  owner-drain priority must be true and the candidate must settle/process or typed-fail;
- counterexample: genuine foreground streaming/composer-busy evidence must not receive owner-drain priority;
- static ordering: priority is computed after `reconcileEffect()` and gates autonomous Nano/recovery
  branches before the ordinary response-candidate block;
- bounded failure fixtures for both unsettled and completion-policy-ineligible terminal candidates;
- Core Surface Review contradiction fixture:
  `PROPOSE_CHANGES` + all-`OK` findings + stray profile patch canonicalizes to `NO_CHANGE`;
- positive Core Surface Review twin:
  `CHANGE_RECOMMENDED` + concrete patch remains material;
- explicit `NO_CHANGE` dominates stray patch/surface fields;
- v0.11.15 response-settle timer/alarm regression;
- v0.11.14 destructiveness regression;
- v0.11.13 owner-bound functional/state-space regression;
- release-identity consistency;
- fresh post-package extraction repeat;
- ZIP CRC/path/symlink/encryption/duplicate checks and exact build-info payload hashes.

Desktop Chrome runtime acceptance remains separate from source/package verification.
