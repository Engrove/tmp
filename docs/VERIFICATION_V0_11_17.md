# Verification v0.11.17

Source/package verification is intentionally broader than the previous response-settle point fixes.

## Required invariants

1. One assistant response identity has at most one active settle/effect-response owner.
2. `RESPONSE_CANDIDATE -> PENDING_OBSERVATION` is an atomic transfer.
3. A processed response cannot remain an active candidate.
4. An effect source response cannot become the response to its own effect.
5. A non-ACKED effect owns the tick before response admission.
6. Human-owned waits dominate all autonomous watchdog/recovery work.
7. Terminal parent state closes active session-init/Nano/response child state.
8. Liveness timeout applies only to an `ACTIVE` causal response candidate.
9. Full response identity wins over response hash when both are available.
10. Wake source (content event, local timer, alarm, watchdog, startup restore, reconcile) does not change semantic ownership.

## Source-level suites

The release candidate must pass:

- exact v0.11.16 incident replay, including dual-owner rejection, source-response exclusion,
  identical-text/new-identity admission and atomic candidate transfer;
- binary-tree control-plane state space across every run/session-init/effect-journal status plus Nano/page/candidate/wake axes;
- response-ownership lifecycle state space across cycle/effect/candidate/page/run-owner axes;
- independent session-init/Nano state-space regression;
- source-derived state-registry drift check (45 groups / 298 values for this release);
- static architecture/ordering checks;
- response-settle liveness, live-shaped incident, event-chain and counterexample fixtures;
- preserved owner-bound human transition suite;
- preserved functional suite and destructiveness classification;
- all JavaScript/module syntax checks;
- all JSON parse checks.

## Packaging

After `build-info.json` is regenerated from the final payload:

- every payload file SHA-256 must match `build-info.json`;
- `packageDigest` is SHA-256 of canonical JSON `{"files": <sorted file->sha256 map>}`;
- ZIP entries must have no duplicates, unsafe paths, symlinks or encryption;
- ZIP CRC must pass;
- the same source/static/state-space suites must pass again against a fresh post-package extraction.

Desktop Chrome/runtime acceptance remains a separate owner boundary.  Source/package PASS is not a
runtime, installation or production PASS.
