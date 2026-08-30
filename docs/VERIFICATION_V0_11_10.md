# v0.11.10 Verification

Status: **LOCAL SOURCE/PACKAGE CANDIDATE VERIFICATION — DESKTOP CHROME LIVE ACCEPTANCE PENDING**

## Required discriminating checks

1. Exact v0.11.9 preimage ZIP SHA-256 is verified before mutation.
2. Non-side-band no-delta receipt → first equivalent `CHAT_CONTROL_CONTINUATION` uses the same local-rearm bridge identity/digest and returns `LOCAL_STATE_UNCHANGED`, not `MATERIAL_DELTA`.
3. The same cross-boundary check passes for `PROTOCOL_REPAIR`.
4. The corresponding `LOCAL_STATE_UNCHANGED` wake key is identical across the boundary.
5. Side-band → side-band response identity/hash/turn-id churn remains stable.
6. `materialControlGeneration` increment re-arms once.
7. Structured target actor/completion changes re-arm.
8. New task, init episode or material-effect anchor re-arms.
9. Fresh ordinary non-side-band response identity remains material.
10. Exact Nano failure fence still blocks the same failed primary input.
11. v0.11.8 baseline correction fence still allows one correction and exhausts the second same-episode non-ACCEPT.
12. v0.11.7 typed `NANO_INCOMPLETE_JSON` remains.
13. v0.11.6 soft/hard output bounds remain.
14. v0.11.5 actor topology and diagnostic suppression remain.
15. Fresh post-package extraction repeats syntax, focused regressions and payload hash checks.

## Claim boundary

Passing these checks proves only the local v0.11.10 source/package candidate. Desktop Chrome runtime behavior, exact installed-byte provenance, correction-fence live behavior, baseline dispatch lifecycle, Capture/Memory and reload acceptance require separate live evidence.

## Executed source verification

- Exact v0.11.9 preimage ZIP SHA-256: `75ff474683e4fe31cc27040c9099e93e0208326928d3ae7b0fbc0b71d08287ca`.
- JavaScript/module syntax: **94/94 PASS**.
- Focused cross-boundary + preservation regression: **27/27 PASS**.
- Cross-boundary finite matrix: **16 states / 112 checks / 0 violations**.
- Differential guard: representative ordinary non-side-band `observationMaterialKey` and `materialDecisionInputKey` are byte-for-byte identical to exact v0.11.9.
- The focused suite includes the missing v0.11.9 case: non-side-band no-delta receipt → first equivalent `CHAT_CONTROL_CONTINUATION` / `PROTOCOL_REPAIR` child.
- It also verifies that once the prior receipt is already side-band, a substantive `EIC_NEXT` text change still re-arms rather than being hidden by the bridge.
- Fresh post-package extraction must repeat the syntax, focused regression, matrix and payload-hash checks before delivery.
