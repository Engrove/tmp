# v0.12.8 root cause

## Violated invariant

Every runtime helper referenced by `background.js` must be lexically bound through a local
declaration or an explicit module import before any event path can reach it.

## Evidence

The supplied v0.12.7 full-audit NDJSON contains three concurrent Agent windows. Two windows
record `NANO_DECISION` transport failure and deterministic-dispatch failure with
`shouldSuppressRepeatedLocalStateRead is not defined`; the third does not.

The exact v0.12.7 package contains five calls to that identifier in `background.js`, zero
local definitions, and an export in `lib/execution-routing.mjs`, but no corresponding named
import in `background.js`.

## Causal model

Valid Nano decision
→ `applyNanoDecisionCommandUnlocked`
→ execution-plan construction
→ call unbound helper
→ synchronous `ReferenceError`
→ Nano receipt transport failure
→ bounded deterministic recovery
→ same unbound call
→ repeated deterministic dispatch failure
→ reconciliation required / apparent stop.

The model predicts that adding the missing import removes this failure without changing Nano
decision semantics. The focused regression exercises the exported helper directly and checks
the exact source binding.

## Independence from prior incidents

This defect is not evidence that v0.12.7's runtime-output-cap fix failed. That startup fix
worked: the affected Agents reached Nano reasoning and produced valid Nano decisions before
the missing binding crashed the continuation path.
