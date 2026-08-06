/**
 * Replays the observed v0.6.3 runtime incident against v0.6.4 logic.
 *
 *   node scripts/replay-v064-export.mjs <path-to-v0.6.3-export.json>
 *
 * Every check is falsifiable: it either reproduces the v0.6.3 defect signature or
 * proves the v0.6.4 behaviour on the same input. No check reports PASS from prose.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { isMetaOnlyAction, deriveDeterministicProgress } from "../lib/decision-grounding.mjs";
import {
  applyNanoDecision,
  classifyActionKey,
  compactContinuity,
  createContinuity,
  normalizeContinuity,
  projectContinuity
} from "../lib/continuity.mjs";
import { resolveNanoInputBudget } from "../lib/nano-input-budget.mjs";
import { buildNanoDecisionPromptDetailed } from "../lib/nano-pipeline.mjs";

const exportPath = process.argv[2];
if (!exportPath) {
  console.error("Ange sökväg till en v0.6.3-export: node scripts/replay-v064-export.mjs <fil>");
  process.exit(2);
}

const raw = fs.readFileSync(path.resolve(exportPath));
const data = JSON.parse(raw.toString("utf8"));
const digest = crypto.createHash("sha256").update(raw).digest("hex");

const results = [];
const record = (id, description, passed, evidence) => {
  results.push({ id, description, passed, evidence });
};

console.log(`EXPORT: ${path.basename(exportPath)}`);
console.log(`BYTES : ${raw.length}`);
console.log(`SHA256: ${digest}`);
console.log(`APP   : ${data.appVersion} · turnIndex ${data.window?.run?.turnIndex} · revision ${data.window?.run?.stateRevision}`);
console.log("");

// D1 — Nano input budget
const hostWindow = Number(data.window?.nanoHostTelemetry?.contextWindow || 0);
const hostUsage = Number(data.window?.nanoHostTelemetry?.contextUsage || 0);
const observedInputs = (data.audit || [])
  .filter((entry) => /Nano-analys startad/.test(entry.title || ""))
  .map((entry) => Number(String(entry.detail || "").match(/input (\d+) tecken/)?.[1] || 0))
  .filter(Boolean);
const worstObserved = observedInputs.length ? Math.max(...observedInputs) : 0;
const budget = resolveNanoInputBudget({ contextWindow: hostWindow, contextUsage: hostUsage });
const projection = projectContinuity(data.continuity);
const built = buildNanoDecisionPromptDetailed({
  run: data.window?.run,
  request: { requestId: "replay", mode: "CONTINUATION_ANALYSIS" },
  observation: {
    responseText: "X".repeat(20_000),
    conversationExcerpt: "Y".repeat(12_000)
  },
  config: data.config,
  continuityProjection: projection,
  maxPromptChars: budget.maxPromptChars
});
record(
  "D1",
  "Nano-prompten ryms i värdmodellens contextfönster",
  built.budget.withinBudget && built.prompt.length <= budget.maxPromptChars,
  `observerat v0.6.3-max ${worstObserved} tecken · fönster ${hostWindow} token · budget ${budget.maxPromptChars} tecken · v0.6.4 ${built.prompt.length} tecken`
);

// D4 — effect verb lexicon against the real EIC_NEXT strings
const targetNexts = (data.continuity?.targetClaims || [])
  .map((claim) => String(claim.claim || ""))
  .filter((text) => /^Målsessionen föreslog: /.test(text))
  .map((text) => text.replace(/^Målsessionen föreslog: /, ""));
const summaryNext = String(data.window?.run?.nanoTelemetry?.lastResultSummary || "")
  .replace(/^CONTINUE:\s*/, "");
const allNexts = [...targetNexts, summaryNext].filter(Boolean);
const stillMeta = allNexts.filter((text) => isMetaOnlyAction(text));
record(
  "D4",
  "Verkliga EIC_NEXT klassas som konkreta åtgärder",
  allNexts.length > 0 && stillMeta.length === 0,
  `${allNexts.length - stillMeta.length}/${allNexts.length} konkreta`
);

const progress = deriveDeterministicProgress({
  priorResponseHash: "a".repeat(64),
  currentResponseHash: "b".repeat(64),
  requestedAction: summaryNext,
  priorWorkUnit: data.continuity?.position?.workUnit || "",
  workUnit: data.continuity?.position?.workUnit || "",
  targetResult: { valid: true, status: "CONTINUE", next: summaryNext }
});
record(
  "D4b",
  "Deterministisk progress kan nu nå 1 på samma målsvar",
  progress.value === 1,
  `value=${progress.value} targetNextIsConcrete=${progress.targetNextIsConcrete}`
);

// D3 — action key classification on the exact recorded keys
const keys = data.continuity?.antiLoop?.actionKeys || [];
const concreteKeys = keys.filter((key) => classifyActionKey(key) === "CONCRETE");
let replayContinuity = createContinuity({
  intent: data.continuity?.intent?.text || "replay",
  workUnit: data.continuity?.position?.workUnit || "replay",
  now: 1000
});
keys.forEach((key, index) => {
  const action = String(key).split("|").pop();
  replayContinuity = applyNanoDecision(replayContinuity, {
    action: "CONTINUE",
    progressDelta: isMetaOnlyAction(action) ? 0 : 1,
    workUnit: data.continuity?.position?.workUnit || "replay",
    requestedAction: action,
    reason: "replay"
  }, { turnIndex: index + 1, actionKey: key, now: 2000 + index });
});
record(
  "D3",
  "Anti-loop räknar produktivt arbete i stället för att kalla allt audit",
  replayContinuity.antiLoop.productiveActionCount > 0,
  `v0.6.3: productive=${data.continuity?.antiLoop?.productiveActionCount} audit=${data.continuity?.antiLoop?.auditActionCount} · ` +
  `v0.6.4 replay: productive=${replayContinuity.antiLoop.productiveActionCount} audit=${replayContinuity.antiLoop.auditActionCount} concrete=${concreteKeys.length}/${keys.length}`
);

// D2 — semantic compaction on the exported continuity
const compacted = compactContinuity(normalizeContinuity(data.continuity), { now: Date.now() });
const before = JSON.stringify(normalizeContinuity(data.continuity)).length;
const after = JSON.stringify(compacted).length;
record(
  "D2",
  "Kontinuiteten kompakteras semantiskt",
  compacted.compactionGeneration > Number(data.continuity?.compactionGeneration || 0) || after < before,
  `v0.6.3 generation ${data.continuity?.compactionGeneration} · ${before} → ${after} byte · ` +
  `removed=${compacted.compaction.removedItems} merged=${compacted.compaction.mergedItems}`
);

// D6 — blocker lifecycle
const openBlockers = (data.continuity?.blockers || []).filter((item) => item.open !== false);
const currentTurn = Number(data.continuity?.position?.turnIndex || 0);
const expiredNow = compacted.blockers.filter((item) => item.open === false && /STALE_NO_REASSERTION/.test(item.closedReason || ""));
record(
  "D6",
  "Tysta blockerare får en explicit, icke-lösande stängning",
  openBlockers.length === 0 || expiredNow.length > 0 || currentTurn < 6,
  `öppna i v0.6.3: ${openBlockers.length} · stale-stängda i replay: ${expiredNow.length}`
);

console.log("REPLAY RESULT");
console.log("".padEnd(96, "-"));
for (const result of results) {
  console.log(`${result.passed ? "PASS" : "FAIL"}  ${result.id.padEnd(4)} ${result.description}`);
  console.log(`            ${result.evidence}`);
}
console.log("".padEnd(96, "-"));
const failed = results.filter((result) => !result.passed);
console.log(failed.length
  ? `REPLAY FAIL: ${failed.length} av ${results.length} kontroller föll.`
  : `REPLAY PASS: ${results.length} av ${results.length} kontroller.`);
console.log("CLAIM BOUNDARY: detta är källkodsreplay i Node, inte bevis för desktop-Chrome-runtime.");
process.exit(failed.length ? 1 : 0);
