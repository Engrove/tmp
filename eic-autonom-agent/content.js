(() => {
  "use strict";

  const VERSION = "0.10.10";
  const MAX_PROMPT_CHARS = 160_000;
  const MAX_ATTACHMENT_BYTES = 4_000_000;
  const ALLOWED_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);
  const BRIDGE_KEY = "__EIC_AUTONOM_AGENT_BRIDGE_V5__";
  const DOCUMENT_EPOCH = crypto.randomUUID();

  const previous = globalThis[BRIDGE_KEY];
  try {
    previous?.dispose?.();
  } catch {
    // En gammal eller invaliderad bridge får aldrig blockera en ny bridge.
  }

  let disposed = false;
  let observer = null;
  let dirtyTimer = null;
  let badge = null;
  let processOverlay = null;
  let currentOverlayNeedKey = "";
  let currentLinkStatus = "DISCONNECTED";
  const rememberedUserTurnIds = new Set();
  const rememberedUserMessageHashes = new Set();
  let activeCaptureRequestId = "";
  const cancelledCaptureRequestIds = new Set();

  function isSupportedPage() {
    return location.protocol === "https:" && ALLOWED_HOSTS.has(location.hostname);
  }

  function firstVisible(selectors) {
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (rect.width > 0 && rect.height > 0 &&
            style.visibility !== "hidden" && style.display !== "none") {
          return element;
        }
      }
    }
    return null;
  }

  function getComposer() {
    return firstVisible([
      "#prompt-textarea",
      "textarea[data-id='root']",
      "form textarea",
      "div[contenteditable='true'][data-lexical-editor='true']",
      "div[contenteditable='true'][role='textbox']"
    ]);
  }

  function getSendButton() {
    return firstVisible([
      "button[data-testid='send-button']",
      "form button[type='submit']",
      "button[aria-label='Send prompt']",
      "button[aria-label='Skicka prompt']",
      "button[aria-label*='Send']",
      "button[aria-label*='Skicka']"
    ]);
  }

  function getStopButton() {
    const selectors = [
      "button[data-testid='stop-button']",
      "button[aria-label='Stop generating']",
      "button[aria-label='Avbryt generering']"
    ];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (!isVisibleElement(element)) continue;
        if (element.closest("[data-message-author-role], [data-eic-own-ui='true']")) continue;
        if (element.getAttribute("aria-hidden") === "true" || element.closest("[aria-hidden='true'], [inert]")) continue;
        if (element.disabled || element.getAttribute("aria-disabled") === "true") continue;
        const composerRegion = element.closest("form, [data-testid*='composer' i], [data-testid*='prompt' i]");
        if (composerRegion || element.closest("main")) return element;
      }
    }
    return null;
  }

  function getLatestAssistantNode() {
    return messageNodes("assistant").at(-1) || null;
  }

  function stripProtocolNoise(value) {
    return String(value ?? "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/(?:^|\n)(?: {4}|\t).*/g, "")
      .replace(/`[^`\n]*`/g, "")
      .split("\n")
      .filter((line) => !/^\s*>/.test(line))
      .join("\n");
  }

  function hasTerminalEicTrailer(value) {
    const lines = stripProtocolNoise(value)
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-30);
    const patterns = [
      /^EIC_TURN:\s*(.+)$/i,
      /^EIC_NEXT:\s*(.*)$/i,
      /^EIC_COMPLETION_EVIDENCE:\s*(.*)$/i,
      /^EIC_NEXT_ACTOR:\s*(AGENT|OPERATOR_ACTION|OPERATOR_DECISION|EXTERNAL_SYSTEM|NONE)$/i,
      /^EIC_AUTONOMY:\s*(CONTINUE|OPERATOR_ACTION_REQUIRED|USER_PAUSE|DONE)$/i
    ];
    const markerCounts = [
      /^EIC_TURN:\s*/i,
      /^EIC_NEXT:\s*/i,
      /^EIC_COMPLETION_EVIDENCE:\s*/i,
      /^EIC_NEXT_ACTOR:\s*/i,
      /^EIC_AUTONOMY:\s*/i
    ].map((pattern) => lines.filter((line) => pattern.test(line)).length);
    if (markerCounts.some((count) => count !== 1)) return false;

    const candidates = [];
    for (let index = 0; index <= lines.length - patterns.length; index += 1) {
      const block = lines.slice(index, index + patterns.length);
      if (block.every((line, patternIndex) => patterns[patternIndex].test(line))) {
        candidates.push(block);
      }
    }
    if (candidates.length !== 1) return false;

    const trailer = candidates[0];
    const nextRaw = trailer[1].replace(/^EIC_NEXT:\s*/i, "").trim();
    const evidenceRaw = trailer[2].replace(/^EIC_COMPLETION_EVIDENCE:\s*/i, "").trim();
    const actor = trailer[3].match(/(AGENT|OPERATOR_ACTION|OPERATOR_DECISION|EXTERNAL_SYSTEM|NONE)$/i)?.[1]?.toUpperCase();
    const status = trailer[4].match(/(CONTINUE|OPERATOR_ACTION_REQUIRED|USER_PAUSE|DONE)$/i)?.[1]?.toUpperCase();
    const next = Boolean(nextRaw && !/^NONE$/i.test(nextRaw));
    const evidence = /^(UNIT_DONE|MILESTONE_CONTINUE|PROGRAM_BLOCKED|PROGRAM_DONE)\s*·\s*\S/i.test(evidenceRaw);
    if (!evidence) return false;
    if (status === "CONTINUE") return Boolean(next && actor !== "NONE");
    if (status === "OPERATOR_ACTION_REQUIRED") return Boolean(next && actor === "OPERATOR_ACTION");
    if (status === "USER_PAUSE") return Boolean(next && actor === "OPERATOR_DECISION");
    if (status === "DONE") return Boolean(!next && actor === "NONE" && /^PROGRAM_DONE\s*·/i.test(evidenceRaw));
    return false;
  }

  function detectForegroundSignals(latestAssistant = "", latestMessageRole = "unknown") {
    const stopButton = getStopButton();
    const latestNode = getLatestAssistantNode();
    const streamingAssistant = Boolean(latestMessageRole === "assistant" && latestNode && (
      latestNode.matches("[data-is-streaming='true'], [aria-busy='true'], .result-streaming") ||
      latestNode.querySelector("[data-is-streaming='true'], [aria-busy='true'], .result-streaming, [data-testid*='streaming' i]")
    ));
    const composer = getComposer();
    const composerBusy = Boolean(composer && (
      composer.getAttribute("aria-busy") === "true" ||
      composer.getAttribute("aria-disabled") === "true" ||
      composer.hasAttribute("disabled")
    ));
    const protocolCompletionCandidate = hasTerminalEicTrailer(latestAssistant);
    const protocolCompletionOverride = Boolean(
      protocolCompletionCandidate && !streamingAssistant && !composerBusy
    );
    const hardActive = streamingAssistant;
    const softActive = Boolean(stopButton || composerBusy);
    const dynamicCompletionCandidate = Boolean(
      latestMessageRole === "assistant" &&
      latestAssistant.trim() &&
      !streamingAssistant
    );
    const active = Boolean(hardActive || softActive) && !protocolCompletionOverride;
    const evidenceCodes = [];
    if (stopButton) evidenceCodes.push("VISIBLE_SCOPED_STOP_CONTROL");
    if (streamingAssistant) evidenceCodes.push("ASSISTANT_STREAMING_MARKER");
    if (composerBusy) evidenceCodes.push("COMPOSER_BUSY");
    if (dynamicCompletionCandidate) evidenceCodes.push("LATEST_ASSISTANT_HASH_CANDIDATE");
    if (protocolCompletionCandidate) evidenceCodes.push("TERMINAL_EIC_TRAILER");
    if (protocolCompletionOverride) evidenceCodes.push("PROTOCOL_COMPLETION_OVERRIDE");
    return {
      sourceClass: "TRUSTED_PAGE_CHROME",
      trusted: true,
      active,
      hardActive,
      softActive,
      stopControlVisible: Boolean(stopButton),
      streamingAssistant,
      composerBusy,
      dynamicCompletionCandidate,
      protocolCompletionCandidate,
      protocolCompletionOverride,
      evidenceCodes
    };
  }

  function messageNodes(role) {
    return [...document.querySelectorAll(`[data-message-author-role='${role}']`)];
  }

  function normalizeMessageText(value) {
    return String(value || "")
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => !/^(?:Visa mindre|Visa mer|Show less|Show more|Kopiera kod|Copy code)$/iu.test(line.trim()))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function messageText(node) {
    if (!node) return "";
    const clone = node.cloneNode?.(true);
    if (clone?.querySelectorAll) {
      for (const control of clone.querySelectorAll(
        "[data-eic-own-ui], button, script, style, [data-testid*='copy' i], [aria-label*='copy' i]"
      )) {
        control.remove();
      }
    }
    return normalizeMessageText(clone?.textContent || node.textContent || node.innerText || "");
  }

  function getAssistantMessages() {
    return messageNodes("assistant").map(messageText).filter(Boolean);
  }

  function getUserMessages() {
    return messageNodes("user").map(messageText).filter(Boolean);
  }

  function getLatestConversationMessage() {
    const nodes = [...document.querySelectorAll("[data-message-author-role]")]
      .filter((node) => {
        const role = node.getAttribute("data-message-author-role");
        return (role === "assistant" || role === "user") && Boolean(messageText(node));
      });
    const node = nodes.at(-1) || null;
    return {
      node,
      role: node?.getAttribute("data-message-author-role") || "unknown",
      text: messageText(node)
    };
  }

  function getConversationMessages(limit = 10) {
    return [...document.querySelectorAll("[data-message-author-role]")]
      .map((node) => ({
        role: node.getAttribute("data-message-author-role") || "unknown",
        text: headTailText(messageText(node), 4000)
      }))
      .filter((item) => item.text)
      .slice(-limit);
  }

  function headTailText(value, maxLength = 16_000) {
    const text = String(value ?? "").trim();
    if (text.length <= maxLength) return text;
    const marker = "\n\n[… middle omitted by deterministic head-tail compaction …]\n\n";
    const available = Math.max(0, maxLength - marker.length);
    const head = Math.floor(available * 0.42);
    return `${text.slice(0, head)}${marker}${text.slice(-(available - head))}`;
  }

  function buildConversationExcerpt(messages) {
    return headTailText(
      messages.map((item) => `${item.role.toUpperCase()}: ${item.text}`).join("\n\n"),
      18_000
    );
  }

  function conversationKeyFromHref(href = location.href) {
    try {
      const parsed = new URL(String(href), location.origin);
      // Custom GPT conversation URLs use /g/<gpt-id>/c/<conversation-id>.
      // The conversation id is the exact session locator and must win.
      const conversation = parsed.pathname.match(/\/c\/([^/?#]+)/i);
      if (conversation) return `${parsed.hostname}:c:${conversation[1]}`;
      const gpt = parsed.pathname.match(/\/g\/([^/?#]+)/i);
      if (gpt) return `${parsed.hostname}:g:${gpt[1]}`;
      const path = parsed.pathname.replace(/\/+$/, "") || "/";
      return `${parsed.hostname}:${path}${parsed.search}`;
    } catch {
      return "";
    }
  }

  function conversationKey() {
    return conversationKeyFromHref(location.href);
  }

  async function sha256(text) {
    const bytes = new TextEncoder().encode(String(text ?? ""));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  }

  async function settleDom() {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.resolve();
  }


  function detectBoundarySignals() {
    const captcha = Boolean(document.querySelector([
      "iframe[src*='captcha' i]",
      "iframe[src*='recaptcha' i]",
      "iframe[src*='hcaptcha' i]",
      "[data-testid*='captcha' i]",
      "[id*='captcha' i]"
    ].join(",")));
    const authControl = firstVisible([
      "a[href*='/auth/login']",
      "a[href*='/login']",
      "button[data-testid*='login' i]",
      "button[aria-label*='Log in' i]",
      "button[aria-label*='Sign in' i]",
      "button[aria-label*='Logga in' i]"
    ]);
    return {
      captcha,
      authenticationRequired: Boolean(authControl) && !getComposer()
    };
  }


  function normalizeUiText(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .toLocaleLowerCase("sv")
      .replace(/[’‘`´]/g, "'")
      .replace(/[^\p{L}\p{N}\s'/-]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function foldedUiText(value) {
    return normalizeUiText(value).normalize("NFD").replace(/\p{M}+/gu, "");
  }

  function isVisibleElement(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 &&
      style.display !== "none" && style.visibility !== "hidden";
  }

  function outsideConversationMessage(element) {
    return !element.closest("[data-message-author-role]") &&
      !element.closest("[data-eic-own-ui='true']");
  }

  function extractUserTurnIds(messages, maxItems = 128) {
    for (const value of Array.isArray(messages) ? messages : []) {
      for (const match of String(value ?? "").matchAll(/(?:^|\n)\s*EIC_TURN(?:_ID)?:\s*([^\s<>"']+)/gim)) {
        const id = String(match[1] || "").trim().slice(0, 180);
        if (id) rememberedUserTurnIds.add(id);
      }
    }
    const ids = [...rememberedUserTurnIds];
    if (ids.length > maxItems) {
      for (const id of ids.slice(0, ids.length - maxItems)) rememberedUserTurnIds.delete(id);
    }
    return [...rememberedUserTurnIds].slice(-maxItems);
  }

  async function extractUserMessageHashes(messages, maxItems = 128) {
    for (const value of Array.isArray(messages) ? messages : []) {
      const normalized = String(value ?? "").trim();
      if (!normalized) continue;
      rememberedUserMessageHashes.add(await sha256(normalized));
    }
    const hashes = [...rememberedUserMessageHashes];
    if (hashes.length > maxItems) {
      for (const hash of hashes.slice(0, hashes.length - maxItems)) rememberedUserMessageHashes.delete(hash);
    }
    return [...rememberedUserMessageHashes].slice(-maxItems);
  }

  function detectBackgroundSignals() {
    const statusSelectors = [
      "[role='status']",
      "[role='progressbar']",
      "[aria-live='polite']",
      "[aria-live='assertive']",
      "[data-testid*='background' i]",
      "[data-testid*='progress' i]",
      "[data-testid*='task' i]",
      "[data-testid*='research' i]",
      "[data-testid*='agent' i]"
    ];
    const roots = [...new Set(statusSelectors.flatMap((selector) =>
      [...document.querySelectorAll(selector)]
        .filter((element) => isVisibleElement(element) && outsideConversationMessage(element))
    ))].slice(0, 30);

    const buttons = [...document.querySelectorAll("button")]
      .filter((button) => isVisibleElement(button) && outsideConversationMessage(button))
      .slice(0, 160);
    const buttonLabels = buttons.map((button) => foldedUiText(
      `${button.getAttribute("aria-label") || ""} ${button.innerText || button.textContent || ""}`
    ));
    const hasCancel = buttonLabels.some((text) =>
      /(?:^|\s)(cancel|avbryt)(?:\s|$)/.test(text)
    );
    const hasHide = buttonLabels.some((text) =>
      /(?:^|\s)(hide|dolj)(?:\s|$)/.test(text)
    );

    const statusText = roots
      .map((element) => element.innerText || element.textContent || element.getAttribute("aria-label") || "")
      .join(" ")
      .slice(0, 8000);
    const folded = foldedUiText(statusText);
    const swedish = [
      "jag jobbar pa din forfragan",
      "under tiden kan du fortsatta chatta",
      "arbetar i bakgrunden",
      "behover mer tid"
    ].some((phrase) => folded.includes(phrase));
    const english = [
      "i'm working on your request",
      "im working on your request",
      "you can continue chatting",
      "working in the background",
      "needs more time"
    ].some((phrase) => folded.includes(phrase));
    const hasProgressSemantics = roots.some((element) =>
      element.getAttribute("role") === "progressbar" ||
      element.matches("[data-testid*='progress' i], [data-testid*='background' i], [data-testid*='task' i]") ||
      Boolean(element.querySelector("[role='progressbar'], svg[aria-label*='progress' i], [class*='spinner' i]"))
    );
    const hasStructuredStatus = roots.some((element) =>
      ["status", "progressbar"].includes(element.getAttribute("role")) ||
      element.hasAttribute("aria-live") ||
      [...element.attributes].some((attribute) =>
        attribute.name.startsWith("data-") &&
        /background|progress|task|research|agent/i.test(attribute.value)
      )
    );
    const textSignal = swedish || english;
    const controlPair = hasCancel && hasHide;
    const trusted = hasStructuredStatus && textSignal && (controlPair || hasProgressSemantics);
    const evidenceCodes = [];
    if (hasStructuredStatus) evidenceCodes.push("STRUCTURED_STATUS");
    if (hasProgressSemantics) evidenceCodes.push("PROGRESS_SEMANTICS");
    if (controlPair) evidenceCodes.push("CANCEL_HIDE_PAIR");
    if (swedish) evidenceCodes.push("SV_BACKGROUND_TEXT");
    if (english) evidenceCodes.push("EN_BACKGROUND_TEXT");

    const cancelled = trusted && /\b(cancelled|canceled|avbruten|avbrutet)\b/.test(folded);
    const error = trusted && /\b(error|fel|failed|misslyckades)\b/.test(folded);

    return {
      sourceClass: "TRUSTED_PAGE_CHROME",
      trusted,
      active: trusted && !cancelled && !error,
      cancelled,
      error,
      language: swedish && english ? "MIXED" : swedish ? "sv" : english ? "en" : "unknown",
      evidenceCodes,
      statusText: statusText.slice(0, 2400),
      hasCancel,
      hasHide,
      hasProgressSemantics,
      structuredRootCount: roots.length
    };
  }

  async function getPageState({ source = "dom-read" } = {}) {
    const assistantMessages = getAssistantMessages();
    const userMessages = getUserMessages();
    const conversationMessages = getConversationMessages();
    const latestMessage = getLatestConversationMessage();
    const latestMessageRole = latestMessage.role;
    const latestAssistant = assistantMessages.at(-1) || "";
    const latestUser = userMessages.at(-1) || "";
    const userTurnIds = extractUserTurnIds(userMessages);
    const userMessageHashes = await extractUserMessageHashes(userMessages);
    const foregroundSignals = detectForegroundSignals(latestAssistant, latestMessageRole);
    const generating = foregroundSignals.active;
    const composer = getComposer();
    const backgroundSignals = detectBackgroundSignals();
    const currentConversationKey = conversationKey();
    const latestUserHash = latestUser ? await sha256(latestUser) : "";
    const latestAssistantHash = latestAssistant ? await sha256(latestAssistant) : "";
    const latestMessageHash = latestMessage.text ? await sha256(latestMessage.text) : "";
    // Conversation/task identity must remain stable when ChatGPT virtualizes older DOM nodes.
    // The latest user-message hash is the semantic task anchor; visible node counts are diagnostics only.
    const taskFingerprint = await sha256([
      currentConversationKey,
      latestUserHash
    ].join("|"));
    const snapshotHash = await sha256([
      currentConversationKey,
      taskFingerprint,
      latestMessageRole,
      latestMessageHash,
      latestAssistantHash,
      String(generating),
      foregroundSignals.evidenceCodes.join(","),
      String(backgroundSignals.active),
      backgroundSignals.evidenceCodes.join(",")
    ].join("|"));
    const latestAssistantCandidate = Boolean(latestAssistantHash) &&
      latestMessageRole === "assistant" &&
      !foregroundSignals.streamingAssistant &&
      !backgroundSignals.active &&
      !backgroundSignals.cancelled &&
      !backgroundSignals.error;
    const latestAssistantComplete = latestAssistantCandidate && !generating;

    return {
      ok: true,
      supported: isSupportedPage(),
      version: VERSION,
      documentEpoch: DOCUMENT_EPOCH,
      conversationKey: currentConversationKey,
      sessionExists: isSupportedPage() && Boolean(composer),
      url: location.href,
      title: document.title,
      generating,
      foregroundSignals,
      backgroundSignals,
      responseState: backgroundSignals.active
        ? "WAITING_BACKGROUND"
        : foregroundSignals.protocolCompletionOverride
          ? "COMPLETE_PROTOCOL_OVERRIDE"
          : latestAssistantComplete
            ? "COMPLETE_STABLE"
            : latestAssistantCandidate
              ? "COMPLETE_DYNAMIC_CANDIDATE"
              : generating
                ? "GENERATING_FOREGROUND"
                : latestMessageRole === "user"
                  ? "WAITING_FOR_ASSISTANT"
                  : "UNKNOWN_RECONCILE",
      taskFingerprint,
      snapshotHash,
      composerFound: Boolean(composer),
      sendFound: Boolean(getSendButton()),
      boundarySignals: detectBoundarySignals(),
      assistantCount: assistantMessages.length,
      userCount: userMessages.length,
      latestMessageRole,
      latestMessageHash,
      latestUser,
      userTurnIds,
      userMessageHashes,
      latestAssistant,
      conversationExcerpt: buildConversationExcerpt(conversationMessages),
      latestUserHash,
      latestAssistantHash,
      latestAssistantCandidate,
      latestAssistantComplete,
      readAt: Date.now(),
      source
    };
  }

  function setNativeValue(element, value) {
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (!setter) throw new Error("Composer value setter saknas.");
      setter.call(element, value);
    } else {
      element.focus();
      element.textContent = value;
    }
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: value
    }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function waitForUserAck({
    turnId,
    promptAckDigest,
    requireTurnMarker = true
  }, timeoutMs = null) {
    const started = Date.now();
    const visibilityStateAtStart = document.visibilityState || "unknown";
    const effectiveTimeout = Number.isFinite(Number(timeoutMs))
      ? Number(timeoutMs)
      : visibilityStateAtStart === "hidden"
        ? 30_000
        : 15_000;
    let pollCount = 0;
    let mutationCount = 0;
    let wake = null;
    const observer = new MutationObserver((records) => {
      mutationCount += records.length;
      wake?.();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
    try {
      while (Date.now() - started < effectiveTimeout) {
        pollCount += 1;
        const userMessages = getUserMessages();
        if (requireTurnMarker && turnId && extractUserTurnIds(userMessages).includes(String(turnId))) {
          return {
            acknowledged: true,
            ackMode: "TURN_ID",
            elapsedMs: Date.now() - started,
            visibilityStateAtStart,
            visibilityStateAtEnd: document.visibilityState || "unknown",
            pollCount,
            mutationCount
          };
        }
        if (promptAckDigest) {
          const hashes = await extractUserMessageHashes(userMessages);
          if (hashes.includes(String(promptAckDigest))) {
            return {
              acknowledged: true,
              ackMode: "PROMPT_DIGEST",
              elapsedMs: Date.now() - started,
              visibilityStateAtStart,
              visibilityStateAtEnd: document.visibilityState || "unknown",
              pollCount,
              mutationCount
            };
          }
        }
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, document.visibilityState === "hidden" ? 500 : 150);
          wake = () => {
            clearTimeout(timer);
            wake = null;
            resolve();
          };
        });
      }
      return {
        acknowledged: false,
        ackMode: "TIMEOUT",
        elapsedMs: Date.now() - started,
        visibilityStateAtStart,
        visibilityStateAtEnd: document.visibilityState || "unknown",
        pollCount,
        mutationCount
      };
    } finally {
      wake = null;
      observer.disconnect();
    }
  }

  function decodeBase64Bytes(value) {
    const clean = String(value || "").replace(/\s+/g, "");
    if (!clean || clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
      throw new Error("ATTACHMENT_BASE64_INVALID");
    }
    let binary;
    try {
      binary = atob(clean);
    } catch {
      throw new Error("ATTACHMENT_BASE64_INVALID");
    }
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }

  async function sha256Bytes(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  }

  function attachmentFileInput() {
    const composer = getComposer();
    const region = composer?.closest("form, [data-testid*='composer' i], [data-testid*='prompt' i]") ||
      document.querySelector("form");
    const candidates = [
      ...(region?.querySelectorAll?.("input[type='file']") || []),
      ...document.querySelectorAll("input[type='file']")
    ];
    return candidates.find((input) => {
      if (!(input instanceof HTMLInputElement) || input.disabled) return false;
      const accept = String(input.accept || "").toLowerCase();
      return !accept || accept.includes("image") || accept.includes("png") || accept.includes("*/*");
    }) || null;
  }

  function attachmentDomMatches(fileName, fileSize, input) {
    if (input?.files && [...input.files].some((file) =>
      file.name === fileName && Number(file.size) === Number(fileSize))) {
      return "FILE_INPUT_FILES";
    }
    const composer = getComposer();
    const region = composer?.closest("form, [data-testid*='composer' i], [data-testid*='prompt' i]") ||
      document.querySelector("form") || document.body;
    const selectors = [
      "[data-testid*='attachment' i]",
      "[data-testid*='file' i]",
      "[aria-label*='attachment' i]",
      "[aria-label*='bilaga' i]",
      "[title]",
      "img[alt]"
    ];
    for (const node of region.querySelectorAll(selectors.join(","))) {
      const haystack = [
        node.textContent,
        node.getAttribute("aria-label"),
        node.getAttribute("title"),
        node.getAttribute("alt")
      ].filter(Boolean).join(" ");
      if (haystack.includes(fileName)) return "COMPOSER_ATTACHMENT_DOM";
    }
    return "";
  }

  async function waitForAttachmentReadback(fileName, fileSize, input, timeoutMs = 10_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const method = attachmentDomMatches(fileName, fileSize, input);
      if (method) return method;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return "";
  }

  async function attachImage({
    fileName,
    mimeType = "image/png",
    base64,
    bodyBytes,
    bodyDigest,
    expectedDocumentEpoch
  } = {}) {
    if (!isSupportedPage()) throw new Error("ATTACHMENT_UNSUPPORTED_ORIGIN");
    if (expectedDocumentEpoch && expectedDocumentEpoch !== DOCUMENT_EPOCH) {
      throw new Error("ATTACHMENT_STALE_DOCUMENT_EPOCH");
    }
    const safeName = String(fileName || "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 160);
    if (!safeName || !safeName.toLowerCase().endsWith(".png")) {
      throw new Error("ATTACHMENT_FILE_NAME_INVALID");
    }
    if (mimeType !== "image/png") throw new Error("ATTACHMENT_MIME_FORBIDDEN");
    const bytes = decodeBase64Bytes(base64);
    if (!bytes.byteLength || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error(`ATTACHMENT_SIZE_INVALID:${bytes.byteLength}`);
    }
    if (Number(bodyBytes) !== bytes.byteLength) throw new Error("ATTACHMENT_SIZE_MISMATCH");
    const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (!pngSignature.every((value, index) => bytes[index] === value)) {
      throw new Error("ATTACHMENT_PNG_SIGNATURE_INVALID");
    }
    const digest = await sha256Bytes(bytes);
    if (digest !== String(bodyDigest || "").toLowerCase()) {
      throw new Error("ATTACHMENT_DIGEST_MISMATCH");
    }
    const input = attachmentFileInput();
    if (!input) throw new Error("ATTACHMENT_FILE_INPUT_NOT_FOUND");
    if (typeof DataTransfer !== "function") throw new Error("ATTACHMENT_DATA_TRANSFER_UNAVAILABLE");
    const file = new File([bytes], safeName, { type: mimeType, lastModified: Date.now() });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const readbackMethod = await waitForAttachmentReadback(safeName, bytes.byteLength, input);
    if (!readbackMethod) throw new Error("ATTACHMENT_COMPOSER_READBACK_FAILED");
    return {
      ok: true,
      attached: true,
      fileName: safeName,
      mimeType,
      bodyBytes: bytes.byteLength,
      bodyDigest: digest,
      readbackMethod,
      documentEpoch: DOCUMENT_EPOCH
    };
  }

  async function submitPrompt({ prompt, turnId, promptDigest, promptAckDigest, requireTurnMarker = true, expectedDocumentEpoch }) {
    if (!isSupportedPage()) throw new Error("Fliken är inte en stödd ChatGPT-origin.");
    if (expectedDocumentEpoch && expectedDocumentEpoch !== DOCUMENT_EPOCH) {
      throw new Error("STALE_DOCUMENT_EPOCH: målfliken har laddats om eller navigerat.");
    }
    if (typeof prompt !== "string" || !prompt.trim()) throw new Error("Prompten är tom.");
    if (prompt.length > MAX_PROMPT_CHARS) {
      throw new Error(`Prompten överskrider ${MAX_PROMPT_CHARS} tecken.`);
    }
    if (requireTurnMarker && (!turnId || !prompt.includes(`EIC_TURN_ID: ${turnId}`) && !prompt.includes(`EIC_TURN: ${turnId}`))) {
      throw new Error("Prompten saknar exakt turn-ID.");
    }
    const backgroundSignals = detectBackgroundSignals();
    const latestAssistant = getAssistantMessages().at(-1) || "";
    const foregroundSignals = detectForegroundSignals(latestAssistant, getLatestConversationMessage().role);
    if (foregroundSignals.active || backgroundSignals.active) {
      throw new Error(backgroundSignals.active
        ? "TARGET_BACKGROUND_BUSY: ChatGPT arbetar i bakgrunden. Ingen ny prompt skickas."
        : "TARGET_BUSY: ChatGPT genererar redan. Pågående arbete lämnas orört.");
    }

    const composer = getComposer();
    if (!composer) throw new Error("ChatGPT-kompositorn hittades inte.");
    composer.focus();
    setNativeValue(composer, prompt);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const sendButton = getSendButton();
    let method = "enter-key";
    if (sendButton && !sendButton.disabled && sendButton.getAttribute("aria-disabled") !== "true") {
      sendButton.click();
      method = "send-button";
    } else {
      composer.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true
      }));
    }

    const ackDiagnostics = await waitForUserAck({ turnId, promptAckDigest, requireTurnMarker });
    return {
      ok: true,
      method,
      acknowledged: ackDiagnostics.acknowledged,
      ackDiagnostics,
      turnId,
      promptDigest,
      promptAckDigest,
      documentEpoch: DOCUMENT_EPOCH
    };
  }

  function ensureBadge() {
    if (badge?.isConnected) return badge;
    badge = document.createElement("div");
    badge.id = "eic-autonom-agent-tab-indicator";
    badge.setAttribute("data-eic-own-ui", "true");
    badge.setAttribute("aria-hidden", "true");
    Object.assign(badge.style, {
      all: "initial",
      position: "fixed",
      right: "12px",
      bottom: "12px",
      zIndex: "2147483647",
      maxWidth: "260px",
      padding: "6px 9px",
      borderRadius: "6px",
      background: "rgba(15, 23, 42, 0.92)",
      color: "#f8fafc",
      font: "600 11px/1.35 system-ui, sans-serif",
      boxShadow: "0 2px 10px rgba(0,0,0,.28)",
      pointerEvents: "none",
      letterSpacing: ".02em"
    });
    document.documentElement.append(badge);
    return badge;
  }

  function overlayDismissKey(needKey) {
    return `eicAutonomAgent.overlayDismissed:${String(needKey || "").slice(0, 300)}`;
  }

  function ensureProcessOverlay() {
    if (processOverlay?.isConnected) return processOverlay;
    const shell = document.createElement("section");
    shell.id = "eic-autonom-agent-process-overlay";
    shell.setAttribute("data-eic-own-ui", "true");
    shell.setAttribute("role", "status");
    shell.setAttribute("aria-live", "polite");
    Object.assign(shell.style, {
      all: "initial",
      position: "fixed",
      top: "18px",
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: "2147483646",
      width: "min(560px, calc(100vw - 36px))",
      boxSizing: "border-box",
      padding: "14px 44px 14px 16px",
      border: "1px solid rgba(148, 163, 184, .42)",
      borderRadius: "12px",
      background: "rgba(15, 23, 42, .82)",
      backdropFilter: "blur(12px)",
      color: "#f8fafc",
      font: "500 13px/1.45 system-ui, sans-serif",
      boxShadow: "0 14px 42px rgba(0, 0, 0, .35)",
      pointerEvents: "auto"
    });
    const title = document.createElement("div");
    title.dataset.role = "title";
    Object.assign(title.style, {
      font: "700 14px/1.35 system-ui, sans-serif",
      marginBottom: "4px"
    });
    const detail = document.createElement("div");
    detail.dataset.role = "detail";
    Object.assign(detail.style, {
      opacity: ".92",
      whiteSpace: "pre-wrap"
    });
    const progress = document.createElement("div");
    progress.dataset.role = "progress";
    Object.assign(progress.style, {
      marginTop: "8px",
      color: "#67e8f9",
      font: "700 11px/1.3 system-ui, sans-serif",
      letterSpacing: ".04em",
      textTransform: "uppercase"
    });
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Stäng agentstatus");
    Object.assign(close.style, {
      all: "initial",
      position: "absolute",
      top: "8px",
      right: "10px",
      width: "28px",
      height: "28px",
      borderRadius: "7px",
      color: "#f8fafc",
      font: "700 22px/28px system-ui, sans-serif",
      textAlign: "center",
      cursor: "pointer"
    });
    close.addEventListener("click", () => {
      if (currentOverlayNeedKey) {
        try {
          sessionStorage.setItem(overlayDismissKey(currentOverlayNeedKey), "1");
        } catch {}
      }
      shell.hidden = true;
    });
    shell.append(title, detail, progress, close);
    document.documentElement.append(shell);
    processOverlay = shell;
    return shell;
  }

  function setProcessOverlay(payload = null) {
    if (!payload || payload.visible === false) {
      if (processOverlay) processOverlay.hidden = true;
      return { visible: false };
    }
    const needKey = String(payload.needKey || payload.state || "agent-process").slice(0, 300);
    currentOverlayNeedKey = needKey;
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem(overlayDismissKey(needKey)) === "1";
    } catch {}
    const node = ensureProcessOverlay();
    if (dismissed) {
      node.hidden = true;
      return { visible: false, dismissed: true, needKey };
    }
    node.querySelector("[data-role='title']").textContent =
      String(payload.title || "EIC Autonom Agent").slice(0, 180);
    node.querySelector("[data-role='detail']").textContent =
      String(payload.detail || "").slice(0, 1200);
    node.querySelector("[data-role='progress']").textContent =
      String(payload.progress || payload.state || "").slice(0, 180);
    node.hidden = false;
    return { visible: true, needKey };
  }

  function setLinkStatus(status, detail = "", overlay = null) {
    currentLinkStatus = String(status || "DISCONNECTED").toUpperCase();
    const labels = {
      LINKED: "EIC · KOPPLAD",
      ACTIVE_TARGET: "EIC · AKTIVT MÅL",
      WAITING: "EIC · VÄNTAR",
      INITIALIZING: "EIC · INITIERAR SESSION",
      ASSESSING: "EIC · NANO ANALYSERAR",
      WORKING: "EIC · ARBETAR",
      BACKGROUND: "EIC · BAKGRUNDSVÄNTAN",
      PAUSED: "EIC · PAUSAD",
      BLOCKED: "EIC · BLOCKERAD",
      DONE: "EIC · KLAR",
      DISCONNECTED: "EIC · FRÅNKOPPLAD"
    };
    const node = ensureBadge();
    node.textContent = detail
      ? `${labels[currentLinkStatus] || labels.DISCONNECTED} — ${String(detail).slice(0, 140)}`
      : labels[currentLinkStatus] || labels.DISCONNECTED;
    node.style.opacity = currentLinkStatus === "DISCONNECTED" ? "0.55" : "0.92";
    const overlayState = setProcessOverlay(overlay);
    return { ok: true, status: currentLinkStatus, overlay: overlayState };
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error ?? "");
  }

  function isExtensionContextInvalidated(error) {
    return /extension context invalidated/i.test(errorMessage(error));
  }

  function extensionContextAlive() {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch {
      return false;
    }
  }

  function stopLocalBridge({ removeRuntimeListener = false } = {}) {
    if (disposed) return;
    disposed = true;
    clearTimeout(dirtyTimer);
    dirtyTimer = null;
    observer?.disconnect();
    observer = null;
    if (removeRuntimeListener) {
      try {
        chrome.runtime.onMessage.removeListener(onMessage);
      } catch {
        // Ett redan invaliderat extension-context kan inte avregistrera listenern.
      }
    }
    badge?.remove();
    badge = null;
    processOverlay?.remove();
    processOverlay = null;
  }

  function scheduleDirty(reason = "mutation") {
    if (disposed) return;
    clearTimeout(dirtyTimer);
    dirtyTimer = setTimeout(() => {
      dirtyTimer = null;
      if (disposed) return;
      if (!extensionContextAlive()) {
        stopLocalBridge();
        return;
      }

      try {
        const pending = chrome.runtime.sendMessage({
          type: "EIC_OBSERVATION_DIRTY",
          documentEpoch: DOCUMENT_EPOCH,
          reason,
          at: Date.now()
        });
        Promise.resolve(pending).catch((error) => {
          if (isExtensionContextInvalidated(error)) stopLocalBridge();
        });
      } catch (error) {
        if (isExtensionContextInvalidated(error) || !extensionContextAlive()) {
          stopLocalBridge();
        }
      }
    }, 700);
  }

  function startObserver() {
    observer?.disconnect();
    observer = new MutationObserver(() => scheduleDirty("dom-mutation"));
    const target = document.querySelector("main") || document.body || document.documentElement;
    observer.observe(target, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-message-author-role", "data-testid", "aria-label", "disabled"]
    });
  }


  function transcriptScrollContainer() {
    return document.querySelector("main")?.closest("[data-scroll-root], [class*='overflow-y-auto']") ||
      document.scrollingElement || document.documentElement;
  }

  function transcriptMessages() {
    return [...document.querySelectorAll("[data-message-author-role]")]
      .filter((node) => !node.closest("[data-eic-own-ui='true']"))
      .map((node, ordinal) => {
        const role = String(node.getAttribute("data-message-author-role") || "").toLowerCase();
        if (!["user", "assistant", "system", "tool"].includes(role)) return null;
        const reasoning = node.querySelector("[data-testid*='reasoning' i], [aria-label*='reasoning' i]");
        return {
          role,
          ordinal,
          sourceMessageId: node.getAttribute("data-message-id") || node.id || "",
          text: String(node.innerText || node.textContent || "").trim().slice(0, 200000),
          finalAnswer: role === "assistant"
            ? String(node.innerText || node.textContent || "").trim().slice(0, 200000)
            : null,
          reasoningSummaryVisible: Boolean(reasoning),
          reasoningSummary: reasoning
            ? String(reasoning.innerText || reasoning.textContent || "").trim().slice(0, 40000)
            : "",
          links: [...node.querySelectorAll("a[href]")].map((link) => link.href).slice(0, 100),
          attachments: [...node.querySelectorAll("[data-testid*='attachment' i], [aria-label*='attachment' i]")]
            .map((item) => ({
              name: item.getAttribute("aria-label") || item.textContent || "attachment",
              kind: "browser-reference",
              locator: item.getAttribute("data-testid") || item.id || null
            }))
            .slice(0, 50)
        };
      })
      .filter(Boolean);
  }

  async function captureTranscript(requestId = "") {
    const normalizedRequestId = String(requestId || crypto.randomUUID());
    if (activeCaptureRequestId) {
      return { ok: false, error: "SESSION_CAPTURE_ALREADY_RUNNING", requestId: activeCaptureRequestId };
    }
    activeCaptureRequestId = normalizedRequestId;
    const assertNotCancelled = () => {
      if (cancelledCaptureRequestIds.has(normalizedRequestId)) {
        throw new Error("SESSION_CAPTURE_CANCELLED");
      }
    };
    const scroll = transcriptScrollContainer();
    const initialTop = Number(scroll.scrollTop || window.scrollY || 0);
    const initialLeft = Number(scroll.scrollLeft || window.scrollX || 0);
    const merged = new Map();
    let reachedTop = false;
    let reachedBottom = false;
    let stable = 0;
    let priorSize = 0;
    try {
      assertNotCancelled();
      scroll.scrollTo?.({ top: 0, behavior: "instant" });
      if (!scroll.scrollTo) scroll.scrollTop = 0;
      await settleDom(120);
      for (let sweep = 0; sweep < 80; sweep += 1) {
        assertNotCancelled();
        const visible = transcriptMessages();
        for (const message of visible) {
          const key = message.sourceMessageId ||
            `${message.role}:${message.text.slice(0, 240)}:${message.text.length}`;
          merged.set(key, message);
        }
        const top = Number(scroll.scrollTop || window.scrollY || 0);
        const height = Number(scroll.scrollHeight || document.documentElement.scrollHeight || 0);
        const client = Number(scroll.clientHeight || window.innerHeight || 0);
        reachedTop ||= top <= 2;
        reachedBottom ||= top + client >= height - 2;
        stable = merged.size === priorSize ? stable + 1 : 0;
        priorSize = merged.size;
        if (reachedBottom && stable >= 2) break;
        const nextTop = Math.min(Math.max(0, height - client), top + Math.max(320, Math.floor(client * 0.8)));
        scroll.scrollTo?.({ top: nextTop, behavior: "instant" });
        if (!scroll.scrollTo) scroll.scrollTop = nextTop;
        await settleDom(100);
        assertNotCancelled();
      }
    } finally {
      scroll.scrollTo?.({ top: initialTop, left: initialLeft, behavior: "instant" });
      if (!scroll.scrollTo) {
        scroll.scrollTop = initialTop;
        scroll.scrollLeft = initialLeft;
      }
      await settleDom(80);
      cancelledCaptureRequestIds.delete(normalizedRequestId);
      activeCaptureRequestId = "";
    }
    const messages = [...merged.values()].map((message, ordinal) => ({ ...message, ordinal }));
    const gaps = [];
    if (!reachedTop) gaps.push({ startOrdinal: -1, endOrdinal: 0, reason: "TOP_NOT_VERIFIED" });
    if (!reachedBottom) gaps.push({
      startOrdinal: Math.max(0, messages.length - 1),
      endOrdinal: -1,
      reason: "BOTTOM_NOT_VERIFIED"
    });
    return {
      ok: true,
      schema: "eic.autonom.transcript-sweep.v1",
      conversationKey: `${location.origin}${location.pathname}`,
      branchKey: location.href,
      messages,
      gaps,
      completeness: gaps.length ? "GAPPED" : "COMPLETE",
      scrollRestored: true,
      reachedTop,
      reachedBottom,
      requestId: normalizedRequestId
    };
  }

  async function handleRequest(message) {
    if (!message || typeof message.type !== "string") {
      return { ok: false, error: "invalid-message" };
    }
    switch (message.type) {
      case "EIC_PING":
        return {
          ok: true,
          supported: isSupportedPage(),
          version: VERSION,
          documentEpoch: DOCUMENT_EPOCH,
          linkStatus: currentLinkStatus
        };
      case "EIC_GET_PAGE_STATE":
        if (message.source?.includes("reload")) await settleDom();
        return getPageState({ source: message.source || "request" });
      case "EIC_SUBMIT_PROMPT":
        return submitPrompt(message);
      case "EIC_ATTACH_IMAGE":
        return attachImage(message);
      case "EIC_SET_LINK_STATUS":
        return setLinkStatus(message.status, message.detail, message.overlay);
      case "EIC_CAPTURE_TRANSCRIPT":
        return captureTranscript(message.requestId);
      case "EIC_CANCEL_CAPTURE": {
        const requestId = String(message.requestId || activeCaptureRequestId || "");
        if (requestId) cancelledCaptureRequestIds.add(requestId);
        return { ok: true, requestId, cancelled: Boolean(requestId) };
      }
      default:
        return { ok: false, error: "unknown-message-type" };
    }
  }

  const onMessage = (message, _sender, sendResponse) => {
    handleRequest(message)
      .then(sendResponse)
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    return true;
  };

  chrome.runtime.onMessage.addListener(onMessage);
  startObserver();

  globalThis[BRIDGE_KEY] = {
    version: VERSION,
    documentEpoch: DOCUMENT_EPOCH,
    ping: () => ({ version: VERSION, documentEpoch: DOCUMENT_EPOCH }),
    dispose() {
      stopLocalBridge({ removeRuntimeListener: true });
    }
  };

  scheduleDirty("bridge-ready");
})();
