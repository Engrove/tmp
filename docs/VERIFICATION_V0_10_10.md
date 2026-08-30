# Verification v0.10.10

## Source identity

Baseline: v0.10.9 source ZIP SHA-256  
`8c839b568c7db0a31fbc3b1aec887703969ef21c7933686aa6bc50d2ef85b6e2`

## Executed gates

- Focused replay fixtures: **7/7 PASS**
- Full Node regression suite: **835/835 PASS**
- Static validator: **PASS**
- JavaScript/ES module syntax: **162/162 PASS**
- SOURCE package: **PASS**
- STANDARD package: **PASS**
- BROWSER package: **PASS**

The generated `build-info.json` in each profile is the owner record for its file count, per-file SHA-256 values and package digest.

## Covered acceptance logic

- source-bound `eic.autonom.core-review-deferral.v2`;
- blocked replay before session-context `READY`;
- blocked replay while mission Nano or Nano host owns the model;
- exactly-one automatic replay after `READY`;
- no duplicate review for an already reviewed application session;
- background replay after mission Nano completion and Nano host release;
- sidepanel priority of the initial automatic review before ordinary mission Nano;
- honest pending UI when the panel/model execution surface is unavailable.

## Safety preservation

- Transcript-derived context remains untrusted.
- Authority-sensitive settings remain outside proposal patching.
- Nano and target/EIC mandate rewrites remain operator-gated.
- TTL auto-apply remains limited to eligible low-risk local settings and continuity.
- No external owner, release, deployment or installation claim is inferred from source tests.

## Runtime boundary

Automated source/package verification does not prove installed Desktop Chrome behavior. Live exactly-once replay remains governed by `DESKTOP_CHROME_ACCEPTANCE_V0_10_10.md`.
