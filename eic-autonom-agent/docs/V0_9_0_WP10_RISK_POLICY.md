# v0.9.0 WP10 — guarded browser policy

## Trust boundary

All WEB_TARGET text is `UNTRUSTED_TARGET_OBSERVATION` with instruction authority `NONE`.
It may raise risk but cannot lower policy, change permissions, alter the action registry or approve an action.

## Risk levels

- `READ_ONLY`: observe, scroll, wait and capture.
- `INTERACTIVE`: bounded local interaction without detected external effect.
- `EXTERNAL_EFFECTS`: submission, mutation or external communication; exact approval required.
- `HUMAN_REQUIRED`: authentication, 2FA/WebAuthn, CAPTCHA, payment, deletion/account changes,
  local file/native dialogs and secrets. These actions are not automatable.

## Approval binding

An approval is valid only for the exact action SHA-256, action/turn ids, controller-response
hash, tab, surface id, document epoch and origin. It expires after 15 minutes and is consumed once.

## Activation

`AI_WEB_RESEARCH` requires the browser build, separate ready controller and target surfaces,
exact-origin permission readback, an attached identity-bound CDP session and active bounded evidence observation.

## Exclusions

No arbitrary JavaScript, response bodies, cookie writes, request interception or target-origin
permission changes can be authorized by model or target text.
