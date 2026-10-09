import { conversationKey } from "./restart-recovery.mjs";
import { autonomousUserTurnProof, expectedAutonomousUserTurn } from "./turn-causality.mjs";

const LIVE_OBSERVATION_RECOVERABLE = new Set([
  "CONVERSATION_TAB_NOT_RESTORED",
  "RECOVERY_PAGE_UNAVAILABLE",
  "CONVERSATION_IDENTITY_UNPROVEN",
  "RECOVERY_USER_TURN_UNPROVEN"
]);

function matchesProcess(row, process) {
  const workerId = String(process?.workerId || "");
  const processId = String(process?.processId || "");
  return Boolean(
    (workerId && String(row?.workerId || "") === workerId) ||
    (processId && String(row?.processId || "") === processId)
  );
}

export function reconcileRecoveryReportWithLiveObservation(report, process, page, nowMs = Date.now()) {
  const unresolved = Array.isArray(report?.unresolved) ? report.unresolved : [];
  if (!unresolved.length || !process || !page) return report;

  const processConversation = conversationKey(process.lastManagedUrl);
  const pageConversation = conversationKey(page.url);
  if (!processConversation || processConversation !== pageConversation) return report;

  const expectedTurn = expectedAutonomousUserTurn(process);
  const requiresTurnProof = Boolean(expectedTurn.id || Number.isInteger(expectedTurn.index));
  const turnProof = requiresTurnProof
    ? autonomousUserTurnProof(process, page)
    : { ok: true, code: "NO_TURN_PROOF_REQUIRED" };

  const resolvedRows = [];
  const remaining = [];
  for (const row of unresolved) {
    if (!matchesProcess(row, process) || !LIVE_OBSERVATION_RECOVERABLE.has(String(row?.code || ""))) {
      remaining.push(row);
      continue;
    }
    if (String(row?.code || "") === "RECOVERY_USER_TURN_UNPROVEN" && !turnProof.ok) {
      remaining.push(row);
      continue;
    }
    resolvedRows.push(row);
  }

  if (!resolvedRows.length) return report;

  const existingRestored = Array.isArray(report?.restored) ? report.restored : [];
  const restored = [...existingRestored];
  for (const row of resolvedRows) {
    const key = `${String(row.workerId || "")}:${String(row.processId || "")}:LIVE_OBSERVATION_RECOVERY_RESOLVED`;
    const duplicate = restored.some((item) =>
      `${String(item.workerId || "")}:${String(item.processId || "")}:${String(item.code || "")}` === key
    );
    if (!duplicate) {
      restored.push({
        workerId: row.workerId || process.workerId || "",
        processId: row.processId || process.processId || "",
        goal: row.goal || String(process.goal || "").slice(0, 220),
        phase: process.phase || row.phase || "",
        conversationUrl: process.lastManagedUrl || page.url || "",
        code: "LIVE_OBSERVATION_RECOVERY_RESOLVED",
        priorCode: row.code || "",
        turnProof: turnProof.code,
        resolvedAtMs: nowMs
      });
    }
  }

  return {
    ...report,
    atMs: nowMs,
    unresolved: remaining,
    restored: restored.slice(-30)
  };
}
