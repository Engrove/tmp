import { sendFenceDecision } from "./send-fence.mjs";
import { autonomousUserTurnProof } from "./turn-causality.mjs";

function nonNegativeInteger(value) {
  const number = value == null ? Number.NaN : Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

export function reconcileDispatchObservation(process, page = {}) {
  const pending = process?.pendingPrompt || null;
  if (!pending?.text || !pending?.hash) {
    return {
      action: "INVALID",
      fence: { action: "INVALID", evidence: "PENDING_PROMPT_MISSING" },
      turnProof: { ok: false, code: "AUTONOMOUS_USER_TURN_EXPECTATION_MISSING", expected: { id: "", index: null } },
      resolvedUserTurnId: "",
      resolvedUserTurnIndex: null
    };
  }

  const fence = sendFenceDecision(pending, page);
  const turnProof = autonomousUserTurnProof(process, page);
  const materializedUserTurnId = String(pending.dispatch?.materializedUserTurnId || "");

  const resolvedUserTurnId = String(
    materializedUserTurnId ||
    turnProof.resolvedUserTurnId ||
    ((fence.action === "ALREADY_MATERIALIZED" && turnProof.ok) ? page.lastUserId : "") ||
    ""
  );

  const expectedIndex = nonNegativeInteger(turnProof.expected?.index);
  const resolvedUserTurnIndex = expectedIndex ??
    (fence.action === "ALREADY_MATERIALIZED" && turnProof.ok && Number(page.userCount || 0) > 0
      ? Number(page.userCount) - 1
      : null);

  if (fence.action === "WAIT_NO_RESEND" && !turnProof.ok) {
    return {
      action: "HOLD_UNRESOLVED",
      fence,
      turnProof,
      resolvedUserTurnId,
      resolvedUserTurnIndex
    };
  }

  if (fence.action === "WAIT_NO_RESEND" || fence.action === "ALREADY_MATERIALIZED") {
    return {
      action: "ADVANCE_TO_WAITING",
      fence,
      turnProof,
      resolvedUserTurnId,
      resolvedUserTurnIndex
    };
  }

  return {
    action: fence.action,
    fence,
    turnProof,
    resolvedUserTurnId,
    resolvedUserTurnIndex
  };
}
