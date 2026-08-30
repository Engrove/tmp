# Changelog — v0.12.12

- Fixed false prepared-effect supersession caused solely by transient
  `page.generating`.
- Added explicit owner-identity classification for prepared effects.
- Preserved prepared prompts while the same response owner is busy.
- Added fail-closed handling for temporarily unreadable response-owner identity.
- Removed inherited response deadline from pre-submit foreground/background
  waits.
- Added bounded 1-second fast rechecks for 10 seconds with the 30-second
  watchdog as durable fallback.
- Added exact v0.12.11 incident replay regression.
- Preserved all v0.12.9, v0.12.10 and v0.12.11 repair regressions.
- No new autonomous capability was added.
