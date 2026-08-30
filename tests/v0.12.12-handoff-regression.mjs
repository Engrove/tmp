import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  PREPARED_EFFECT_OBSERVATION_DISPOSITION,
  classifyPreparedEffectObservation
} from "../lib/session-init-causal-model.mjs";
import { reconcileEffectRecord } from "../lib/effect-journal.mjs";

let assertions = 0;
function check(condition, message) {
  assertions += 1;
  assert.ok(condition, message);
}

const sourceHash = "4922c57e64c4f3d6a77dfee57b2f117cdc242df392ea2316a4f4a087ce049ef4";
const epoch = "05e7b911-2494-4fee-a9cb-4b0052702550";
const effect = {
  status: "PREPARED",
  turnId: "turn-repair",
  sourceObservationHash: sourceHash,
  sourceObservationEpoch: epoch,
  preparedAt: new Date().toISOString()
};

const exactIncident = classifyPreparedEffectObservation(effect, {
  latestAssistantHash: sourceHash,
  documentEpoch: epoch,
  generating: true,
  backgroundSignals: { active: false }
});
check(
  exactIncident.disposition === PREPARED_EFFECT_OBSERVATION_DISPOSITION.SAME_OWNER_BUSY &&
  exactIncident.superseded === false,
  "Exact v0.12.11 incident must remain same-owner busy, never superseded."
);

const backgroundBusy = classifyPreparedEffectObservation(effect, {
  latestAssistantHash: sourceHash,
  documentEpoch: epoch,
  generating: false,
  backgroundSignals: { active: true }
});
check(
  backgroundBusy.disposition === PREPARED_EFFECT_OBSERVATION_DISPOSITION.SAME_OWNER_BUSY,
  "Background activity with the same owner must preserve the prepared effect."
);

const stable = classifyPreparedEffectObservation(effect, {
  latestAssistantHash: sourceHash,
  documentEpoch: epoch,
  generating: false,
  backgroundSignals: { active: false }
});
check(
  stable.disposition === PREPARED_EFFECT_OBSERVATION_DISPOSITION.STABLE_SAME_OWNER,
  "Identical readable owner identity without busy state must be stable."
);

const changedHash = classifyPreparedEffectObservation(effect, {
  latestAssistantHash: "different-hash",
  documentEpoch: epoch,
  generating: true
});
check(
  changedHash.disposition === PREPARED_EFFECT_OBSERVATION_DISPOSITION.SUPERSEDED &&
  changedHash.hashChanged === true,
  "A different readable assistant hash must supersede the prepared effect."
);

const changedEpoch = classifyPreparedEffectObservation(effect, {
  latestAssistantHash: sourceHash,
  documentEpoch: "different-epoch",
  generating: false
});
check(
  changedEpoch.disposition === PREPARED_EFFECT_OBSERVATION_DISPOSITION.SUPERSEDED &&
  changedEpoch.epochChanged === true,
  "A different readable document epoch must supersede the prepared effect."
);

const unreadableHash = classifyPreparedEffectObservation(effect, {
  latestAssistantHash: "",
  documentEpoch: epoch,
  generating: false
});
check(
  unreadableHash.disposition === PREPARED_EFFECT_OBSERVATION_DISPOSITION.OWNER_IDENTITY_UNREADABLE &&
  unreadableHash.superseded === false,
  "Missing current assistant hash must wait for owner readback instead of guessing supersession."
);

const unreadableEpoch = classifyPreparedEffectObservation(effect, {
  latestAssistantHash: sourceHash,
  documentEpoch: "",
  generating: false
});
check(
  unreadableEpoch.disposition === PREPARED_EFFECT_OBSERVATION_DISPOSITION.OWNER_IDENTITY_UNREADABLE,
  "Missing current document epoch must wait for owner readback."
);

const journalBusy = reconcileEffectRecord(effect, {
  generating: true,
  backgroundSignals: { active: false },
  userTurnIds: []
});
check(
  journalBusy.reason === "TARGET_BUSY" && journalBusy.shouldExecute === false,
  "Prepared effect journal must not submit while the target is busy."
);

const journalStable = reconcileEffectRecord(effect, {
  generating: false,
  backgroundSignals: { active: false },
  userTurnIds: []
});
check(
  journalStable.reason === "READY_TO_SUBMIT" && journalStable.shouldExecute === true,
  "Prepared effect journal must become executable when the target stabilizes."
);

const background = await fs.readFile(new URL("../background.js", import.meta.url), "utf8");

check(
  background.includes("preparedObservation?.disposition === PREPARED_EFFECT_OBSERVATION_DISPOSITION.SUPERSEDED"),
  "Cancellation must be gated by explicit owner supersession disposition."
);

check(
  !background.includes("page.generating ||\n      String(page.latestAssistantHash"),
  "Transient page.generating must not be part of the supersession predicate."
);

check(
  background.includes("backgroundActive ? STATES.WAITING_BACKGROUND : STATES.WAITING_FOREGROUND"),
  "Same-owner busy wait must use explicit foreground/background wait states."
);

check(
  background.includes("run.responseDeadlineAt = null;") &&
  background.includes("run.timeoutSuspended = true;"),
  "A pre-submit busy wait must not inherit a prior response timeout."
);

check(
  background.includes('tickWindow(windowId, "prepared-effect-target-busy-recheck")'),
  "Transient busy state must receive a fast bounded recheck with watchdog fallback."
);

check(
  background.includes("PREPARED_EFFECT_OWNER_IDENTITY_UNREADABLE") ||
  background.includes("prepared-effect-owner-readback"),
  "Unreadable owner identity must fail closed into readback/recovery, not submit or cancel."
);

check(
  background.includes("Förberedd prompt kasserad efter verklig owner-supersession"),
  "Audit wording must distinguish real owner supersession from transient generating state."
);


check(
  background.includes("Förberedd men ännu ej skickad prompt väntar på stabil foreground.") &&
  background.includes("run.responseDeadlineAt = null;") &&
  background.includes("run.timeoutSuspended = true;"),
  "Foreground watchdog path must preserve a prepared effect as pre-submit work, not response wait."
);

check(
  background.includes("PREPARED_EFFECT_FAST_RECHECK_WINDOW_MS") &&
  background.includes('tickWindow(windowId, "prepared-effect-foreground-stability")'),
  "Transient foreground busy state must be rechecked quickly but only inside a bounded fast-recheck window."
);

check(
  background.includes("ownerWaitAgeMs < PREPARED_EFFECT_FAST_RECHECK_WINDOW_MS"),
  "Unreadable owner identity retries must also leave the fast polling loop after the bounded window."
);

console.log(`v0.12.12 handoff regression: ${assertions}/${assertions} PASS`);
