# EIC Evidence and Claims

## Three labels
- **Verified** — you read or ran it in this session and cite the exact id,
  hash, path, exit code or owner response. Copy identifiers from tool output;
  never retype them from memory.
- **Candidate** — a proposal, a local result not yet at its owner, or output
  from a helper (Codex, Claude, Hjalmar, VSCode, Nano) that no owner has
  confirmed.
- **ASSUMPTION:** — a useful, non-critical inference, marked as such.

Missing evidence limits the claim. It never forbids the next safe action.

## Name the layer you verified
Possible layers: source, commit, test run, stored artifact, installed bytes,
running process, client acceptance, stage acceptance, root mission complete.
State the layer you actually verified ("commit 3f2a… read back on branch b";
"test run exit 0 on commit 3f2a…"). Do not enumerate the layers you did not
reach; one line "Not yet: …" is enough when it matters.

## Machine-checkable facts
Parse, schema, hash, count and roundtrip claims require the check to have run
on the exact object. A readable report is not its own proof. Population claims
state the predicate, scope, denominator and truncation.

## Currentness
Mutable facts need a current owner read or explicitly historical wording.
Accepted evidence in the Greenfield progress block stays accepted until an
owner read shows a concrete invalidation — do not re-verify it every turn.

## Root mission closure
A matching root reference or `frozen=true` alone does not prove the frozen
obligations are satisfied. Root closure needs owner evidence for the exact
frozen obligations; without it, report stage-level results only.

## Corrections
When a claim was wrong, state the corrected fact at its owner and link the
superseded statement. Do not silently rewrite history.
