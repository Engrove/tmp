# v0.12.6 root-cause analysis

## Evidence identity

- Exact base package: `eic-autonom-agent-v0.12.5-browser.zip`
  - SHA-256 `86a933e480146089db941402890b3370b180f5324dc579394a8c3ee85bcd5803`
- Exact incident export: `eic-autonom-agent-v0.12.5-export-1786706506766.json`
  - SHA-256 `993a7a131c238263f214194bdbfaceb868de4d9c9300e6fc33dce0bc2d87e53d`
- Raw session context:
  - SHA-256 `fbf08668377f39350b6dbc5ee9089a7811b2c142667c69d6f24f209141c4db7e`
- Captured ChatGPT transcript ZIP:
  - SHA-256 `af7ff3bde8b9b19296d916f462b221fc38da427c9220adaae9f45f5054d1defb`
- Full audit text:
  - SHA-256 `6e86f48ef409d40cb01015d1981f0c0e6ad58cfd272c5ae58814df4a8a4cbb8b`

## Executive verdict

The v0.12.5 `PROGRAM_BLOCKED` state was a false terminalization caused by a
category error: model-expression quality was allowed to own controller
liveness. Nano selected `READ_LOCAL_SESSION_STATE`, that action was present in
the runtime action catalog, and the request was marked both admissible and
compatible. The mission was nevertheless fenced because Nano did not satisfy a
meta requirement called `NANO_DISCRIMINATION_REQUIRED`.

This was compounded by an oversized model contract. v0.12.5 required 25
top-level decision fields, including controller-owned actor, completion,
progress, candidate/discrimination and track metadata. `trackControl` itself
required seven more fields. The exact incident input was 14,856 characters and
the model outputs repeatedly restated controller state, attempted to synthesize
control values, and degraded semantically under repair.

A third defect was an actor-capability mismatch. The connected AI assigned
`AGENT` the task of creating/attesting a separate fresh ChatGPT evaluator
session. The extension can inspect local Agent/controller state but does not
create or select an independent evaluator ChatGPT session. After one no-delta
local read, repeating that action cannot produce the missing external state.

## Violated invariants

1. **Transition authority** — model prose/format quality must not commit
   `PROGRAM_BLOCKED`; runtime state and owner evidence own transition admission.
2. **Nano boundary** — Nano advises among runtime-defined transitions; it does
   not own actor, progress, completion, safety or terminality.
3. **Capability ownership** — AGENT-local state reads cannot manufacture a
   fresh independent ChatGPT target.
4. **No-progress semantics** — a repeated no-delta local read is not material
   progress and must not be re-admitted for the same side-band causal unit.
5. **Plane separation** — Nano reasoning quality is OBSERVATION/advisory
   telemetry, not MISSION terminal state.

## v0.12.6 architecture

### Nano advisory

Ordinary Nano uses `eic.nano.advisory.v4` with only two required fields:

- `selectedActionId`
- `analysis`

Optional fields are `proposal`, `confidence`, `uncertainty` and `evidenceNeed`.
The model can therefore explain contradictions, capability gaps and uncertainty
in one free semantic field without duplicating controller state.

### Runtime authority

The runtime action catalog is the single transition authority. Model action
selection is advisory. An inadmissible/missing model action is rebound by Core
to a runtime-admissible route and recorded as a quality warning; it does not
terminalize the mission. A real runtime catalog/binding contradiction remains a
fail-closed internal invariant.

`STOP` is no longer a standing ordinary-Nano action. It is exposed only when
the target/runtime lifecycle is terminal or no continuing runtime transition
exists.

### Safety boundary

For `LOCAL_EXECUTE`, `WAIT_OWNER_EVENT`, `WAIT_EXTERNAL_EVENT` and terminal
no-effect routes, free Nano analysis is not itself an effect and cannot create a
level-10 human boundary from destructive-sounding explanatory words. Real
target/operator human boundaries remain dominant. Material target dispatch is
still classified from the actual semantic effect text.

### Fresh-target capability handoff

When `READ_LOCAL_SESSION_STATE` has already returned
`LOCAL_STATE_UNCHANGED` for the side-band generation, the same local read is
suppressed. If target prose still assigns fresh-target work to `AGENT`, runtime
selects `WAIT_OWNER_EVENT` and wakes the connected EIC AI session with the
explicit capability boundary.

The source contains no `chrome.tabs.create`/`tabs.create` path for this feature,
and the existing prepared-session start path explicitly requires the operator
to prepare, link and select the ChatGPT target tab. Consequently:

- `EIC_AI_SESSION` may create/select a fresh evaluator target only when an
  actual browser/session owner route is exposed to that AI session;
- otherwise the target response must use `OPERATOR_ACTION_REQUIRED` with
  `EIC_NEXT_ACTOR: OPERATOR_ACTION` and an exact mechanical instruction to
  open/select/link the target;
- `AGENT` may then observe the newly linked local state, but must never be
  assigned target creation merely because it can read local state.

This removes the capability fiction that previously turned repeated local
observation into apparent work.


### Nano prompt budget and policy duplication

The exact incident fed Nano 14,856 characters. Inspection also showed that a
pre-final v0.12.6 candidate could still exceed small configured prompt budgets:
structured data was reduced, but the complete prompt remained above the
requested ceiling. Raw character slicing would have been worse because it can
produce invalid JSON and remove the causal fields needed for a decision.

The final v0.12.6 request builder therefore:

- keeps the stable actor/safety/evidence doctrine in the Nano core mandate
  instead of repeating it in every request;
- reduces the per-request rule block to five bounded rules;
- applies successive structured compaction tiers to observations, mission
  context and runtime details;
- preserves a complete JSON object at every tier;
- never raw-slices the final prompt;
- falls back to a minimal complete runtime/action envelope when the configured
  ceiling is small.

Regression coverage exercises configured maxima of 2,400, 3,000, 4,000 and
8,000 characters and requires a complete parseable prompt at or below each
ceiling.

### Upgrade recovery

A persisted v0.12.5 `NANO_DISCRIMINATION_FAILED` policy fence is obsolete
because it did not represent a safety owner. v0.12.6 retires that exact legacy
fence deterministically, clears stale Nano ownership, and lets the still
unprocessed assistant response re-enter the new advisory pipeline.

## PROGRAM_BLOCKED policy

v0.12.6 retains `PROGRAM_BLOCKED` only for owner/invariant conditions such as:

- payload-integrity contradictions;
- storage persistence failure;
- authentication/CAPTCHA or target identity loss;
- response-ownership contradiction;
- exhausted bounded protocol repair;
- true runtime action-catalog binding contradiction;
- repeated terminal Nano-host failure generation with no new causal wake;
- wait-without-causal-wake invariant failure;
- other explicit hard owner/safety boundaries.

Nano independent-judgment quality is not one of those conditions.

## Verification boundary

Source/package, exact incident replay and modeled state-space checks can verify
the implementation against the supplied artifacts. They do not constitute
Desktop Chrome live acceptance of the packaged extension.
