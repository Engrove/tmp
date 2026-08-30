# v0.11.11 Verification

Status: **LOCAL SOURCE/PACKAGE CANDIDATE VERIFICATION — DESKTOP CHROME LIVE ACCEPTANCE PENDING**

## Required discriminating checks

1. Exact v0.11.10 preimage ZIP SHA-256 is verified before mutation.
2. `diagnostics.localState` normalizes, validates and serializes through the EIC-AA/5 JSON envelope.
3. A turn carrying both `diagnostics.nanoFailure` and `diagnostics.localState` is rejected.
4. The local diagnostic contains the bounded prior/current receipt, structured target, material-control, session-init, material-effect and chat-control receipt fields required for bridge discrimination.
5. Candidate wake generation/status/timestamp changes do not change the local diagnostic generation key.
6. A structured target completion/actor material change changes the diagnostic generation key.
7. `shouldEmitLocalStateDiagnostic()` emits the first generation and suppresses the same key thereafter.
8. The no-delta background branch sends `diagnostics.localState` only after `evaluateLocalNanoRearm()` returned `LOCAL_STATE_UNCHANGED`.
9. Same-generation diagnostic suppression creates no new chat-control wake.
10. Existing `diagnostics.nanoFailure` behavior remains available.
11. v0.11.10 cross-boundary bridge behavior remains unchanged.
12. v0.11.8 baseline-correction fence remains unchanged.
13. v0.11.7 typed `NANO_INCOMPLETE_JSON` remains.
14. v0.11.6 output bounds remain.
15. v0.11.5 actor/capability topology remains.
16. Fresh post-package extraction repeats syntax, focused regression and payload-hash checks.

## Claim boundary

Passing these checks proves only the local v0.11.11 source/package candidate. Desktop Chrome runtime behavior, exact installed-byte provenance, live bridge diagnosis, correction-fence behavior, baseline dispatch lifecycle, Capture/Memory and reload acceptance require separate live evidence.

## Executed source verification

- Exact v0.11.10 preimage ZIP SHA-256: `9b18f64cb5e51023a901be166f036cdf7d628c3231de1c9ea973e22d6817ddf1`.
- JavaScript/module syntax: **94/94 PASS**.
- JSON parse: **21/21 PASS** before build-info regeneration.
- Focused diagnostic + preserved-routing regression: **40/40 PASS**.
- Diagnostic transport compilation: **2/2 PASS**.
- Diagnostic-key finite matrix: **16 states / 16 checks / 0 violations** for transport-only churn.
- Static background/contract invariants: **10/10 PASS**.
- Differential guard: representative v0.11.10 observation/material/bridge/wake identities and bridge rearm decision are unchanged.
- Preserved helper hashes remain byte-identical to exact v0.11.10 for the baseline-correction fence, Nano JSON completeness, Nano output bounds and session-context-init modules.
- Fresh post-package extraction: **94/94 syntax PASS**, **21/21 JSON PASS**, **40/40 focused PASS**, **2/2 diagnostic compile PASS**, diagnostic-key matrix **16 states / 16 checks / 0 violations**, static invariants **10/10 PASS**, ZIP CRC PASS, unsafe paths 0, symlinks 0, encrypted entries 0, and **231/231 payload hashes exact**.
