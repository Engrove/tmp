# Root cause analysis v0.12.9

## Primary root cause: nullable identity collapse

Several v0.12.8 control and persistence paths used the JavaScript pattern:

```js
Number.isInteger(Number(value))
```

For a nullable identity this is unsafe because `Number(null) === 0`. "No owner
id" and numeric id `0` therefore collapsed into the same state. The most
important instance was `writeRuntimeBundle()`: omitted `explicitWindowId`
defaulted to `null`, which was accepted as integer `0`, so the intended
continuity-scope fallback could be bypassed and a `windows["0"]` context could
be created.

v0.12.9 replaces nullable owner-id parsing with one strict primitive and removes
the coercive pattern from the JavaScript/MJS source tree.

## Secondary root cause: duplicated contract truth

Worker initialization carried old literals for audit and continuity schemas even
though the contract modules had advanced. A valid current state could therefore
be classified as incompatible during service-worker restart.

v0.12.9 imports the current schema constants from the owning contract module.

## Concurrency root cause: reads that could commit and effects before commit

`loadBundle()` mixed read/normalization with durable writes while mutations used
a single-owner queue. A polling snapshot could therefore race a newer owner
mutation. CDP attachment also created an external browser effect before durable
state was guaranteed.

v0.12.9 separates observer reads from commit paths and adds explicit CDP
reconciliation/compensation.

## Capture root cause: control and data acquisition shared one queue

PAUSE/STOP cancellation was previously attempted from behind the same queue
occupied by a long transcript sweep. v0.12.9 signals cancellation before queue
acquisition and tracks the active capture request id so the content sweep can
receive the correct cancel request.

## Data-integrity root cause: content identity used content only

Fallback turn identity could collapse two legitimate repeated messages. The
content sweep also used a bounded-prefix key. v0.12.9 binds fallback identity to
the transcript occurrence ordinal plus full normalized text.
