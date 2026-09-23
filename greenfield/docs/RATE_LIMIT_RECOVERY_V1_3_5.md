# Rate-limit recovery — Greenfield v1.3.5

## Goal

Prevent a profile with many parallel Greenfield sessions from recreating a request burst after
ChatGPT reports a temporary request/rate warning.

This is transport recovery. It is not `PAUSE_PROCESS`, not a mission pause, and not a claim about
OpenAI's undocumented quota model.

## Profile-global circuit breaker

A detected blocking throttle warning creates a new rate-limit epoch in the shared prompt gate.
All currently active Greenfield process ids are attached to that epoch. The warning:

1. clears any active global send lease;
2. changes the shared gate to `COOLDOWN`;
3. blocks every prompt effect until the cooldown expires;
4. resets per-epoch prepared/recovered process state;
5. preserves the exact-once outbound prompt fence.

Distinct warning incidents inside 30 minutes escalate the cooldown:

`180 s -> 360 s -> 720 s -> 900 s`

Repeated observations of the same incident do not escalate it again.

## Serial release

Cooldown expiry does not release all clients. It changes the gate to `SERIAL_RECOVERY`.

Only the process holding the global send lease can run recovery preflight or post. After a
successful post, the next process remains blocked until the next serial spacing boundary.

The recovery success ramp is:

`180 s -> 150 s -> 120 s -> 90 s -> 90 s -> 90 s`

After six successful serialized posts, the gate returns to `NORMAL`. A process that was affected
by the epoch but has not yet performed its first-release preflight still cannot bypass that
preflight merely because the global gate has returned to `NORMAL`.

A new warning at any point creates a new epoch and returns the whole profile to `COOLDOWN`.

## First-release browser recovery

Each affected process must perform one first-release preflight per epoch before its first post.

The content bridge first looks for a blocking throttle modal using structural and semantic
evidence. The detector recognizes dialog/modal structure and multilingual request/throttle
signals; it does not use the acknowledgement caption as an identity selector.

A modal acknowledgement is considered structurally safe only when:

- the warning is a recognized blocking throttle dialog;
- exactly one visible enabled button/role-button exists;
- the dialog has no visible input, textarea or select control;
- the dialog has no visible link;
- the sole action has no structural identity associated with upgrade, subscription, login,
  payment, purchase, delete/remove or retry semantics;
- a form-submit action is not used.

If the single action is clicked, dismissal is accepted only after readback proves the warning is
gone and the composer is available.

If any condition is missing, ambiguous, or the dismissal cannot be verified, background recovery
uses a hard tab reload with `bypassCache:true` — the Chrome extension equivalent of Ctrl-F5 — and
waits for the current extension content bridge, a ready composer, and absence of the blocking
warning before marking that process prepared.

Thus literal strings such as localized versions of “acknowledge/understand” are never required.

## Race closure

The global gate is claimed before recovery and claimed again immediately before the page effect.
If another warning creates a new epoch between those points, the prepared dispatch is marked
no-effect and no prompt is sent.

When the content bridge observes a warning directly after a send attempt and can prove that the
user-turn count did not change, generation did not start, and the composed prompt remains in the
composer, it returns a no-effect rate-limit receipt. The background records the dispatch as safe
to retry after the global circuit breaker permits it.

If effect status cannot be proven, the existing exact-once fence remains authoritative; the
system does not blindly resend.

## Normal spacing

The ordinary profile-global prompt-post spacing remains a separate operator setting. v1.3.5
raises its configurable range from `0..90` to `0..300` seconds. Rate-limit cooldown/recovery may
impose a longer effective wait.

## Verification boundary

The deterministic source suite exercises:

- global cooldown and same-incident deduplication;
- two-client serialization;
- per-client first-release preflight requirement;
- warning re-escalation/new epoch behavior;
- six-success return to normal;
- source wiring for structural acknowledgement handling, hard-reload fallback and UI state.

These tests verify the implementation contracts locally. They do not reproduce a real ChatGPT
service-side throttle event. Live Desktop Chrome/ChatGPT rate-limit acceptance remains `NOT_RUN`
until the extension is installed and exercised against an actual warning.
