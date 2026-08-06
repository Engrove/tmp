# EIC Autonom Agent v0.10.4 — architecture

## Purpose

v0.10.4 is a forward-only runtime-control release built on the verified v0.10.3 source. It addresses field evidence that automatic Session Capture could repeat, did not stop promptly when the addon was paused, and could leave a Nano core-surface proposal hidden in Settings.

It also introduces a single-click Autostart surface and one clickable, prioritized attention banner.

## Current contracts

- App/content: `0.10.4`
- Config/runtime: `eic.autonom.config.v13` / `eic.autonom.runtime.v13`
- Export: `eic.autonom.export.v20`
- Turn protocol: `EIC-AA/5`
- Session Capture: `eic.autonom.session-capture.v1`
- Session Memory: `eic.autonom.session-memory.v1`
- Core-surface proposal: `eic.autonom.core-surface-proposal.v1`

No compatibility adapter is provided. Older config/runtime/export state is rejected under the forward-only policy.

## Automatic Session Capture owner model

The background service worker owns scheduling. A capture fingerprint is derived only from stable transcript identity:

- conversation key;
- latest assistant-message hash;
- assistant count.

The document epoch is deliberately excluded because scrolling and virtualized DOM activity may change it without changing the transcript.

A durable guard records one of:

- `STARTED`
- `COMPLETED`
- `FAILED`
- `CANCELLED`

The same fingerprint is not automatically attempted again in the same state history. A new assistant identity creates a new eligible fingerprint. Manual capture remains available.

Automatic capture is blocked while the run is paused, stopped, awaiting an operator, terminal or otherwise not eligible. The Pause and Stop commands cancel any pending debounce timer and signal the content script to abort the active sweep. The sweep restores the original scroll position in `finally`.

## Core-surface review and five-minute TTL

After the first successful capture in an app session, Nano may produce one proposal for:

- safe allowlisted settings;
- Nano mandate;
- target mandate;
- continuity context.

No-op values are removed before the proposal is stored. If no material change remains, the review closes as `NO_CHANGE`.

When `autoApplyCoreSurfaceReviewEnabled` is enabled, a safe local-context proposal receives a five-minute deadline. The operator can accept or decline before the deadline. If no action is taken, the background owner applies the normalized proposal when the deadline expires. Mandate rewrites, quick-profile changes and autonomy changes remain manual because they materially alter control semantics. Disabling the setting cancels automatic application for future processing.

Transcript-derived context remains untrusted and cannot grant permissions, owner truth, credentials, Mjölnar rollout, release or deployment authority. Applied continuity text is labelled `UNTRUSTED_TRANSCRIPT_DERIVED` with authority `NONE`.

## Autostart

The action dock provides one ordered preset selector and one Autostart button. Presets are:

1. Context only
2. Verified analysis
3. Exploration and design
4. Bounded delivery
5. Mjölnar D0
6. Mjölnar D1
7. Mjölnar D2

Each preset materializes a complete plan: quick profile, mission mode, Session Capture, Nano activation and Mjölnar state. D1 and D2 require explicit confirmation. Nano activation still begins synchronously inside the user click before any asynchronous hop.

## Attention routing

The top attention banner is derived from current owner state. Priority is:

1. material operator decision;
2. mechanical operator action;
3. browser approval;
4. browser recovery;
5. pending Nano core-surface proposal;
6. failed Session Capture;
7. stale Nano host.

Clicking the banner opens the correct application view and scrolls to the exact owning card. The banner does not create authority or complete the action.

## Claim boundary

Source tests and package validation can verify code paths and fixtures. They do not prove installed Desktop Chrome behavior. Runtime acceptance requires a separately installed unpacked browser package and direct observation.
