# v0.11.9 Verification

Status: **LOCAL SOURCE/PACKAGE CANDIDATE VERIFICATION — DESKTOP CHROME LIVE ACCEPTANCE PENDING**

## Required discriminating checks

1. Exact v0.11.8 preimage ZIP is verified before mutation.
2. Equivalent side-band observations that differ only by response identity/hash/turn ids produce identical observation material keys.
3. The same pair produces identical `materialDecisionInputKey`.
4. The same pair produces identical chat-control wake keys.
5. `evaluateLocalNanoRearm` returns `LOCAL_STATE_UNCHANGED` for that equivalent side-band pair.
6. Incrementing `materialControlGeneration` changes the key and permits one material reanalysis.
7. Substantive side-band target-control changes re-arm.
8. A new task or init episode re-arms.
9. Non-side-band response identity remains material.
10. v0.11.8 baseline correction fence still allows one correction and exhausts the second same-episode non-ACCEPT.
11. v0.11.7 typed `NANO_INCOMPLETE_JSON` remains.
12. v0.11.6 soft/hard output bounds remain.
13. v0.11.5 actor topology and diagnostic suppression remain.
14. Fresh post-package extraction repeats syntax/focused checks.

## Claim boundary

Passing these checks proves the local v0.11.9 source/package candidate only. Desktop Chrome runtime behavior, installed-byte provenance, actual side-band no-repeat behavior, baseline dispatch lifecycle, Capture/Memory, and reload acceptance require separate live evidence.

## Executed local source verification

- Exact v0.11.8 preimage ZIP SHA-256: `3d0fb8ee328cb3e463426f6ef53327ecc731e03eb83de5cb9ded90f78b3da829`.
- JavaScript/module syntax: **94/94 PASS**.
- Focused semantic side-band + preservation regression: **26/26 PASS**.
- Side-band finite state matrix: **16 states / 352 checks / 0 violations**.
- Differential guard: representative non-side-band `materialDecisionInputKey` is byte-for-byte identical between v0.11.8 and v0.11.9.
- Strongest truncation counterexample: target-control change after 900 identical characters still changes the bounded semantic key and re-arms.
- Preserved helper hashes remain exact for the v0.11.8 baseline-correction fence, v0.11.7 JSON-completeness module, v0.11.6 output-bounds module, prompt contract, and session-context-init module.

Fresh post-package extraction must repeat syntax, focused regression, state matrix and payload-hash verification before delivery.
