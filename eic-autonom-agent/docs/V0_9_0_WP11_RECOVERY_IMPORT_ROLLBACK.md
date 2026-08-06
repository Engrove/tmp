# v0.9.0 WP11 — fail-closed recovery, import and rollback

## Scope

WP11 adds recovery and state portability without restoring stale browser authority.

- `eic.autonom.browser-recovery.v1` records why browser work stopped, the prior target
  locator and whether explicit rebind is required.
- Navigation, reload, target replacement/move/close, service-worker identity loss and
  Chrome debugger detach pause the browser loop, clear approval and require recovery.
- Recovery verifies the current target identity, exact-origin permission, attached CDP
  session and active identity-bound evidence observation.
- Recovery never replays a pending action or controller response.
- Export advances to `eic.autonom.export.v12`.
- Import accepts v3–v12, but imported tabs, permissions, CDP sessions, approvals and
  pending actions are never restored as live.
- Each import creates one digest-bound, single-use rollback snapshot. The snapshot is
  limited to 1.5 MB and excludes nested rollback state.
- Rollback restores config, continuity, Mission store and window data, then applies the
  same fail-closed live-rebind boundary.

## Recovery states

`IDLE`, `REQUIRED`, `REBIND_REQUIRED`, `RECOVERING`, `READY`, `PAUSED`, `FAILED`.

`REQUIRED` permits resume only against the exact recorded target identity.
`REBIND_REQUIRED` permits a newly rebound document only on the same recorded origin.
Both paths require fresh permission, CDP and evidence readback.

## Durable and UI boundaries

- Rollback bodies stay in `chrome.storage.local` with the window context.
- UI snapshots expose rollback metadata only, never the rollback snapshot body.
- The panel provides explicit **Verifiera och återuppta utan replay** and
  **Ångra senaste import** controls.
- A consumed rollback cannot run again.

## Non-goals

- No Focus Mode, responsive polish or WP12 visual work.
- No live Desktop Chrome acceptance.
- No repository, release or deployment effect.
- No restoration of browser credentials, cookies, authorization, CAPTCHA state,
  origin grants, debugger attachment or pending browser effects.

## Verification

- Focused WP11 contract: 18/18 PASS.
- Full regression: 560/560 PASS.
- Validator, background smoke, full syntax, packaged-source replay, build-info and ZIP
  integrity are required before the WP11 gate is frozen.
