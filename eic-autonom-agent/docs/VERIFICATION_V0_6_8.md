# Verification v0.6.8

## Executed locally

- Node test suite.
- Static validator.
- JavaScript syntax checks for all runtime `.js`/`.mjs` files.
- Service-worker import smoke with mocked Chrome APIs.
- Packaging and ZIP CRC verification.
- Runtime build-info file hash verification.
- Source archive byte-for-byte comparison with the working source tree.
- Manifest permission/host allowlist comparison against v0.6.7.

## D2 positive cases

- Complete level-9 `MERGE_BRANCH` request becomes `DELEGABLE`.
- Complete bounded `AUTH_OWNER_ROUTE` request becomes `DELEGABLE`.
- D2 dispatch is permitted only in `D2_LIVE`.
- D0 and D1 remain permitted in higher rollout modes.
- D2 handoff prompt includes exact target, owner route, rollback, readback and no-secret constraints.

## D2 blocking cases

- Missing owner evidence.
- Missing rollback.
- Missing readback.
- Unknown reversibility.
- Unknown human-authority class.
- Material ambiguity.
- Login password.
- CAPTCHA.
- Access-token/private-key/secret handling.

## Evidence boundary

The tests verify local policy, prompt construction, dispatch wiring and package integrity. They do not prove a real merge, release, deployment, permission change or authorization effect on an external owner surface. A target ChatGPT response is not owner proof. Such effects require the external owner route and its readback.
