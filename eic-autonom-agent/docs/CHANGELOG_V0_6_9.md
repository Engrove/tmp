# CHANGELOG — v0.6.9

## Fixed

- Prevented `NO_PROGRESS_BUDGET_EXHAUSTED` from becoming a human pause in Max
  Autonomous Mode below the level-10 boundary.
- Added deterministic failing-subsystem classification and exclusion.
- Added bounded `RECOVERING` fallback when all observed subsystems are excluded.
- Reset sticky no-progress counters on operator Resume.
- Preserved safe grounding recovery instead of overwriting it.
- Accepted the extension's own v8 export format during import.
- Added balanced JSON-object extraction and one format-only Nano repair.
- Propagated the true Nano recovery reason into deterministic fallback decisions.

## Added

- `tests/v069-no-progress-recovery.test.mjs`
- `docs/ROOT_CAUSE_AND_FIX_V0_6_9.md`
- `docs/VERIFICATION_V0_6_9.md`
- `docs/CHANGELOG_V0_6_9.md`
- `docs/DESKTOP_CHROME_ACCEPTANCE_V0_6_9.md`

## Unchanged boundaries

- No new Chrome permissions.
- No new host permissions.
- No credentials, login, CAPTCHA or secret handling.
- Level-10 and direct operator Stop/Pause boundaries remain intact.
