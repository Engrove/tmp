# Changelog — v0.10.4

## Fixed

- Prevented automatic Session Capture from repeating for an unchanged transcript fingerprint.
- Removed volatile document epoch from capture identity.
- Made Pause and Stop cancel active automatic capture immediately.
- Blocked automatic capture while the run is paused, stopped, operator-bound or terminal.
- Prevented no-op Nano settings proposals from being represented as material changes.
- Made pending Nano review visible through the global attention banner.

## Added

- Five-minute, default-enabled automatic application of safe local-context Nano proposals; mandate, quick-profile and autonomy rewrites remain manual.
- Settings checkbox to disable automatic application.
- Ordered Autostart presets, including Mjölnar D0, D1 and D2.
- One-click Autostart flow for link, Nano activation, profile selection and mission start.
- Clickable prioritized attention banner with exact tab and card routing.
- Durable automatic-capture guard and cancellation receipt.
- Discriminating fixtures for capture deduplication, pause cancellation, TTL, attention priority and Autostart plans.

## Changed

- App/content version: `0.10.4`
- Config/runtime: v13
- Export: v20
- Storage and port namespace: v0.10.4 current-only

## Not changed

- EIC-AA/5
- Session Capture and Session Memory schemas
- IndexedDB store layout
- operator-action and level-10 receipt contracts
- Chrome Prompt API activation/canary contract
