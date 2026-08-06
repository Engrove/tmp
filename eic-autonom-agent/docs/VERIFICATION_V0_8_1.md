# Verification v0.8.1

## Source gates

Required checks:

- packageversion equals manifestversion;
- `APP_VERSION` equals packageversion;
- `CONTENT_SCRIPT_VERSION` equals packageversion;
- `content.js` bridge `VERSION` equals packageversion;
- sidepanel shows the current version;
- export filename derives from `APP_VERSION`;
- active dropdown labels do not expose `v0.7.8`.

## Regression scope

The complete existing Node test suite must remain green, including:

- continuation and effect journal;
- prepared-session readiness;
- tab detach/reattach;
- APP_AUDIT_LONG;
- ARCHAEOLOGY_LONG;
- Workspace-aware Nano;
- strict USER_PAUSE;
- version and bridge identity.

## Executed source result

- `node --check background.js`: PASS
- `node --check content.js`: PASS
- `node --check sidepanel.js`: PASS
- `npm test`: 371/371 PASS
- `npm run validate`: PASS

## Claim boundary

A green source suite and package CRC establish a source candidate only. Desktop Chrome acceptance requires loading v0.8.1, reloading the target ChatGPT tab, linking it, and confirming an `EIC_PING` response with version `0.8.1`.
