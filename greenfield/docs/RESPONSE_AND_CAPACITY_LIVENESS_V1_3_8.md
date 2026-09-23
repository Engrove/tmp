# EIC Autonom Agent Greenfield v1.3.8 — response ownership and live capacity

## Purpose

v1.3.8 fixes two independent runtime defects found in v1.3.7:

1. profile-global scheduler slots could be reconstructed from durable process state even when the
   managed Chrome window/tab no longer existed, producing ghost capacity such as `4/4` with only
   two live Greenfield sessions;
2. a trusted conceptual ChatGPT turn could expose only a short reasoning/lifecycle fragment
   (for example `Working...`) while the document was hidden, allowing response stability to
   terminalize that fragment before the final EIC-A2A response — including `PAUSE_PROCESS` —
   became observable.

The release preserves durable process continuity, exact-once send behavior, serial per-window
mission queues, rate-limit recovery, and the v1.3.1 timed pause contract.

## Fixed: live scheduler ownership

A durable Greenfield process is no longer sufficient evidence of a live global scheduler lease.

At service-worker hydration, Greenfield now reads the current Chrome window/tab inventory and
reconciles scheduler active turns and waiters only for exact managed `(windowId, tabId)` surfaces
that still exist. Missing surfaces are omitted from the rebuilt scheduler state and emit
`GLOBAL_CAPACITY_STALE_SURFACE_PRUNED` audit evidence.

When a managed tab or window is removed, the process remains durable for bounded recovery, but
its scheduler active/waiter ownership is cancelled immediately. This separates:

- **durable mission/process continuity**, which may survive detachment; from
- **live profile-global capacity ownership**, which requires a live managed surface.

The owner-read failure mode is fail-safe: if Chrome window enumeration itself fails during
hydration, Greenfield does not fabricate that surfaces are dead and does not prune on that failed
read.

## Fixed: response lifecycle chrome is not assistant completion

v1.3.8 restores the response-ownership invariant previously needed in the older agent line:
the conceptual conversation turn owns the semantic assistant response, but renderer lifecycle
chrome does not.

The content bridge removes known assistant lifecycle/presentation fragments such as:

- `Thinking`, `Tänker`, `Working`, `Arbetar`, `Reasoning`, `Resonerar`, `Analyzing`, `Analyserar`;
- localized completed duration disclosures such as `Worked for 2m 54s` or
  `Arbetade i 51 sekunder >`;
- the known `EIC/ChatGPT/Assistant ... said/sade:` presentation prefix.

The response-stability layer independently rejects a lifecycle-only observation even when the
turn owner is structurally trusted. Therefore the exact ten-character `Working...` class cannot
become a terminal response and hide a later full A2A control object.

The existing v1.3.3 guard for structurally incomplete canonical
`eic.a2a.response.v1` objects remains intact. Ordinary stable protocol-absent prose remains
supported; v1.3.8 does not make A2A mandatory for response completion.

## Clarified: observed-effect adoption is not admission

`adoptGlobalTurnSlot()` exists only to represent a prompt effect already proven possible or
materialized by the exact-once/send-fence path. v1.3.8 requires callers to mark that path
explicitly with `observedEffect=true`.

An already-existing effect is not denied merely because configured capacity is full; doing so
would make scheduler state lie about real in-flight work. Instead the result reports
`observedOverCapacity` when necessary, while ordinary new admissions remain capacity-gated.

## Regression coverage

The v1.3.8 regression suite includes:

- hidden trusted lifecycle-only observations that must never terminalize;
- the exact ten-character `Working...` incident followed by a complete
  `PAUSE_PROCESS`/`pauseSeconds=300` response;
- two live managed windows plus two stale durable process records, which must reconcile to
  `activeCount=2`;
- stale tab/window removal wiring;
- explicit observed-effect adoption gating and truthful over-capacity representation;
- preservation of complete A2A pause parsing.

## Verification boundary

Automated source/unit/static/syntax/package-integrity verification can verify the local source
and package behavior described above. It does not prove the installed Desktop Chrome extension,
current ChatGPT renderer behavior, or wall-clock pause behavior. Those remain live acceptance
checks after installation.
