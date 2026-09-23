#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

function sameExecution(a, b) {
  return String(a?.processId || "") === String(b?.processId || "") &&
    String(a?.runId || "") === String(b?.runId || "") &&
    Number(a?.turn) === Number(b?.turn);
}

function isResolvedAssistantPage(row) {
  const p = row?.payload || {};
  return row?.kind === "PAGE_STATE_OBSERVED" &&
    row?.phase === "SENDING" &&
    Boolean(String(p.lastUserId || "")) &&
    Number(p.userCount || 0) > 0 &&
    Number(p.assistantCount || 0) > 0 &&
    Boolean(String(p.lastAssistantId || "")) &&
    p.lastAssistantOwnerTrusted === true &&
    p.generating === false;
}

function isAcknowledgedFence(row) {
  const p = row?.payload || {};
  return row?.kind === "PROMPT_DISPATCH_FENCE_EVALUATED" &&
    p.action === "WAIT_NO_RESEND" &&
    p.effectPossible === true &&
    p.dispatchStatus === "ACKNOWLEDGED";
}

function isUnresolvedHold(row) {
  return row?.kind === "SAFETY_HOLD" &&
    row?.payload?.code === "DISPATCH_EFFECT_UNRESOLVED";
}

export function analyzeDispatchAudit(rows) {
  const ordered = [...rows].sort((a, b) => {
    const ta = Date.parse(a?.timestamp || "") || 0;
    const tb = Date.parse(b?.timestamp || "") || 0;
    if (ta !== tb) return ta - tb;
    return Number(a?.seq || 0) - Number(b?.seq || 0);
  });

  const cycles = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const page = ordered[i];
    if (!isResolvedAssistantPage(page)) continue;

    let fence = null;
    let hold = null;
    for (let j = i + 1; j < ordered.length; j += 1) {
      const candidate = ordered[j];
      if (!sameExecution(page, candidate)) continue;
      if (candidate.kind === "PAGE_STATE_OBSERVED" || candidate.kind === "PROCESS_TICK") break;
      if (!fence && isAcknowledgedFence(candidate)) {
        fence = candidate;
        continue;
      }
      if (fence && isUnresolvedHold(candidate)) {
        hold = candidate;
        break;
      }
    }

    if (!fence || !hold) continue;
    cycles.push({
      pageTimestamp: page.timestamp,
      fenceTimestamp: fence.timestamp,
      holdTimestamp: hold.timestamp,
      pageUserCount: Number(page.payload?.userCount || 0),
      pageAssistantCount: Number(page.payload?.assistantCount || 0),
      trustedAssistant: page.payload?.lastAssistantOwnerTrusted === true,
      generating: page.payload?.generating === true,
      dispatchStatus: fence.payload?.dispatchStatus || "",
      effectPossible: fence.payload?.effectPossible === true,
      fenceEvidence: fence.payload?.evidence || "",
      promptHashDiffersFromRenderedUserHash: Boolean(
        fence.payload?.promptHash &&
        page.payload?.lastUserHash &&
        fence.payload.promptHash !== page.payload.lastUserHash
      )
    });
  }

  return {
    schema: "eic.greenfield.dispatch-audit-replay.v1",
    sourceAppVersions: [...new Set(ordered.map((row) => String(row?.appVersion || "")).filter(Boolean))],
    rowCount: ordered.length,
    firstTimestamp: ordered[0]?.timestamp || "",
    lastTimestamp: ordered.at(-1)?.timestamp || "",
    affectedCycles: cycles.length,
    acknowledgedEffectCycles: cycles.filter((c) => c.effectPossible && c.dispatchStatus === "ACKNOWLEDGED").length,
    trustedAssistantPresentCycles: cycles.filter((c) => c.trustedAssistant && !c.generating).length,
    renderedHashMismatchCycles: cycles.filter((c) => c.promptHashDiffersFromRenderedUserHash).length,
    fenceEvidenceCounts: Object.fromEntries(
      [...new Set(cycles.map((c) => c.fenceEvidence))].sort().map((key) => [
        key,
        cycles.filter((c) => c.fenceEvidence === key).length
      ])
    )
  };
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node tools/replay-dispatch-audit.mjs <audit.ndjson>");
    process.exitCode = 64;
    return;
  }

  const body = await readFile(file, "utf8");
  const rows = [];
  for (const [index, line] of body.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`Invalid NDJSON at line ${index + 1}: ${error.message}`);
    }
  }

  const result = analyzeDispatchAudit(rows);
  console.log(JSON.stringify({ sourceFile: basename(file), ...result }, null, 2));
  if (result.affectedCycles === 0) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
