# Desktop Chrome acceptance — EIC Autonom Agent v0.10.4

## Preparation

1. Load the v0.10.4 browser package unpacked.
2. Verify the side-panel header reports v0.10.4.
3. Clear old extension errors.
4. Link one supported ChatGPT conversation.
5. Keep Developer Tools available for the extension service worker and target tab.

## A. Capture anti-loop

1. Enable Automatic Session Capture.
2. Allow one completed assistant response.
3. Observe one automatic capture.
4. Wait through at least three watchdog ticks without changing the transcript.
5. PASS: no second automatic sweep starts for the same fingerprint.
6. Produce one new assistant response.
7. PASS: exactly one new capture becomes eligible.

Record:

- old and new fingerprints;
- guard state;
- capture IDs;
- assistant count and latest-message hash.

## B. Pause and Stop

1. Start a long transcript sweep.
2. Click Pause addon while the page is scrolling.
3. PASS: scrolling stops promptly, original scroll position is restored and guard becomes `CANCELLED`.
4. Resume without changing the transcript.
5. PASS: the cancelled fingerprint is not automatically retried.
6. Repeat with Stop addon.
7. PASS: no target detach is required to stop capture activity.

## C. Nano review visibility and TTL

1. Complete the first capture of a fresh app session.
2. Allow Nano review to produce a material proposal.
3. PASS: the top banner shows an attention item even when Settings is not open.
4. Click the banner.
5. PASS: Settings opens and scrolls to the exact proposal card.
6. Use a proposal containing only auto-eligible local-context settings or continuity, enable auto-apply and take no action for five minutes.
7. PASS: the proposal is applied once, the banner clears and an audit receipt is visible.
8. Produce a mandate, quick-profile or autonomy rewrite.
9. PASS: it remains manual and does not auto-apply.
8. Repeat with auto-apply disabled.
9. PASS: no automatic application occurs.
10. Verify Accept and Decline still act immediately.

A proposal containing only current values must close as `NO_CHANGE` and must not make Nano stale.

## D. Autostart

For each preset, start from a fresh, inactive window:

1. Context only
2. Verified analysis
3. Exploration and design
4. Bounded delivery
5. Mjölnar D0
6. Mjölnar D1
7. Mjölnar D2

PASS criteria:

- the active tab is linked;
- the selected profile and Mjölnar rollout match the preset;
- Context only does not start Nano or a mission;
- Nano-required presets create and canary-verify the model from the explicit click;
- D1/D2 ask for confirmation;
- no second active mission is created over an existing nonterminal run.

## E. Attention priority

Create each owner state separately and verify banner routing:

- operator decision;
- operator action;
- browser approval;
- browser recovery;
- Nano proposal;
- capture failure;
- stale Nano.

PASS: the highest-priority item is shown, clicking it selects the correct view and scrolls to the owning card.

## F. Regression

Verify:

- LanguageModel availability/create/canary;
- EIC-AA/5 five-line response;
- operator action and USER_PAUSE separation;
- full and delta capture;
- Session Memory readback;
- export v20 contains bounded summaries without secrets.

## Claim boundary

Installation, runtime behavior and acceptance evidence belong to Desktop Chrome. Source/package PASS alone is insufficient.
