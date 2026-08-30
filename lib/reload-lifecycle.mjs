import { nullableInteger, sanitizeText } from "./common.mjs";

export const RELOAD_READBACK_SCHEMA = "eic.autonom.reload-readback-expectation.v1";

function safeOrigin(url) {
  try {
    return new URL(String(url || "")).origin;
  } catch {
    return "";
  }
}

function text(value, max = 1200) {
  return sanitizeText(value || "", max);
}

export function createReloadReadbackExpectation({
  tabId,
  selectedTabId,
  linkedTab,
  tab,
  page,
  expectedContentVersion
} = {}) {
  const expectedTabId = nullableInteger(tabId);
  if (expectedTabId === null ||
      nullableInteger(selectedTabId) !== expectedTabId ||
      nullableInteger(linkedTab?.tabId) !== expectedTabId ||
      nullableInteger(tab?.id) !== expectedTabId) {
    throw new Error("RELOAD_TARGET_NOT_SELECTED_LINKED");
  }
  const origin = safeOrigin(page?.url || tab?.url);
  const conversationKey = text(page?.conversationKey, 1200);
  const documentEpoch = text(page?.documentEpoch, 240);
  const contentVersion = text(page?.version, 80);
  if (!origin || !conversationKey || !documentEpoch) {
    throw new Error("RELOAD_PRESTATE_IDENTITY_INCOMPLETE");
  }
  if (expectedContentVersion && contentVersion !== text(expectedContentVersion, 80)) {
    throw new Error("RELOAD_PRESTATE_BRIDGE_VERSION_MISMATCH");
  }
  return {
    schema: RELOAD_READBACK_SCHEMA,
    tabId: expectedTabId,
    origin,
    conversationKey,
    documentEpoch,
    contentVersion,
    createdAt: new Date().toISOString()
  };
}

export const HARD_RELOAD_MODE = "HARD_BYPASS_CACHE";
export const HARD_RELOAD_READBACK_TTL_MS = 60_000;

export function createHardReloadReadbackExpectation(args = {}) {
  const nowMs = Number.isFinite(Number(args?.nowMs)) ? Number(args.nowMs) : Date.now();
  return {
    ...createReloadReadbackExpectation(args),
    reloadMode: HARD_RELOAD_MODE,
    bypassCache: true,
    readbackDeadlineAt: new Date(nowMs + HARD_RELOAD_READBACK_TTL_MS).toISOString()
  };
}

export function evaluateHardReloadSelectedTabReadback(expectation, args = {}) {
  const base = evaluateReloadSelectedTabReadback(expectation, args);
  const reasons = [...base.reasons];
  if (expectation?.reloadMode !== HARD_RELOAD_MODE || expectation?.bypassCache !== true) {
    reasons.push("HARD_RELOAD_DISPATCH_EXPECTATION_MISSING");
  }
  const deadlineMs = Date.parse(String(expectation?.readbackDeadlineAt || ""));
  const nowMs = Number.isFinite(Number(args?.nowMs)) ? Number(args.nowMs) : Date.now();
  if (!Number.isFinite(deadlineMs)) {
    reasons.push("HARD_RELOAD_READBACK_DEADLINE_MISSING");
  } else if (nowMs > deadlineMs) {
    reasons.push("HARD_RELOAD_READBACK_TTL_EXPIRED");
  }
  const uniqueReasons = [...new Set(reasons)];
  return {
    match: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    evidence: [
      base.evidence,
      `reloadMode=${text(expectation?.reloadMode, 80) || "UNKNOWN"}`,
      `bypassCache=${String(expectation?.bypassCache === true)}`,
      `readbackDeadlineAt=${text(expectation?.readbackDeadlineAt, 80) || "UNKNOWN"}`,
      `hardResult=${uniqueReasons.length ? uniqueReasons.join(",") : "MATCH"}`
    ].join(";")
  };
}

export function evaluateReloadSelectedTabReadback(expectation, {
  selectedTabId,
  linkedTab,
  controllerSurface,
  tab,
  page,
  expectedContentVersion
} = {}) {
  const reasons = [];
  const expected = expectation?.schema === RELOAD_READBACK_SCHEMA ? expectation : null;
  if (!expected) {
    return {
      match: false,
      reasons: ["RELOAD_EXPECTATION_MISSING"],
      evidence: "reloadExpectation=MISSING"
    };
  }

  const expectedTabId = nullableInteger(expected.tabId);
  const observedPageOrigin = safeOrigin(page?.url);
  const observedTabOrigin = safeOrigin(tab?.url);
  const observedBridge = text(page?.version, 80);
  const requiredBridge = text(expectedContentVersion || expected.contentVersion, 80);
  const observedEpoch = text(page?.documentEpoch, 240);
  const observedConversation = text(page?.conversationKey, 1200);

  if (Number(tab?.id) !== expectedTabId) reasons.push("TAB_ID_MISMATCH");
  if (nullableInteger(selectedTabId) !== expectedTabId) reasons.push("SELECTED_TAB_CHANGED");
  if (nullableInteger(linkedTab?.tabId) !== expectedTabId) reasons.push("LINKED_TAB_MISSING_OR_CHANGED");
  if (nullableInteger(controllerSurface?.tabId) !== expectedTabId) reasons.push("CONTROLLER_SURFACE_TAB_MISMATCH");
  if (tab?.status !== "complete") reasons.push("TAB_NOT_COMPLETE");
  if (page?.supported !== true) reasons.push("PAGE_NOT_SUPPORTED");
  if (!observedPageOrigin || observedPageOrigin !== expected.origin ||
      !observedTabOrigin || observedTabOrigin !== expected.origin ||
      text(linkedTab?.url, 4000) && safeOrigin(linkedTab?.url) !== expected.origin ||
      text(controllerSurface?.origin, 4000) !== expected.origin) {
    reasons.push("ORIGIN_MISMATCH");
  }
  if (!observedConversation || observedConversation !== expected.conversationKey ||
      text(linkedTab?.conversationKey, 1200) !== expected.conversationKey ||
      text(controllerSurface?.conversationKey, 1200) !== expected.conversationKey) {
    reasons.push("CONVERSATION_MISMATCH");
  }
  if (!observedEpoch || observedEpoch === text(expected.documentEpoch, 240)) {
    reasons.push("DOCUMENT_EPOCH_NOT_ROTATED");
  }
  if (text(linkedTab?.documentEpoch, 240) !== observedEpoch ||
      text(controllerSurface?.documentEpoch, 240) !== observedEpoch) {
    reasons.push("RUNTIME_EPOCH_NOT_RECONCILED");
  }
  if (!requiredBridge || observedBridge !== requiredBridge) {
    reasons.push("CONTENT_BRIDGE_VERSION_MISMATCH");
  }

  const uniqueReasons = [...new Set(reasons)];
  return {
    match: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    evidence: [
      `tab=${Number(tab?.id) || "UNKNOWN"}`,
      `selected=${nullableInteger(selectedTabId) ?? "UNKNOWN"}`,
      `linked=${nullableInteger(linkedTab?.tabId) ?? "UNKNOWN"}`,
      `origin=${observedPageOrigin || "UNKNOWN"}`,
      `conversation=${observedConversation || "UNKNOWN"}`,
      `documentEpochBefore=${text(expected.documentEpoch, 240) || "UNKNOWN"}`,
      `documentEpochAfter=${observedEpoch || "UNKNOWN"}`,
      `content=${observedBridge || "UNKNOWN"}`,
      `status=${tab?.status || "UNKNOWN"}`,
      `result=${uniqueReasons.length ? uniqueReasons.join(",") : "MATCH"}`
    ].join(";")
  };
}
