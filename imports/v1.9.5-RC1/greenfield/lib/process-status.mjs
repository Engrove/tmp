import { text } from "./common.mjs";
import { queueTurnControl } from "./mission-work-queue.mjs";
import { sessionHealthCapsule } from "./session-health.mjs";

export const PROCESS_STATUS_SCHEMA = "eic.greenfield.process-status.v1";
export const PROCESS_STATUS_REQUEST = "FULL_NEXT_PROMPT";

function boundedObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function boundedArray(value, max = 8) {
  return Array.isArray(value) ? value.slice(-max) : [];
}
function errorCapsule(value) {
  if (!value || typeof value !== "object") return null;
  return {
    code: text(value.code || value.name, 160),
    message: text(value.message, 800)
  };
}

export function buildFullProcessStatus(process, { at = Date.now() } = {}) {
  const queue = queueTurnControl(process);
  const health = sessionHealthCapsule(process?.sessionHealth, {
    turn: Number(process?.turn || 1),
    sessionSeq: Number(process?.sessionSeq || 1),
    sessionStartTurn: Number(process?.sessionHealth?.sessionStartTurn || process?.turn || 1)
  });
  const rawHealth = boundedObject(process?.sessionHealth) || {};
  const lastPrompt = boundedObject(process?.lastPrompt);
  const pendingPrompt = boundedObject(process?.pendingPrompt);
  const lastResponse = boundedObject(process?.lastResponse);
  const rotation = boundedObject(process?.sessionRotation);
  const pause = boundedObject(process?.missionPause);
  const recovery = boundedObject(process?.recovery) || {};
  const control = boundedObject(process?.greenfieldControl);
  const decision = boundedObject(process?.lastDecision);

  return {
    schema: PROCESS_STATUS_SCHEMA,
    mode: PROCESS_STATUS_REQUEST,
    generatedAt: new Date(Number(at)).toISOString(),
    identity: {
      processId: text(process?.processId, 200),
      runId: text(process?.runId, 200),
      workerId: text(process?.workerId, 200),
      generation: Number(process?.generation || 0),
      turn: Number(process?.turn || 0),
      sessionSeq: Number(process?.sessionSeq || 0),
      windowId: Number.isInteger(process?.windowId) ? process.windowId : null,
      tabId: Number.isInteger(process?.tabId) ? process.tabId : null
    },
    execution: {
      phase: text(process?.phase, 80),
      schedulerPriority: text(process?.schedulerPriority, 40),
      objectiveId: text(process?.objectiveState?.objectiveId, 200),
      objectiveStatus: text(process?.objectiveState?.status, 80),
      createdAt: text(process?.createdAt, 100),
      updatedAt: text(process?.updatedAt, 100),
      lastMaterialAt: text(process?.lastMaterialAt, 100),
      completedAt: text(process?.completedAt, 100)
    },
    queue,
    sessionHealth: {
      ...health,
      recentSamples: boundedArray(rawHealth.samples, 5).map((sample) => ({
        turn: Number(sample?.turn || 0),
        ttfrMs: Number.isFinite(sample?.ttfrMs) ? Number(sample.ttfrMs) : null,
        completionMs: Number.isFinite(sample?.completionMs) ? Number(sample.completionMs) : null,
        totalMs: Number.isFinite(sample?.totalMs) ? Number(sample.totalMs) : null,
        responseChars: Number(sample?.responseChars || 0),
        clean: sample?.clean === true
      }))
    },
    prompt: {
      pending: Boolean(pendingPrompt),
      pendingHash: text(pendingPrompt?.hash, 128),
      pendingCreatedAt: text(pendingPrompt?.createdAt, 100),
      pendingSendAttempts: Number(pendingPrompt?.sendAttempts || 0),
      pendingDispatchId: text(pendingPrompt?.dispatch?.operationId, 200),
      pendingDispatchAcknowledged: pendingPrompt?.dispatch?.acknowledged === true,
      lastHash: text(lastPrompt?.hash, 128),
      lastSentAt: text(lastPrompt?.sentAt, 100),
      lastAcknowledged: lastPrompt?.acknowledged === true
    },
    response: {
      lastHash: text(lastResponse?.hash, 128),
      lastCapturedAt: text(lastResponse?.capturedAt || lastResponse?.createdAt, 100),
      protocolFound: lastResponse?.contract?.found === true,
      protocolValid: lastResponse?.contract?.ok === true,
      controlValid: lastResponse?.contract?.controlOk === true,
      status: text(lastResponse?.contract?.status, 64),
      sessionAction: text(lastResponse?.contract?.value?.sessionAction || lastResponse?.contract?.control?.sessionAction, 64)
    },
    safety: {
      hold: boundedObject(process?.safetyHold) ? {
        code: text(process.safetyHold.code, 160),
        sinceMs: Number(process.safetyHold.sinceMs || 0),
        detail: text(process.safetyHold.detail, 500)
      } : null,
      lastProofCode: text(process?.lastSafetyProof?.code || process?.safety?.proof?.code, 160)
    },
    continuity: {
      rotation: rotation ? {
        state: text(rotation.state, 80),
        reasonCode: text(rotation.reasonCode, 160),
        requestedBy: text(rotation.requestedBy, 100),
        sessionSeq: Number(rotation.sessionSeq || 0),
        queueSwitch: rotation.queueSwitch === true
      } : null,
      pause: pause ? {
        state: text(pause.state, 80),
        pauseId: text(pause.pauseId, 200),
        requestedSeconds: Number(pause.durationSeconds || pause.requestedSeconds || 0),
        resumeNotBeforeAt: text(pause.resumeNotBeforeAt, 100)
      } : null,
      detached: boundedObject(process?.detached) ? {
        code: text(process.detached.code, 160),
        resumePhase: text(process.detached.resumePhase, 80),
        reconcileAttempts: Number(process.detached.reconcileAttempts || 0)
      } : null
    },
    recovery: {
      attempts: Number(recovery.attempts || 0),
      lastAttemptAt: text(recovery.lastAttemptAt, 100),
      lastError: errorCapsule(recovery.lastError)
    },
    control: control ? {
      state: text(control.state, 80),
      action: text(control.action, 80),
      reason: text(control.reason, 160),
      hardStop: control.hardStop === true
    } : null,
    decision: decision ? {
      disposition: text(decision.disposition, 80),
      targetDisposition: text(decision.targetDisposition, 80),
      objectiveStatus: text(decision.objectiveStatus, 80),
      confidence: text(decision.confidence, 40)
    } : null,
    lastError: errorCapsule(process?.lastError),
    privacyBoundary: "Control-plane status only. Prompt/response bodies, hidden reasoning, credentials and secret-bearing payloads are omitted."
  };
}
