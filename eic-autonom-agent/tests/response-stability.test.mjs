import test from "node:test";
import assert from "node:assert/strict";
import { advanceResponseCandidate } from "../lib/state-machine.mjs";
import { parseTargetResult } from "../lib/prompt-contract.mjs";

const page = (hash, complete = true) => ({
  latestAssistantHash: hash,
  latestAssistantComplete: complete,
  documentEpoch: "epoch-1",
  assistantCount: 1
});

test("foreground response requires repeated identical hash and settle time", () => {
  let result = advanceResponseCandidate(null, page("short"), { now: 1000, settleMs: 2500, minimumReads: 2 });
  assert.equal(result.settled, false);
  result = advanceResponseCandidate(result.candidate, page("short"), { now: 2000, settleMs: 2500, minimumReads: 2 });
  assert.equal(result.settled, false);
  result = advanceResponseCandidate(result.candidate, page("short"), { now: 4000, settleMs: 2500, minimumReads: 2 });
  assert.equal(result.settled, true);
});

test("growing assistant response resets the stability candidate", () => {
  const first = advanceResponseCandidate(null, page("interim"), { now: 1000, settleMs: 2500, minimumReads: 2 });
  const grown = advanceResponseCandidate(first.candidate, page("full"), { now: 4000, settleMs: 2500, minimumReads: 2 });
  assert.equal(grown.settled, false);
  assert.equal(grown.candidate.hash, "full");
  assert.equal(grown.candidate.stableReads, 1);
});


test("exact v0.5.3 incident: interim EIC-startmeny is superseded and full CONTINUE is accepted", () => {
  const turnId = "turn-start-469cc43c-b9b9-4895-a694-7f25f7a6d57f";
  let result = advanceResponseCandidate(null, page("hash-interim"), { now: 1000, settleMs: 2500, minimumReads: 2 });
  assert.equal(result.settled, false);

  result = advanceResponseCandidate(result.candidate, page("hash-full"), { now: 2000, settleMs: 2500, minimumReads: 2 });
  assert.equal(result.settled, false);
  assert.equal(result.candidate.hash, "hash-full");

  result = advanceResponseCandidate(result.candidate, page("hash-full"), { now: 5000, settleMs: 2500, minimumReads: 2 });
  assert.equal(result.settled, true);

  const parsed = parseTargetResult(`Status: WP25.2 closure blockerad av aktuell repoavvikelse

EIC_TURN: ${turnId}
EIC_NEXT: Owner-resolvera exakt publikationscommit och kvitto utan merge, release eller deployment.
EIC_COMPLETION_EVIDENCE: UNIT_DONE · Den observerade responsen är stabil och enheten avslutad.
EIC_NEXT_ACTOR: AGENT
EIC_AUTONOMY: CONTINUE`, turnId);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.status, "CONTINUE");
  assert.match(parsed.next, /Owner-resolvera/);
});


test("exact v0.6.0 screenshot trailer is accepted as turnless CONTINUE", () => {
  const parsed = parseTargetResult(`Låt den ägande trusted sessionen terminalisera.

Status: CONTINUE
Project: EIC backend
EIC_NEXT: Låt den ägande trusted sessionen terminalisera generation 48; återläs därefter lock, work package, publication receipt och Forgejo branch/commit.
EIC_COMPLETION_EVIDENCE: UNIT_DONE · Den observerade responsen är stabil och enheten avslutad.
EIC_NEXT_ACTOR: AGENT
EIC_AUTONOMY: CONTINUE`, null, { allowTurnless: true });
  assert.equal(parsed.valid, true);
  assert.equal(parsed.status, "CONTINUE");
  assert.match(parsed.next, /terminalisera generation 48/i);
  assert.equal(parsed.completionState, "UNIT_DONE");
});
