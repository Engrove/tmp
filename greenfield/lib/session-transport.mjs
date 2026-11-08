import { randomId, normalizeText, sha256Hex, nowIso } from "./common.mjs";
import { conversationKey } from "./restart-recovery.mjs";
import { savedMissionProject } from "./saved-mission-catalog.mjs";
import { autonomousUserTurnProof } from "./turn-causality.mjs";

export const SESSION_INITIALIZATION = "SESSION_INITIALIZATION";
export const DELIVERY_CONTINUATION = "DELIVERY_CONTINUATION";
export const DELIVERY_CONTINUATION_MAX_ATTEMPTS = 3;
export const DELIVERY_NOTICE_SETTLE_MS = 5000;

export function isInitializationPrompt(prompt) {
  return prompt?.transportKind === SESSION_INITIALIZATION;
}
export function isTransportPrompt(prompt) {
  return isInitializationPrompt(prompt) || prompt?.transportKind === DELIVERY_CONTINUATION;
}
export function waitingForInitialization(process) {
  return isInitializationPrompt(process?.lastPrompt) ||
    process?.lastPrompt?.transportKind === DELIVERY_CONTINUATION &&
    isInitializationPrompt(process?.deliveryRetry?.rootPrompt);
}
export function workPromptHash(process) {
  return process?.lastPrompt?.transportKind === DELIVERY_CONTINUATION
    ? process.deliveryRetry?.rootPrompt?.hash || process.lastPrompt.hash
    : process?.lastPrompt?.hash || "";
}

function initializationAckBinding(process, initializationId, workPrompt) {
  return { initializationId, processId: String(process.processId || ""),
    workerId: String(process.workerId || ""), runId: String(process.runId || ""),
    sessionSeq: Number(process.sessionSeq), queueId: String(process.queueContext?.queueId || ""),
    itemId: String(process.queueContext?.itemId || ""),
    savedMissionId: String(process.queueContext?.savedMissionId || ""),
    workPromptHash: String(workPrompt?.hash || "") };
}

// Local challenge binding supplements, never replaces, conversation/turn/owner
// checks. It is a transport receipt, not proof that project work is complete.
export function expectedInitializationAck(process) {
  const init = process?.sessionInitialization;
  const ack = init?.acknowledgement;
  if (!ack || ack.schema !== "eic.greenfield.initialization-ack.v1" ||
      !/^[a-f0-9]{64}$/.test(String(ack.hash || "")) || !init.workPrompt?.hash) return "";
  const binding = initializationAckBinding(process, init.initializationId, init.workPrompt);
  if (!binding.initializationId || !binding.processId || !binding.workerId || !binding.runId ||
      !Number.isSafeInteger(binding.sessionSeq) || binding.sessionSeq < 1 ||
      !Object.keys(binding).every(key => ack.binding?.[key] === binding[key])) return "";
  const prompt = process.phase === "SENDING" ? process.pendingPrompt
    : process.lastPrompt?.transportKind === DELIVERY_CONTINUATION
      ? process.deliveryRetry?.rootPrompt : process.lastPrompt;
  if (!isInitializationPrompt(prompt) ||
      (prompt.transportId || prompt.a2a?.messageId) !== init.initializationId ||
      !String(prompt.text || "").includes(ack.hash)) return "";
  return ack.hash;
}

export function legacyInitializationUpgradeAllowed(process) {
  const init = process?.sessionInitialization;
  const source = process?.lastPrompt?.transportKind === DELIVERY_CONTINUATION
    ? process.deliveryRetry?.rootPrompt : process?.lastPrompt;
  const work = init?.workPrompt;
  return Boolean(!init?.acknowledgement && init?.sessionSeq === process?.sessionSeq &&
    isInitializationPrompt(source) && init?.initializationId &&
    (source.transportId || source.a2a?.messageId) === init.initializationId &&
    process.lastPrompt?.acknowledged === true && process.lastPrompt?.dispatchedUserTurnId &&
    !process.pendingPrompt && work?.text && work?.hash && !work.dispatch &&
    Number(work.sendAttempts || 0) === 0);
}

export function legacyToolForbiddenInitialization(process) {
  const init = process?.sessionInitialization;
  const source = init?.ackRepair?.sourcePrompt ||
    (process?.lastPrompt?.transportKind === DELIVERY_CONTINUATION ? process.deliveryRetry?.rootPrompt : process?.lastPrompt);
  return isInitializationPrompt(source) &&
    String(source.a2a?.instruction || "").startsWith("Session initialization only. Do not call tools or change any state.");
}

function initializationBrief(process, workPrompt) {
  // v2.0.0: the initialization turn no longer carries a copy of the FULL
  // operative contract (about 70k characters that the held work prompt sends
  // again one turn later). It carries only the identity, the mission and the
  // Greenfield progress state, so the receiving session knows what it is
  // bootstrapping for without reading the contract twice.
  const source = workPrompt?.a2a && typeof workPrompt.a2a === "object" ? workPrompt.a2a : {};
  const full = source.promptProfile?.profile === "FULL";
  const progress = source.progress && typeof source.progress === "object" ? source.progress : null;
  return {
    schema: source.schema,
    protocol: source.protocol,
    process: source.process,
    sender: source.sender ? {
      actor: source.sender.actor, applicationId: source.sender.applicationId,
      name: source.sender.name, version: source.sender.version, role: source.sender.role
    } : undefined,
    mission: full && source.mission ? source.mission : String(process?.goal || ""),
    progress: progress ? {
      schema: progress.schema,
      stages: progress.stages,
      currentStage: progress.currentStage,
      planRequired: progress.planRequired,
      acceptedEvidence: progress.acceptedEvidence,
      deadEnds: progress.deadEnds,
      knownLimitations: progress.knownLimitations,
      counters: progress.counters
    } : null
  };
}

export async function prepareSessionInitialization(process, workPrompt, page = {}, { acknowledgementOnly = false } = {}) {
  if (!workPrompt?.text || !workPrompt.hash || workPrompt.dispatch || Number(workPrompt.sendAttempts || 0)) {
    throw new Error("SESSION_INITIALIZATION_WORK_EFFECT_UNRESOLVED");
  }
  const messageId = randomId("a2a");
  const binding = initializationAckBinding(process, messageId, workPrompt);
  const ackHash = await sha256Hex(JSON.stringify(binding));
  // A receipt-only request cannot repair an instruction that prohibited the
  // bootstrap itself. Retry only its read-only initialization, never work.
  const bootstrapRepair = acknowledgementOnly && legacyToolForbiddenInitialization(process);
  acknowledgementOnly = acknowledgementOnly && !bootstrapRepair;
  const projectId = savedMissionProject(process.goal)?.projectId;
  const projectBound = Number.isSafeInteger(projectId) && projectId > 0;
  const opening = acknowledgementOnly
    ? `Session acknowledgement upgrade${projectBound ? ` for project ${projectId}` : ""}. The preceding initialization response has been observed. Do not repeat project opening or other tool actions. Confirm only if that initialization succeeded.`
    : `${bootstrapRepair ? "Correct the preceding tool-forbidden initialization instruction. " : ""}Initialize this EIC session using its required live bootstrap: getMe, global.get and the applicable current runtime/knowledge/skill payloads. Read-only bootstrap tools are allowed and required; respect current owner authority and report unavailable capabilities. ${projectBound ? `Open project ${projectId} for this session and read its current owner state.` : "Resolve the mission's project/owner from its explicit identity and current owner state; do not guess a project from unrelated body references."}`;
  const context = acknowledgementOnly ? "" : `\nSESSION BRIEF — mission identity and Greenfield progress state for this session:\n${JSON.stringify(initializationBrief(process, workPrompt))}\nEND SESSION BRIEF. The complete operating contract and response schema arrive with the first work prompt; do not pre-load or restate them now. For this initialization turn, perform only the read-only bootstrap above, plus reading the mission's latest checkpoint if it is cheap. Work-queue actions, operative objectives, learning writes and terminal controls are not authorized by this transport message; this turn uses the acknowledgement instruction below.\n`;
  const instruction = `${opening}${context} When initialization has succeeded, include this exact acknowledgement hash as a separate token in your final response: ${ackHash}. Preserve all 64 hexadecimal characters; surrounding text, Markdown and required status/project/time footers are allowed. If initialization is blocked or incomplete, omit the hash and explain the blocker without quoting this instruction. Do not start mission work or change project data. Await the next work prompt.`;
  const a2a = { messageId, messageType: SESSION_INITIALIZATION,
    instruction };
  const text = JSON.stringify(a2a);
  const pendingPrompt = { text, hash: await sha256Hex(normalizeText(text)), a2a,
    transportKind: SESSION_INITIALIZATION, transportId: messageId, baselineAssistantHash: page.assistantHash || "",
    createdAt: nowIso(), sendAttempts: 0, dispatch: null, promptPause: null, postDelaySeconds: 0,
    requiredConversationKey: conversationKey(page.url || "") };
  return { pendingPrompt, sessionInitialization: { initializationId: messageId,
    sessionSeq: process.sessionSeq, status: "PENDING", createdAt: nowIso(),
    bootstrapContract: acknowledgementOnly ? "ACK_ONLY" : "FULL_READ_ONLY_V1",
    bootstrapRepair,
    acknowledgement: { schema: "eic.greenfield.initialization-ack.v1", hash: ackHash, binding },
    conversationKey: conversationKey(page.url || ""), workPrompt,
    receipt: null, response: null } };
}

// Requires an acknowledged exact user turn and a proven conversation. The
// error banner is evidence about transport, not evidence about work effects.
export function deliveryContinuationEligibility(process, page) {
  const prompt = process?.lastPrompt;
  const key = conversationKey(page?.url || "");
  if (!key || key !== conversationKey(process?.lastManagedUrl || "") ||
      prompt?.conversationKey && prompt.conversationKey !== key) return "DELIVERY_CONVERSATION_UNPROVEN";
  // The rendered prompt may be collapsed, virtualized or decorated. Its
  // full-text hash is not a second turn identity. Require the acknowledged
  // exact latest user id AND the causal resolver, never a hash-only fallback.
  if (prompt?.acknowledged !== true || !prompt.hash || !prompt.dispatchedUserTurnId ||
      page?.lastUserId !== prompt.dispatchedUserTurnId ||
      !autonomousUserTurnProof(process, page, { allowLegacyHash: false }).ok) return "DELIVERY_SOURCE_TURN_UNPROVEN";
  if (process.pendingPrompt || process.storageRecoveryRequired || process.safety?.qualityIncident ||
      process.greenfieldControl?.hardStop) return "DELIVERY_EFFECT_UNRESOLVED";
  return "";
}

export function deliveryRetryForPrompt(process) {
  const retry = process?.deliveryRetry;
  const hash = workPromptHash(process);
  return retry?.rootPrompt?.hash === hash && retry.sessionSeq === process.sessionSeq ? retry : null;
}

export async function prepareDeliveryContinuation(process, page) {
  const source = structuredClone(process.lastPrompt);
  const prior = deliveryRetryForPrompt(process);
  const key = conversationKey(page.url);
  const attempts = Number(prior?.attempts || 0) + 1;
  if (attempts > DELIVERY_CONTINUATION_MAX_ATTEMPTS || prior?.status === "EXHAUSTED") {
    throw new Error("DELIVERY_CONTINUATION_LIMIT");
  }
  const text = "Fortsätt";
  const pendingPrompt = { text, hash: await sha256Hex(normalizeText(text)),
    transportKind: DELIVERY_CONTINUATION, transportId: randomId("short-continue"), a2a: source.a2a || null,
    baselineAssistantHash: page.assistantHash || "", createdAt: nowIso(),
    sendAttempts: 0, dispatch: null, promptPause: null, postDelaySeconds: 0,
    requiredConversationKey: key, sourceUserTurnId: source.dispatchedUserTurnId };
  return { pendingPrompt, deliveryRetry: { rootPrompt: prior?.rootPrompt || source,
    sourcePrompt: source, sessionSeq: process.sessionSeq, conversationKey: key,
    attempts, status: "PENDING", preparedAtMs: Date.now(), noticeFirstSeenAtMs: 0 } };
}

// The second short retry has identical text. The preceding "Fortsätt" turn
// can never be used as proof that this new dispatch materialized.
export function deliveryFencePage(pending, page) {
  if (pending?.transportKind !== DELIVERY_CONTINUATION ||
      page?.lastUserId !== pending.sourceUserTurnId) return page;
  return { ...page, lastUserHash: "", autonomousTurn: {
    ...(page.autonomousTurn || {}), userTextHash: "" } };
}
