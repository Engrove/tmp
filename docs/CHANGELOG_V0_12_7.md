# v0.12.7

## Fatal startup correction

v0.12.6 evaluated the ordinary Nano response schema at module load using
`deriveSchemaHardOutputChars(... maximum: 32000)`. The schema's decoded semantic
field limits are intentionally large enough for Nano to reason freely, while the
helper multiplied every string `maxLength` by the theoretical 12-character
worst-case JSON escape expansion. That produced a serialized schema bound of
134534 characters plus margin = 135558, causing a synchronous module-load throw
before the sidepanel could initialize.

v0.12.7 separates these concepts:

- closed-schema serialized upper bound: diagnostic/contract telemetry;
- runtime streaming hard cap: independent safety/liveness control.

The runtime cap remains 32000 characters. The schema is not shrunk to fit a
pathological escape-expansion bound, so Nano retains its v0.12.6 semantic
workspace.

## Safety correction

A complete JSON object is now checked against the hard runtime cap before the
stream loop exits early. This closes the prior path where `stopOnCompleteJson`
could bypass the hard cap for an oversized but syntactically complete object.

## Regression requirement

Release verification must evaluate the exact Nano advisory schema with the exact
sidepanel startup budget configuration. Syntax-only checks are insufficient for
module-initialization invariants.
