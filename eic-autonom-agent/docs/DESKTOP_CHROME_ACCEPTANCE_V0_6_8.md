# Desktop Chrome acceptance v0.6.8

## Installation

1. Unpack the v0.6.8 install ZIP.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Load the unpacked directory.
5. Reload the linked ChatGPT tab.
6. Confirm the side panel displays v0.6.8.

## D2 UI

1. Open Mjölnar Operator Proxy.
2. Verify the dropdown contains:
   - Shadow
   - D0 live
   - D1 live
   - D2 live — auth/permissions/merge/release/deploy
3. Verify the default remains D1 unless the operator explicitly selects D2.
4. Select D2 and refresh the panel. Verify `D2_LIVE` persists.

## D2 bounded handoff

Use a controlled test target with an owner route that supports dry-run or a disposable test object.

1. Provide an exact D2 candidate with target, owner route, owner locator, expected effect, rollback and readback.
2. Verify the target conversation receives one `EIC_MJOLNAR_D2/1` prompt.
3. Verify no duplicate prompt is emitted for the same idempotency key.
4. Verify the panel shows `READBACK_PENDING`, not `VERIFIED_EFFECT`.
5. After the target assistant answers, verify the ordinary dynamic WAITING trigger processes the answer.
6. Verify the ledger records `OWNER_RESPONSE_OBSERVED` / `RESPONSE_OBSERVED_UNVERIFIED`.
7. Verify no effect claim is made until the target session obtains exact external owner-route readback.

## Auth boundary

1. A candidate using an already-authorized owner route with no credentials may reach D2.
2. A page requiring login or CAPTCHA must remain blocked.
3. A request involving password, access token, private key or secret must remain `HUMAN_AUTHORITY_REQUIRED`.

## Regression

- D0 refresh/reconnect remains operational.
- D1 auto-discardable actions remain operational.
- v0.6.7 role-first dynamic WAITING behavior remains operational.
- No new Chrome permission prompt appears.
