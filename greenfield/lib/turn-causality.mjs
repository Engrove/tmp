function nonNegativeInteger(value) {
  const number = value == null ? Number.NaN : Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function activePromptIdentity(process) {
  const pendingPrompt = process?.pendingPrompt || null;
  const lastPrompt = process?.lastPrompt || null;
  const phase = String(process?.phase || "").toUpperCase();
  const recoverTo = String(
    process?.detached?.recoverTo ||
    process?.recovery?.recoverTo ||
    ""
  ).toUpperCase();

  // Prompt ownership follows the runtime lifecycle rather than object
  // presence. During SENDING (including a detached/recovering SENDING
  // recovery), the current pending prompt is the only prompt allowed to own
  // browser-turn identity. In WAITING/ANALYZING and later phases, the
  // materialized lastPrompt owns the completed dispatch even if a legacy or
  // partially migrated object still retains a stale pendingPrompt field.
  const pendingOwnsTurn = Boolean(
    pendingPrompt &&
    (
      phase === "SENDING" ||
      ((phase === "DETACHED" || phase === "RECOVERING") && recoverTo === "SENDING")
    )
  );

  if (pendingOwnsTurn) {
    const dispatch = pendingPrompt.dispatch || null;
    const pendingId = String(dispatch?.materializedUserTurnId || "");
    const dispatchIndex = nonNegativeInteger(dispatch?.materializedUserTurnIndex);
    const baselineIndex = dispatch?.effectPossible === true || dispatch?.acknowledged === true
      ? nonNegativeInteger(dispatch?.baselineUserCount)
      : null;
    return {
      id: pendingId,
      index: dispatchIndex ?? baselineIndex,
      promptHash: String(pendingPrompt.hash || ""),
      dispatch
    };
  }

  return {
    id: String(lastPrompt?.dispatchedUserTurnId || ""),
    index: nonNegativeInteger(lastPrompt?.dispatchedUserTurnIndex),
    promptHash: String(lastPrompt?.hash || ""),
    dispatch: null
  };
}

export function expectedAutonomousUserTurn(process) {
  const identity = activePromptIdentity(process);
  return { id: identity.id, index: identity.index };
}

export function autonomousUserTurnProof(process, page, { allowLegacyHash = true } = {}) {
  const expected = expectedAutonomousUserTurn(process);
  const identity = activePromptIdentity(process);
  const auto = page?.autonomousTurn && typeof page.autonomousTurn === "object"
    ? page.autonomousTurn
    : {};
  const resolvedUserTurnId = String(auto.resolvedUserTurnId || "");
  const latestUserTurnId = String(page?.lastUserId || "");
  const resolvedBy = String(auto.resolvedBy || "NONE");
  const autoIndex = nonNegativeInteger(auto.expectedUserIndex);

  if (expected.id) {
    if (resolvedUserTurnId === expected.id) {
      return {
        ok: true,
        code: "AUTONOMOUS_USER_TURN_ID_MATCH",
        expected,
        resolvedUserTurnId,
        resolvedBy
      };
    }
    if (!resolvedUserTurnId && latestUserTurnId === expected.id) {
      return {
        ok: true,
        code: "AUTONOMOUS_LAST_USER_TURN_ID_MATCH",
        expected,
        resolvedUserTurnId: latestUserTurnId,
        resolvedBy: "PAGE_LAST_USER_ID"
      };
    }
    return {
      ok: false,
      code: resolvedUserTurnId
        ? "AUTONOMOUS_USER_TURN_ID_MISMATCH"
        : "AUTONOMOUS_USER_TURN_NOT_RESOLVED",
      expected,
      resolvedUserTurnId,
      resolvedBy
    };
  }

  if (Number.isInteger(expected.index)) {
    if (resolvedUserTurnId &&
        resolvedBy === "USER_ORDINAL" &&
        autoIndex === expected.index) {
      return {
        ok: true,
        code: "AUTONOMOUS_USER_TURN_ORDINAL_MATCH",
        expected,
        resolvedUserTurnId,
        resolvedBy
      };
    }
  }

  if (allowLegacyHash && identity.promptHash) {
    const hashMatch = page?.lastUserHash === identity.promptHash ||
      auto?.userTextHash === identity.promptHash;
    if (hashMatch) {
      return {
        ok: true,
        code: "LEGACY_USER_TEXT_HASH_MATCH",
        expected,
        resolvedUserTurnId: resolvedUserTurnId || latestUserTurnId,
        resolvedBy: resolvedBy === "NONE" ? "TEXT_HASH" : resolvedBy
      };
    }
  }

  return {
    ok: false,
    code: expected.id || Number.isInteger(expected.index)
      ? "AUTONOMOUS_USER_TURN_NOT_RESOLVED"
      : "AUTONOMOUS_USER_TURN_EXPECTATION_MISSING",
    expected,
    resolvedUserTurnId,
    resolvedBy
  };
}

export function autonomousResponseObservation(process, page) {
  const expected = expectedAutonomousUserTurn(process);
  const auto = page?.autonomousTurn && typeof page.autonomousTurn === "object"
    ? page.autonomousTurn
    : {};
  const turnProof = autonomousUserTurnProof(process, page);

  if (!turnProof.ok) {
    return {
      ready: false,
      reason: turnProof.code,
      expected,
      auto
    };
  }

  const resolvedUserTurnId = String(
    turnProof.resolvedUserTurnId ||
    auto.resolvedUserTurnId ||
    page?.lastUserId ||
    ""
  );
  if (!resolvedUserTurnId) {
    return {
      ready: false,
      reason: "AUTONOMOUS_USER_TURN_NOT_RESOLVED",
      expected,
      auto
    };
  }

  if (auto.assistantFound !== true || !String(auto.assistantId || "")) {
    const responseSlotClosed = auto.responseSlotClosed === true &&
      Boolean(String(auto.nextUserTurnId || ""));
    return {
      ready: false,
      reason: responseSlotClosed
        ? "AUTONOMOUS_RESPONSE_PRODUCER_LOST"
        : "AUTONOMOUS_ASSISTANT_NOT_OBSERVED",
      expected,
      auto
    };
  }

  const observation = {
    documentId: page?.documentId || "",
    lastAssistantId: String(auto.assistantId || ""),
    lastAssistantOwnerKind: String(auto.assistantOwnerKind || "NONE"),
    lastAssistantOwnerTrusted: auto.assistantOwnerTrusted === true,
    lastAssistantReplicaCount: Number(auto.assistantReplicaCount || 0),
    assistantHash: String(auto.assistantHash || ""),
    assistantText: String(auto.assistantText || ""),
    assistantTextLength: Number(auto.assistantTextLength ?? String(auto.assistantText || "").length),
    assistantCount: page?.assistantCount ?? null,
    generating: auto.assistantGenerating === true,
    signals: auto.assistantSignals || {},
    expectedUserTurnId: expected.id || resolvedUserTurnId,
    pairedUserTurnId: resolvedUserTurnId,
    pairedUserResolvedBy: String(auto.resolvedBy || "NONE"),
    nextUserTurnId: String(auto.nextUserTurnId || ""),
    responseSlotClosed: auto.responseSlotClosed === true
  };

  return {
    ready: true,
    reason: "AUTONOMOUS_ASSISTANT_OBSERVED",
    expected,
    auto,
    observation
  };
}

export function externalAssistantInterleaveEvidence(page, autonomousObservation) {
  const latestUserTurnId = String(page?.lastUserId || "");
  const latestAssistantTurnId = String(page?.lastAssistantId || "");
  const latestAssistantHash = String(page?.assistantHash || "");
  const autonomousUserTurnId = String(
    autonomousObservation?.pairedUserTurnId ||
    autonomousObservation?.expectedUserTurnId ||
    ""
  );
  const autonomousAssistantTurnId = String(autonomousObservation?.lastAssistantId || "");
  const autonomousAssistantHash = String(autonomousObservation?.assistantHash || "");
  const observed = Boolean(
    latestAssistantTurnId &&
    (
      (autonomousAssistantTurnId && latestAssistantTurnId !== autonomousAssistantTurnId) ||
      (!autonomousAssistantTurnId && latestUserTurnId && autonomousUserTurnId &&
        latestUserTurnId !== autonomousUserTurnId)
    )
  );

  return {
    observed,
    latestUserTurnId,
    latestAssistantTurnId,
    latestAssistantHash,
    autonomousUserTurnId,
    autonomousAssistantTurnId,
    autonomousAssistantHash,
    admissibleAsAutonomousResponse: false
  };
}

export function isExternalAssistantInterleaved(page, autonomousObservation) {
  return externalAssistantInterleaveEvidence(page, autonomousObservation).observed;
}
