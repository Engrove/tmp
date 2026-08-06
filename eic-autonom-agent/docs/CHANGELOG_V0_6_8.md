# Changelog v0.6.8

## D2 privileged owner-route handoff

- Added rollout mode `D2_LIVE` to the Mjölnar dropdown and rollout gate.
- Kept `D1_LIVE` as the default so existing installations preserve their previous behavior.
- Added the registered D2 allowlist:
  - `AUTH_OWNER_ROUTE`
  - `CHANGE_PERMISSION`
  - `MERGE_BRANCH`
  - `CREATE_RELEASE`
  - `DEPLOY_PRODUCTION`
- Added complete D2 control requirements: exact target, external owner route/evidence locator, mandate, explicit reversibility, rollback, readback, no material ambiguity and no human-authority requirement.
- Added a bounded `EIC_MJOLNAR_D2/1` target-session handoff prompt.
- Added prompt-digest acknowledgement and pending owner-response ledger states.
- Prevented target assistant text or prompt acknowledgement from being promoted to effect verification.
- Preserved level-10 gates for login, CAPTCHA, credentials, secrets, user presence, irreversible deletion and unknown blast radius.
- Preserved the v0.6.7 manifest permission and host allowlists.
- Added v0.6.8 D2 regression tests.
