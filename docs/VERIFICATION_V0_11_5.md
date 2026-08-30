# v0.11.5 verification

Status: LOCAL SOURCE/PACKAGE CANDIDATE VERIFICATION — DESKTOP CHROME LIVE ACCEPTANCE PENDING

## Required behavior

1. v0.11.4 actor/capability topology remains present.
2. A terminal Nano failure preserves bounded root diagnostics.
3. First unchanged-input recovery emits exactly one `NANO_FAILURE_DIAGNOSTIC` control envelope.
4. The envelope contains `diagnostics.nanoFailure`.
5. A repeated equivalent failure generation emits no further chat-control and enters `PROGRAM_BLOCKED`.
6. A materially new failure/input generation may produce a new diagnostic.
7. No prompt body, provider output or hidden EIC state is carried in the diagnostic.

## Claim boundary

Local source/package checks prove only this candidate copy. Desktop Chrome runtime behavior,
provider failure class, installation and reload acceptance require separate live evidence.

## Executed local verification

- JavaScript/module syntax: **91/91 PASS**.
- Focused terminal Nano failure + actor/capability regression: **15/15 PASS**.
- Bounded event/state-space model: **13 reachable states / 55 explored transitions / 0 safety violations / 0 liveness deadlocks / frontier_inconclusive=false**.
- Implementation binding:
  - `background.js`: `e128288f3f56f0a7d5e6fd1f0d9f1bc8fd5649d71cb1769e387be76fc48d0caa`
  - `lib/execution-routing.mjs`: `c6e560b00c3e79567f971a0ea6041734303d968d1a8ac86bc820ed840faf7017`
  - `lib/prompt-contract.mjs`: `14f90da6119a3d1686837211b9405706fdb5cbc657cc120f40a010c84b9ffc72`

Package verification and a fresh post-package extraction rerun are required before delivery.

