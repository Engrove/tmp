# VERIFICATION — v0.12.10

## Required source/package gates

1. Exact preimage is the delivered v0.12.9 browser ZIP with SHA-256
   `fea9c71f8d040e773b027492724213704566924a17b2313125066fa832e22acb`.
2. All v0.12.9 payload hashes must match before mutation.
3. Inherited v0.12.9 repair regression must remain green.
4. New v0.12.10 Autostart regression must be green.
5. All JS/MJS must pass syntax validation.
6. Relative local imports and local named bindings must resolve.
7. Local module graph must remain cycle-free.
8. Final package build manifest must hash-match every payload file.

## Desktop Chrome acceptance

Runtime acceptance is intentionally **NOT_RUN** at package build time.

Minimum exact-package acceptance after installation:

1. Open the sidepanel in a ChatGPT window with no prior selected target.
2. Select an Autostart preset and satisfy its explicit confirmation if required.
3. Autostart must not emit `NO_SELECTED_TAB` merely because no prior target was
   cached.
4. The active supported ChatGPT tab must become linked/selected by Autostart.
5. LanguageModel admission/canary must either reuse a valid matching base or
   reach verified available state.
6. The chosen config must be persisted after bind/readiness.
7. Mission start must proceed to its normal session-context/Nano initialization
   path.
8. If the active tab is unsupported, Autostart must fail without leaving a
   previously verified Nano base falsely stale.
9. UI stale state, when genuinely present, must say `AKTIVERA NANO`, not imply a
   Chrome/browser restart.

Desktop Chrome runtime acceptance is a separate owner-evidence gate and must not
be inferred from source/package tests.
