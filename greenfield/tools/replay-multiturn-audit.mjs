#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node tools/replay-multiturn-audit.mjs <audit.ndjson>");
  process.exit(2);
}

const raw = fs.readFileSync(path, "utf8");
const rows = raw.split(/\r?\n/).filter(Boolean).map((line, index) => {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`INVALID_NDJSON_LINE:${index + 1}:${error.message}`);
  }
});

const pages = rows.filter((row) => row?.kind === "PAGE_STATE_OBSERVED");
const stale = [];
for (const row of pages) {
  const payload = row?.payload || {};
  const auto = payload?.autonomousTurn || {};
  const expected = String(auto.expectedUserTurnId || "");
  const resolved = String(auto.resolvedUserTurnId || "");
  const latest = String(payload.lastUserId || "");
  const latestAssistant = String(payload.assistantHash || "");
  const pairedAssistant = String(auto.assistantHash || "");
  const turn = Number(row?.turn || 0);
  const phase = String(row?.phase || "");

  const olderTurnBound = Boolean(
    phase === "WAITING" &&
    turn > 1 &&
    expected &&
    latest &&
    expected !== latest &&
    resolved === expected &&
    (
      String(auto.nextUserTurnId || "") === latest ||
      (latestAssistant && pairedAssistant && latestAssistant !== pairedAssistant)
    )
  );

  if (olderTurnBound) {
    stale.push({
      timestamp: row.timestamp || "",
      turn,
      phase,
      latestAssistantComplete: payload.generating !== true,
      assistantPairDiffers: Boolean(latestAssistant && pairedAssistant && latestAssistant !== pairedAssistant)
    });
  }
}

const firstTime = stale.length ? Date.parse(stale[0].timestamp) : Number.NaN;
const lastTime = stale.length ? Date.parse(stale.at(-1).timestamp) : Number.NaN;
const output = {
  schema: "eic.greenfield.multiturn-audit-replay.v1",
  inputSha256: crypto.createHash("sha256").update(raw).digest("hex"),
  totalRows: rows.length,
  pageStateRows: pages.length,
  stalePriorTurnBindingRows: stale.length,
  stalePriorTurnBindingTurns: [...new Set(stale.map((item) => item.turn))],
  completedLatestAssistantRows: stale.filter((item) => item.latestAssistantComplete).length,
  differingAssistantPairRows: stale.filter((item) => item.assistantPairDiffers).length,
  observedDurationMs: Number.isFinite(firstTime) && Number.isFinite(lastTime)
    ? Math.max(0, lastTime - firstTime)
    : null,
  firstObservedAt: stale[0]?.timestamp || null,
  lastObservedAt: stale.at(-1)?.timestamp || null
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
