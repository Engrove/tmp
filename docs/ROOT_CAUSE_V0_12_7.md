# v0.12.7 root cause

## Incident

Chrome extension sidepanel failed during initialization with:

`Nano response schema bound 135558 exceeds configured safety maximum 32000.`

The panel therefore displayed no loaded Agent version and the Agent was idle.

## Cause

`eic.nano.advisory.v4` intentionally permits:

- analysis maxLength 4800
- proposal maxLength 3200
- uncertainty maxLength 1600
- evidenceNeed maxLength 1600

The schema-bound helper conservatively models each decoded Unicode scalar as up
to twelve serialized JSON characters. The theoretical serialized upper bound is
134534 characters. Adding the configured 1024 margin yields 135558.

The sidepanel then compared that theoretical contract bound with a 32000
runtime streaming safety maximum *at module load* and threw synchronously.

This was a category error: semantic schema capacity and transport safety cap are
different invariants.

## Why v0.12.6 tests missed it

The release suite tested syntax, Nano prompt budgets, schema shape, state-space,
replays and package integrity, but did not execute the exact schema + exact
sidepanel startup budget configuration. `node --check` cannot detect a
synchronous value-dependent module-initialization exception.

## Corrected invariant

- Schema must be closed and bounded.
- Theoretical serialized schema bound is diagnostic.
- Runtime stream cap is independently bounded.
- Runtime initialization must not require the safety cap to cover pathological
  worst-case escaping.
- Oversized complete JSON still fails the runtime cap.
