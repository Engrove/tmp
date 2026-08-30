import { nowIso, nullableInteger, sanitizeText, sha256Hex, stableStringify } from "./common.mjs";

export const SESSION_CAPTURE_SCHEMA = "eic.autonom.session-capture.v1";
export const SESSION_TURN_SCHEMA = "eic.autonom.session-turn.v1";
export const CAPTURE_COMPLETENESS = Object.freeze({
  COMPLETE: "COMPLETE",
  PARTIAL: "PARTIAL",
  GAPPED: "GAPPED"
});

const ROLE_VALUES = new Set(["user", "assistant"]);

export function normalizeTranscriptText(value, max = 200000) {
  const normalized = sanitizeText(value, max);
  return normalized
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => !/^(?:Visa mindre|Visa mer|Show less|Show more|Kopiera kod|Copy code)$/iu.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanText(value, max = 200000) {
  return normalizeTranscriptText(value, max);
}

function safeLink(value) {
  try {
    const url = new URL(String(value || ""), "https://chatgpt.com/");
    if (!["https:", "http:"].includes(url.protocol)) return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export async function stableTurnIdentity({ conversationKey, role, sourceMessageId = "", text, ordinal = 0 } = {}) {
  const normalizedRole = ROLE_VALUES.has(String(role).toLowerCase()) ? String(role).toLowerCase() : "unknown";
  const stableSourceMessageId = cleanText(sourceMessageId, 1000);
  const source = stableStringify(stableSourceMessageId
    ? {
        conversationKey: cleanText(conversationKey, 1000),
        role: normalizedRole,
        sourceMessageId: stableSourceMessageId
      }
    : {
        conversationKey: cleanText(conversationKey, 1000),
        role: normalizedRole,
        ordinal: nullableInteger(ordinal, { min: 0 }) ?? 0,
        text: cleanText(text, 200000)
      });
  return `turn-${(await sha256Hex(source)).slice(0, 32)}`;
}

export async function normalizeCapturedTurn(message = {}, context = {}) {
  const role = String(message.role || "").toLowerCase();
  if (!ROLE_VALUES.has(role)) throw new Error("CAPTURE_ROLE_UNSUPPORTED");
  const text = cleanText(message.text, 200000);
  const sourceHash = await sha256Hex(stableStringify({
    role,
    text,
    links: message.links || [],
    attachments: message.attachments || [],
    reasoningSummary: message.reasoningSummary || ""
  }));
  const id = await stableTurnIdentity({
    conversationKey: context.conversationKey,
    role,
    sourceMessageId: message.sourceMessageId,
    text,
    ordinal: message.ordinal
  });
  return {
    schema: SESSION_TURN_SCHEMA,
    version: 1,
    id,
    captureId: context.captureId,
    conversationKey: cleanText(context.conversationKey, 1000),
    projectId: context.projectId ?? null,
    taskFingerprint: cleanText(context.taskFingerprint, 500),
    mandateVersion: cleanText(context.mandateVersion, 200),
    mandateSha256: cleanText(context.mandateSha256, 128),
    role,
    ordinal: Number(message.ordinal || 0),
    sourceMessageId: cleanText(message.sourceMessageId, 1000) || null,
    text,
    finalAnswer: role === "assistant" ? cleanText(message.finalAnswer || text, 200000) : null,
    reasoningSummary: role === "assistant" && message.reasoningSummaryVisible === true
      ? {
          visibility: "BROWSER_VISIBLE_SUMMARY",
          text: cleanText(message.reasoningSummary, 40000)
        }
      : null,
    links: [...new Set((message.links || []).map(safeLink).filter(Boolean))],
    attachments: (message.attachments || []).map((item) => ({
      referenceOnly: true,
      name: cleanText(item?.name, 1000),
      kind: cleanText(item?.kind || "attachment", 120),
      locator: cleanText(item?.locator, 1200) || null,
      bodyCaptured: false
    })),
    sourceHash,
    evidenceClass: "UNTRUSTED_TRANSCRIPT_DATA",
    authority: "NONE",
    capturedAt: context.capturedAt || nowIso(),
    updatedAt: context.capturedAt || nowIso()
  };
}

export async function buildSessionCapture({
  conversationKey,
  projectId = null,
  taskFingerprint,
  mandateVersion,
  mandateSha256,
  captureId,
  messages = [],
  gaps = [],
  mode = "FULL",
  priorCaptureId = null,
  capturedAt = nowIso()
} = {}) {
  const key = cleanText(conversationKey, 1000);
  const id = cleanText(captureId, 300) || `capture-${(await sha256Hex(`${key}:${capturedAt}`)).slice(0, 24)}`;
  const turns = [];
  for (let index = 0; index < messages.length; index += 1) {
    turns.push(await normalizeCapturedTurn({
      ...messages[index],
      ordinal: Number(messages[index]?.ordinal ?? index)
    }, {
      captureId: id,
      conversationKey: key,
      projectId,
      taskFingerprint,
      mandateVersion,
      mandateSha256,
      capturedAt
    }));
  }
  const deduped = [...new Map(turns.map((turn) => [turn.id, turn])).values()]
    .sort((a, b) => a.ordinal - b.ordinal);
  const gapList = (gaps || []).map((gap) => ({
    startOrdinal: Number(gap?.startOrdinal ?? -1),
    endOrdinal: Number(gap?.endOrdinal ?? -1),
    reason: cleanText(gap?.reason || "UNKNOWN_GAP", 500)
  }));
  const completeness = gapList.length
    ? CAPTURE_COMPLETENESS.GAPPED
    : deduped.length === messages.length
      ? CAPTURE_COMPLETENESS.COMPLETE
      : CAPTURE_COMPLETENESS.PARTIAL;
  const chainHash = await sha256Hex(deduped.map((turn) => `${turn.id}:${turn.sourceHash}`).join("\n"));
  return {
    capture: {
      schema: SESSION_CAPTURE_SCHEMA,
      version: 1,
      id,
      captureId: id,
      conversationKey: key,
      projectId,
      taskFingerprint: cleanText(taskFingerprint, 500),
      mandateVersion: cleanText(mandateVersion, 200),
      mandateSha256: cleanText(mandateSha256, 128),
      mode: String(mode).toUpperCase() === "DELTA" ? "DELTA" : "FULL",
      priorCaptureId: cleanText(priorCaptureId, 300) || null,
      turnIds: deduped.map((turn) => turn.id),
      sourceChainHash: chainHash,
      completeness,
      gaps: gapList,
      untrustedTranscript: true,
      authority: "NONE",
      capturedAt,
      createdAt: capturedAt,
      updatedAt: capturedAt
    },
    turns: deduped
  };
}

export async function createDeltaCapture(prior, nextInput = {}) {
  const priorTurns = Array.isArray(prior?.turns) ? prior.turns : [];
  const result = await buildSessionCapture({
    ...nextInput,
    mode: "DELTA",
    priorCaptureId: prior?.capture?.id || null
  });
  const knownPairs = new Set(priorTurns.map((turn) => `${turn.id}:${turn.sourceHash}`));
  const deltaTurns = result.turns.filter((turn) => !knownPairs.has(`${turn.id}:${turn.sourceHash}`));
  const merged = new Map(priorTurns.map((turn) => [turn.id, turn]));
  for (const turn of result.turns) {
    const existing = merged.get(turn.id);
    if (!existing || existing.sourceHash !== turn.sourceHash) merged.set(turn.id, turn);
  }
  const cumulativeTurns = [...merged.values()].sort((a, b) => {
    const ordinalDelta = Number(a.ordinal || 0) - Number(b.ordinal || 0);
    return ordinalDelta || String(a.id).localeCompare(String(b.id));
  });
  result.turns = cumulativeTurns;
  result.capture.turnIds = cumulativeTurns.map((turn) => turn.id);
  result.capture.deltaTurnIds = deltaTurns.map((turn) => turn.id);
  result.capture.sourceChainHash = await sha256Hex(
    cumulativeTurns.map((turn) => `${turn.id}:${turn.sourceHash}`).join("\n")
  );
  const priorGaps = Array.isArray(prior?.capture?.gaps) ? prior.capture.gaps : [];
  const gapKey = (gap) => `${gap.startOrdinal}:${gap.endOrdinal}:${gap.reason}`;
  result.capture.gaps = [...new Map(
    [...priorGaps, ...(result.capture.gaps || [])].map((gap) => [gapKey(gap), gap])
  ).values()];
  result.capture.completeness = result.capture.gaps.length
    ? CAPTURE_COMPLETENESS.GAPPED
    : result.capture.completeness;
  result.capture.cumulative = true;
  return result;
}

export async function reconcileMonotonicCapture(prior, next) {
  if (!prior?.capture || !next?.capture) return next;
  const sameConversation = prior.capture.conversationKey === next.capture.conversationKey;
  const sameTask = prior.capture.taskFingerprint === next.capture.taskFingerprint;
  if (!sameConversation || !sameTask) return next;
  const priorTurns = Array.isArray(prior.turns) ? prior.turns : [];
  const nextTurns = Array.isArray(next.turns) ? next.turns : [];
  const merged = new Map(priorTurns.map((turn) => [turn.id, turn]));
  for (const turn of nextTurns) {
    const current = merged.get(turn.id);
    if (!current || current.sourceHash !== turn.sourceHash) merged.set(turn.id, turn);
  }
  next.turns = [...merged.values()].sort((a, b) => {
    const ordinalDelta = Number(a.ordinal || 0) - Number(b.ordinal || 0);
    return ordinalDelta || String(a.id).localeCompare(String(b.id));
  });
  next.capture.turnIds = next.turns.map((turn) => turn.id);
  next.capture.sourceChainHash = await sha256Hex(
    next.turns.map((turn) => `${turn.id}:${turn.sourceHash}`).join("\n")
  );
  next.capture.reconciledPriorTurnCount = priorTurns.length;
  next.capture.monotonic = next.turns.length >= priorTurns.length;
  return next;
}

export function inferTargetProjectBinding(messages = [], controlProjectId = null) {
  const candidates = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const text = String(message?.text || "");
    for (const pattern of [
      /(?:Core\s+)?project\s+ID\s*[:#]?\s*(\d+)/giu,
      /projekt(?:ets)?\s+ID\s*[:#]?\s*(\d+)/giu
    ]) {
      let match;
      while ((match = pattern.exec(text))) {
        const projectId = Number(match[1]);
        if (Number.isInteger(projectId) && projectId > 0) candidates.push(projectId);
      }
    }
  }
  const frequency = new Map();
  for (const projectId of candidates) frequency.set(projectId, (frequency.get(projectId) || 0) + 1);
  const selected = [...frequency.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] || null;
  const control = Number(controlProjectId);
  return {
    schema: "eic.autonom.target-project-binding.v1",
    projectId: selected,
    source: selected ? "TRANSCRIPT_EXPLICIT_PROJECT_ID" : "UNRESOLVED",
    confidence: selected ? "HIGH" : "NONE",
    mismatch: Boolean(selected && Number.isInteger(control) && control > 0 && selected !== control),
    controlProjectId: Number.isInteger(control) && control > 0 ? control : null,
    candidateCounts: Object.fromEntries(frequency)
  };
}

function readVisibleMessageNode(node, ordinal) {
  const role = String(node.getAttribute?.("data-message-author-role") || "").toLowerCase();
  if (!ROLE_VALUES.has(role)) return null;
  const text = cleanText(node.innerText || node.textContent || "", 200000);
  const links = [...(node.querySelectorAll?.("a[href]") || [])].map((a) => a.href);
  const attachments = [...(node.querySelectorAll?.("[data-testid*='attachment' i], [aria-label*='attachment' i]") || [])]
    .map((item) => ({
      name: item.getAttribute?.("aria-label") || item.textContent || "attachment",
      kind: "browser-reference",
      locator: item.getAttribute?.("data-testid") || null
    }));
  const reasoning = node.querySelector?.("[data-testid*='reasoning' i], [aria-label*='reasoning' i]");
  return {
    role,
    ordinal,
    sourceMessageId: node.getAttribute?.("data-message-id") || node.id || "",
    text,
    finalAnswer: text,
    reasoningSummaryVisible: Boolean(reasoning),
    reasoningSummary: reasoning?.innerText || reasoning?.textContent || "",
    links,
    attachments
  };
}

export function extractVisibleTranscript(documentLike) {
  const nodes = [...(documentLike?.querySelectorAll?.("[data-message-author-role]") || [])];
  return nodes.map(readVisibleMessageNode).filter(Boolean);
}

export async function sweepVirtualizedTranscript({
  adapter,
  maxSweeps = 80,
  stableSweepsRequired = 2
} = {}) {
  if (!adapter?.readVisibleMessages || !adapter?.getScrollState || !adapter?.scrollTo) {
    throw new Error("CAPTURE_ADAPTER_INVALID");
  }
  const initial = await adapter.getScrollState();
  const merged = new Map();
  let stable = 0;
  let priorCount = 0;
  let reachedTop = false;
  let reachedBottom = false;
  try {
    await adapter.scrollTo("TOP");
    for (let sweep = 0; sweep < maxSweeps; sweep += 1) {
      const visible = await adapter.readVisibleMessages();
      for (const message of visible) {
        const key = message.sourceMessageId ||
          `${message.role}:${nullableInteger(message.ordinal, { min: 0 }) ?? 0}:${cleanText(message.text, 200000)}`;
        merged.set(key, message);
      }
      const scroll = await adapter.getScrollState();
      reachedTop ||= Boolean(scroll.atTop);
      reachedBottom ||= Boolean(scroll.atBottom);
      stable = merged.size === priorCount ? stable + 1 : 0;
      priorCount = merged.size;
      if (reachedBottom && stable >= stableSweepsRequired) break;
      await adapter.scrollTo("NEXT");
    }
  } finally {
    await adapter.restoreScroll(initial);
  }
  const messages = [...merged.values()].sort((a, b) => Number(a.ordinal || 0) - Number(b.ordinal || 0));
  const gaps = [];
  if (!reachedTop) gaps.push({ startOrdinal: -1, endOrdinal: messages[0]?.ordinal ?? -1, reason: "TOP_NOT_VERIFIED" });
  if (!reachedBottom) gaps.push({ startOrdinal: messages.at(-1)?.ordinal ?? -1, endOrdinal: -1, reason: "BOTTOM_NOT_VERIFIED" });
  for (let i = 1; i < messages.length; i += 1) {
    const prior = Number(messages[i - 1].ordinal);
    const current = Number(messages[i].ordinal);
    if (Number.isFinite(prior) && Number.isFinite(current) && current - prior > 1) {
      gaps.push({ startOrdinal: prior + 1, endOrdinal: current - 1, reason: "VIRTUALIZED_TURN_GAP" });
    }
  }
  return { messages, gaps, scrollRestored: true, reachedTop, reachedBottom };
}

export function captureRefreshRequired({
  memory,
  conversationKey,
  branchKey,
  taskFingerprint,
  gaps = [],
  requested = false,
  priorCapture = null
} = {}) {
  if (requested) return { required: true, reason: "USER_REQUESTED_REFRESH" };
  if (!memory) return { required: true, reason: "NO_VALID_SESSION_MEMORY" };
  if (memory.conversationKey !== conversationKey) return { required: true, reason: "CONVERSATION_KEY_CHANGED" };
  if (memory.branchKey && branchKey && memory.branchKey !== branchKey) return { required: true, reason: "BRANCH_CHANGED" };
  if (memory.taskFingerprint !== taskFingerprint) return { required: true, reason: "TASK_FINGERPRINT_MISMATCH" };
  if (gaps.length) {
    const gapKey = (gap) => `${Number(gap?.startOrdinal ?? -1)}:${Number(gap?.endOrdinal ?? -1)}:${cleanText(gap?.reason, 200)}`;
    const currentGapSet = new Set(gaps.map(gapKey));
    const priorGapSet = new Set((priorCapture?.gaps || []).map(gapKey));
    const sameKnownGapBaseline = currentGapSet.size === priorGapSet.size &&
      [...currentGapSet].every((key) => priorGapSet.has(key));
    if (!sameKnownGapBaseline) return { required: true, reason: "CAPTURE_GAPS_CHANGED" };
    return { required: false, reason: "DELTA_FROM_STABLE_GAPPED_BASELINE" };
  }
  return { required: false, reason: "DELTA_CAPTURE_SUFFICIENT" };
}
