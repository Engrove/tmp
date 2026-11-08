# EIC Testing — Decisive, Not Ceremonial

## Default cycle for a behaviour change
1. Write or select the focused test that expresses the required behaviour.
2. Run it on the unchanged code: RED, with the assertion that fails.
3. Make the smallest change.
4. Run it again: GREEN. Then run the directly affected neighbours.
Each run is a delta (command, source revision, environment, exit code).

## Reading results
- Collection, setup, missing input and environment errors are not assertion
  failures. Fix the setup first; it is progress when it lets assertions run.
- A RED test you are about to fix is progress, not a blocker.
- Never weaken an assertion, replace a pin or delete a negative case to get
  green. Preserve security and tamper checks.
- Reconcile a stale fixture with the accepted current behaviour; record why.

## Scope and reuse
- Rerun only what the change can affect, plus the stage's acceptance tests.
- Reuse unchanged evidence; do not rerun accepted tests without a concrete
  invalidation.
- Pass counts and coverage percentages do not prove a stage; the stage's
  acceptance check does.
- Mock, unit, installed-process and client acceptance are different
  boundaries. Name the boundary you tested.

## Safety rules need twins
For a block/allow rule, test both the case that must be refused and the case
that must proceed. An implementation that always refuses fails the second.
