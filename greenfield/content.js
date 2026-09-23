(() => {
  const BRIDGE = "__EIC_GF_CONTENT_V2__";
  const OVERLAY_ID = "eic-gf-linked-overlay";
  const CONTENT_VERSION = "1.7.9";
  const previousBridge = globalThis[BRIDGE] || null;
  const DOCUMENT_ID = previousBridge?.documentId || crypto.randomUUID();
  const dispatchRecords = previousBridge?.dispatchRecords instanceof Map
    ? previousBridge.dispatchRecords
    : new Map();
  if (previousBridge?.dispose) {
    try { previousBridge.dispose(); } catch {}
  }

  const listeners = [];
  let observer = null;
  let dirtyTimer = null;
  let overlayInfo = null;
  let overlayTimer = null;
  let overlaySignature = "";

  function normalizeText(value) {
    return String(value ?? "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => !/^(?:Visa mindre|Visa mer|Show less|Show more|Kopiera kod|Copy code)$/iu.test(line.trim()))
      .join("\n")
      .trim();
  }

  function assistantLifecycleStatusText(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return false;
    if (/^(?:Tänker|Thinking|Arbetar|Working|Resonerar|Reasoning|Analyserar|Analyzing)(?:\.{0,3}|…)?$/iu.test(text)) {
      return true;
    }
    return /^(?:Arbetade|Worked|Tänkte|Thought|Resonerade|Reasoned|Analyserade|Analyzed)\s+(?:i|for)\s+(?:(?:\d+(?:[.,]\d+)?\s*(?:h|tim(?:me|mar)?|hours?|m|min(?:ut|uter)?|minutes?|s|sek(?:und|under)?|seconds?)\s*){1,3})\s*(?:[>›»⌄▼]|$)$/iu.test(text);
  }

  function stripAssistantPresentationChrome(value) {
    let text = normalizeText(value);
    if (!text) return "";
    text = text.replace(
      /^(?:(?:EIC|ChatGPT|Assistant|Assistenten)\s+(?:sade|said)\s*:\s*)/iu,
      ""
    );
    text = text.replace(
      /^(?:Arbetade|Worked|Tänkte|Thought|Resonerade|Reasoned|Analyserade|Analyzed)\s+(?:i|for)\s+(?:(?:\d+(?:[.,]\d+)?\s*(?:h|tim(?:me|mar)?|hours?|m|min(?:ut|uter)?|minutes?|s|sek(?:und|under)?|seconds?)\s*){1,3})(?:\s*[>›»⌄▼])?\s*/iu,
      ""
    );
    return normalizeText(text);
  }

  function semanticMessageText(entry, value) {
    const normalized = normalizeText(value);
    if (entry?.role !== "assistant") return normalized;
    const presentationCleaned = stripAssistantPresentationChrome(normalized);
    return stripAssistantPresentationChrome(
      presentationCleaned
        .split("\n")
        .filter((line) => !assistantLifecycleStatusText(line))
        .join("\n")
    );
  }

  async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(String(value ?? ""));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function serializeError(error) {
    return {
      name: String(error?.name || "Error"),
      code: String(error?.code || ""),
      message: String(error?.message || error || "Unknown error").slice(0, 4000),
      stack: String(error?.stack || "").slice(0, 12000)
    };
  }

  function forensic(kind, payload = {}, severity = "INFO") {
    try {
      chrome.runtime.sendMessage({
        type: "EIC_GF_FORENSIC_EVENT",
        event: { kind, component: "content", severity, payload }
      }).catch?.(() => undefined);
    } catch {}
  }

  function visible(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 &&
      style.display !== "none" && style.visibility !== "hidden" &&
      element.getAttribute("aria-hidden") !== "true";
  }

  function firstVisible(selectors) {
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (visible(element)) return element;
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
        if (!visible(element)) continue;
        if (element.closest("[data-message-author-role], [data-eic-gf-ui='true']")) continue;
        if (element.disabled || element.getAttribute("aria-disabled") === "true") continue;
        return element;
      }
    }
    return null;
  }


  const RATE_LIMIT_REQUEST_SIGNAL =
    /(request|förfrågn|pyynt|anfrag|requ[eê]t|solicitud|richiest|solicita[cç]|verzoek|forespør|zapyt|запрос|リクエスト|请求|請求)/iu;
  const RATE_LIMIT_THROTTLE_SIGNAL =
    /(rate[\s_-]*limit|too many|too fast|too quickly|för många|för snabbt|liikaa|liian nopeasti|zu viele|zu schnell|trop de|trop rapidement|demasiad|demasiado rápido|troppe|troppo velocemente|muitas?|muito rápido|te veel|te snel|for mange|for raskt|za dużo|zbyt szybko|слишком много|слишком быстро|temporar.{0,28}(limit|begräns|rajoit|beschränk|beperk|begrens)|wait.{0,24}(minute|minut)|vänta.{0,24}minut|odota.{0,24}minuut|warte.{0,24}minut|attend.{0,24}minute|esper.{0,24}minut|aspetta.{0,24}minut|aguard.{0,24}minut|wacht.{0,24}minuut|vent.{0,24}minutt|poczek.{0,24}minut|подожд.{0,24}минут)/iu;
  const RATE_LIMIT_HIGH_RISK_ACTION =
    /(upgrade|subscribe|subscription|login|log-in|sign-in|signin|payment|purchase|checkout|delete|remove|retry|try-again|try_again)/iu;

  function rateLimitTextSignal(value) {
    const text = normalizeText(value).toLowerCase();
    if (!text) return false;
    if (/rate[\s_-]*limit/iu.test(text)) return true;
    return RATE_LIMIT_REQUEST_SIGNAL.test(text) && RATE_LIMIT_THROTTLE_SIGNAL.test(text);
  }

  function blockingDialogCandidates() {
    const selectors = [
      "[role='alertdialog']",
      "[role='dialog']",
      "[aria-modal='true']",
      "[data-state='open'][data-radix-dialog-content]"
    ];
    const seen = new Set();
    const out = [];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (!(element instanceof Element) || seen.has(element) || !visible(element)) continue;
        if (element.closest("[data-eic-gf-ui='true']")) continue;
        seen.add(element);
        out.push(element);
      }
    }
    return out;
  }

  function visibleWithin(root, selector) {
    return [...root.querySelectorAll(selector)].filter((element) => visible(element));
  }

  function structurallySafeAcknowledgementButton(dialog) {
    const actions = visibleWithin(dialog, "button,[role='button']")
      .filter((element) => !element.disabled && element.getAttribute("aria-disabled") !== "true");
    if (actions.length !== 1) return null;
    if (visibleWithin(dialog, "input,textarea,select").length) return null;
    if (visibleWithin(dialog, "a[href]").length) return null;

    const button = actions[0];
    const structuralIdentity = [
      button.getAttribute("data-testid") || "",
      button.getAttribute("name") || "",
      button.getAttribute("id") || "",
      button.getAttribute("class") || "",
      button.getAttribute("type") || ""
    ].join(" ").toLowerCase();

    if (RATE_LIMIT_HIGH_RISK_ACTION.test(structuralIdentity)) return null;
    if (String(button.getAttribute("type") || "").toLowerCase() === "submit" && button.closest("form")) {
      return null;
    }
    return button;
  }

  async function detectRateLimitWarning() {
    for (const dialog of blockingDialogCandidates()) {
      const text = normalizeText(dialog.innerText || dialog.textContent || "");
      if (!rateLimitTextSignal(text)) continue;
      const role = String(dialog.getAttribute("role") || (dialog.getAttribute("aria-modal") === "true" ? "modal" : "dialog"));
      const actions = visibleWithin(dialog, "button,[role='button']")
        .filter((element) => !element.disabled && element.getAttribute("aria-disabled") !== "true");
      const safeButton = structurallySafeAcknowledgementButton(dialog);
      const signature = await sha256Hex([
        role,
        dialog.getAttribute("aria-modal") || "",
        text,
        String(actions.length)
      ].join("|"));
      return {
        active: true,
        confidence: "HIGH",
        detector: "STRUCTURAL_MULTILINGUAL_THROTTLE_MODAL_V1",
        signature,
        role,
        ariaModal: dialog.getAttribute("aria-modal") === "true",
        buttonCount: actions.length,
        safeAcknowledgeAvailable: Boolean(safeButton),
        hasFormFields: visibleWithin(dialog, "input,textarea,select").length > 0,
        hasLinks: visibleWithin(dialog, "a[href]").length > 0,
        textLength: text.length,
        dialog,
        safeButton
      };
    }
    return {
      active: false,
      confidence: "NONE",
      detector: "STRUCTURAL_MULTILINGUAL_THROTTLE_MODAL_V1",
      signature: "",
      role: "",
      ariaModal: false,
      buttonCount: 0,
      safeAcknowledgeAvailable: false,
      hasFormFields: false,
      hasLinks: false,
      textLength: 0,
      dialog: null,
      safeButton: null
    };
  }

  function publicRateLimitWarning(warning) {
    return {
      active: warning?.active === true,
      confidence: String(warning?.confidence || "NONE"),
      detector: String(warning?.detector || "STRUCTURAL_MULTILINGUAL_THROTTLE_MODAL_V1"),
      signature: String(warning?.signature || ""),
      role: String(warning?.role || ""),
      ariaModal: warning?.ariaModal === true,
      buttonCount: Number(warning?.buttonCount || 0),
      safeAcknowledgeAvailable: warning?.safeAcknowledgeAvailable === true,
      hasFormFields: warning?.hasFormFields === true,
      hasLinks: warning?.hasLinks === true,
      textLength: Number(warning?.textLength || 0)
    };
  }

  async function rateLimitRecoveryPreflight() {
    const warning = await detectRateLimitWarning();
    const publicWarning = publicRateLimitWarning(warning);
    if (!warning.active || !warning.safeButton) {
      return {
        ok: true,
        action: "RELOAD_REQUIRED",
        reason: warning.active
          ? "WARNING_PRESENT_NO_STRUCTURALLY_SAFE_ACK"
          : "WARNING_NOT_PRESENT_FOR_SAFE_ACK",
        warning: publicWarning
      };
    }

    try {
      warning.safeButton.click();
    } catch (error) {
      return {
        ok: true,
        action: "RELOAD_REQUIRED",
        reason: "SAFE_ACK_CLICK_FAILED",
        warning: publicWarning,
        error: serializeError(error)
      };
    }

    const started = Date.now();
    while (Date.now() - started < 2500) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      const current = await detectRateLimitWarning();
      if (!current.active && getComposer()) {
        forensic("RATE_LIMIT_WARNING_DISMISSED_SAFE", {
          detector: publicWarning.detector,
          signature: publicWarning.signature,
          structuralAck: true
        });
        return {
          ok: true,
          action: "DISMISSED_SAFE",
          reason: "STRUCTURAL_ACK_DISMISS_CONFIRMED",
          warning: publicWarning
        };
      }
    }

    return {
      ok: true,
      action: "RELOAD_REQUIRED",
      reason: "SAFE_ACK_DISMISS_NOT_CONFIRMED",
      warning: publicWarning
    };
  }

  function outerRoleNodes(container) {
    return [...container.querySelectorAll("[data-message-author-role]")]
      .filter((item) => !item.parentElement?.closest("[data-message-author-role]"));
  }

  function homogeneousRoleOwner(container, role) {
    if (!container || container.closest?.("[data-eic-gf-ui='true']")) return false;
    const roles = outerRoleNodes(container)
      .map((item) => String(item.getAttribute("data-message-author-role") || "").toLowerCase())
      .filter(Boolean);
    return roles.length === 1 && roles[0] === role;
  }

  function roleNodeMessageId(node) {
    return String(node?.getAttribute?.("data-message-id") || "");
  }

  function coherentRoleReplicaSet(container, node, role) {
    if (!container || !node) return false;
    const roleNodes = outerRoleNodes(container);
    if (roleNodes.length < 2) return false;
    const targetId = roleNodeMessageId(node);
    if (!targetId) return false;

    const texts = [];
    for (const item of roleNodes) {
      const itemRole = String(item.getAttribute("data-message-author-role") || "").toLowerCase();
      if (itemRole !== role || roleNodeMessageId(item) !== targetId) return false;
      const itemText = normalizeText(item.innerText || item.textContent || "");
      if (!itemText) return false;
      texts.push(itemText);
    }
    return texts.every((item) => item === texts[0]);
  }

  function resolveMessageOwner(node, role, turnSelector) {
    const explicit = node.closest(turnSelector);
    if (explicit && homogeneousRoleOwner(explicit, role)) {
      return { owner: explicit, ownerKind: "EXPLICIT_TURN_SHELL", ownerTrusted: true };
    }

    // ChatGPT can render a message without the historical turn selectors, and
    // newer renderer layouts can expose coherent duplicate role nodes for the
    // same message id. Prefer a single-role ancestor; if the nearest bounded
    // structure is a set of byte-coherent replicas of one message id, keep the
    // selected role node as owner and mark the replica proof explicitly.
    let current = node.parentElement;
    let bounded = null;
    let depth = 0;
    while (current && current !== document.body && current !== document.documentElement && depth < 24) {
      if (current.matches?.("[data-eic-gf-ui='true']")) break;
      const roleNodes = outerRoleNodes(current);
      const roles = roleNodes
        .map((item) => String(item.getAttribute("data-message-author-role") || "").toLowerCase())
        .filter(Boolean);
      if (roles.some((item) => item !== role)) break;
      if (roles.length === 1 && roles[0] === role) bounded = current;
      if (coherentRoleReplicaSet(current, node, role)) {
        return { owner: node, ownerKind: "COHERENT_ROLE_REPLICA", ownerTrusted: true };
      }
      current = current.parentElement;
      depth += 1;
    }

    if (bounded) {
      return { owner: bounded, ownerKind: "ROLE_BOUNDARY_ANCESTOR", ownerTrusted: true };
    }
    return { owner: node, ownerKind: "ROLE_NODE_FALLBACK", ownerTrusted: false };
  }

  function canonicalEntries() {
    const out = [];
    const seen = new Set();
    const stableEntryIndex = new Map();
    const turnSelector = [
      "article[data-testid^='conversation-turn-']",
      "[data-testid^='conversation-turn-']",
      "article[data-turn-id]",
      "[data-turn-id]"
    ].join(",");

    for (const node of document.querySelectorAll("[data-message-author-role]")) {
      if (node.parentElement?.closest("[data-message-author-role]")) continue;
      if (node.closest("[data-eic-gf-ui='true']")) continue;
      const role = String(node.getAttribute("data-message-author-role") || "").toLowerCase();
      if (!["user", "assistant"].includes(role)) continue;

      const resolved = resolveMessageOwner(node, role, turnSelector);
      const owner = resolved.owner;
      if (seen.has(owner)) continue;
      seen.add(owner);
      const id = String(
        owner.getAttribute?.("data-turn-id") ||
        owner.getAttribute?.("data-testid") ||
        node.getAttribute?.("data-message-id") ||
        ""
      );
      const candidate = {
        node,
        owner,
        role,
        id,
        ownerKind: resolved.ownerKind,
        ownerTrusted: resolved.ownerTrusted,
        replicaCount: 1
      };
      const stableKey = id ? `${role}|${id}` : "";
      if (stableKey && stableEntryIndex.has(stableKey)) {
        const index = stableEntryIndex.get(stableKey);
        const prior = out[index];
        const priorTextLength = normalizeText(prior.owner?.innerText || prior.owner?.textContent || "").length;
        const candidateTextLength = normalizeText(owner?.innerText || owner?.textContent || "").length;
        const replace = (
          (candidate.ownerTrusted === true && prior.ownerTrusted !== true) ||
          (candidate.ownerTrusted === prior.ownerTrusted && candidateTextLength > priorTextLength)
        );
        if (replace) {
          out[index] = {
            ...candidate,
            replicaCount: Number(prior.replicaCount || 1) + 1
          };
        } else {
          prior.replicaCount = Number(prior.replicaCount || 1) + 1;
        }
        continue;
      }
      if (stableKey) stableEntryIndex.set(stableKey, out.length);
      out.push(candidate);
    }
    return out;
  }

  function resolveAutonomousTurn(entries, expectedUserTurnId = "", expectedUserIndex = null) {
    const expectedId = String(expectedUserTurnId || "");
    const indexValue = expectedUserIndex == null ? Number.NaN : Number(expectedUserIndex);
    const users = entries.filter((entry) => entry.role === "user");

    let userEntry = expectedId
      ? users.find((entry) => entry.id === expectedId) || null
      : null;
    let resolvedBy = userEntry ? "USER_TURN_ID" : "NONE";

    if (!userEntry && Number.isInteger(indexValue) && indexValue >= 0 && indexValue < users.length) {
      userEntry = users[indexValue] || null;
      resolvedBy = userEntry ? "USER_ORDINAL" : "NONE";
    }

    if (!userEntry) {
      return {
        expectedUserTurnId: expectedId,
        expectedUserIndex: Number.isInteger(indexValue) ? indexValue : null,
        resolvedUserTurnId: "",
        resolvedBy,
        assistantFound: false,
        assistantId: "",
        assistantOwnerKind: "NONE",
        assistantOwnerTrusted: false,
        assistantText: "",
        assistantTextLength: 0,
        assistantHash: "",
        assistantGenerating: false,
        assistantSignals: {}
      };
    }

    const userPosition = entries.indexOf(userEntry);
    let assistantEntry = null;
    let nextUserEntry = null;
    for (let i = userPosition + 1; i < entries.length; i += 1) {
      const entry = entries[i];
      if (entry.role === "user") {
        nextUserEntry = entry;
        break;
      }
      if (entry.role === "assistant") assistantEntry = entry;
    }

    return {
      expectedUserTurnId: expectedId,
      expectedUserIndex: Number.isInteger(indexValue) ? indexValue : null,
      resolvedUserTurnId: userEntry.id || "",
      resolvedBy,
      userEntry,
      assistantEntry,
      nextUserTurnId: nextUserEntry?.id || "",
      responseSlotClosed: Boolean(nextUserEntry && !assistantEntry)
    };
  }

  function messageText(entry) {
    if (!entry) return "";
    const clone = entry.owner.cloneNode(true);
    for (const node of clone.querySelectorAll(
      "button, textarea, input, select, [contenteditable='true'], [data-eic-gf-ui='true']"
    )) node.remove();
    const rendered = clone.innerText || clone.textContent || entry.owner.innerText || entry.owner.textContent || "";
    // The conceptual turn remains the owner so structured/final fragments stay
    // together, but presentation/reasoning lifecycle lines are not assistant output.
    return semanticMessageText(entry, rendered);
  }

  function generationSignals(lastAssistantEntry) {
    const stopButton = getStopButton();
    const assistantOwner = lastAssistantEntry?.owner || null;
    const streaming = Boolean(assistantOwner && (
      assistantOwner.matches?.("[data-is-streaming='true'], [aria-busy='true'], .result-streaming") ||
      assistantOwner.querySelector?.(
        "[data-is-streaming='true'], [aria-busy='true'], .result-streaming, [data-testid*='streaming' i]"
      )
    ));
    const composer = getComposer();
    const composerBusy = Boolean(composer && (
      composer.getAttribute("aria-busy") === "true" ||
      composer.getAttribute("aria-disabled") === "true" ||
      composer.hasAttribute("disabled")
    ));
    const stopVisible = Boolean(stopButton);
    return {
      generating: Boolean(stopVisible || streaming || composerBusy),
      signals: {
        stopVisible,
        streaming,
        composerBusy,
        visibilityState: document.visibilityState || "unknown"
      }
    };
  }

  async function pageState({ expectedUserTurnId = "", expectedUserIndex = null } = {}) {
    const entries = canonicalEntries();
    const users = entries.filter((entry) => entry.role === "user");
    const assistants = entries.filter((entry) => entry.role === "assistant");
    const lastUser = users.at(-1) || null;
    const lastAssistant = assistants.at(-1) || null;
    const userText = messageText(lastUser);
    const assistantText = messageText(lastAssistant);
    const { generating, signals } = generationSignals(lastAssistant);
    const rateLimitWarning = publicRateLimitWarning(await detectRateLimitWarning());

    const autonomous = resolveAutonomousTurn(entries, expectedUserTurnId, expectedUserIndex);
    const autonomousAssistant = autonomous.assistantEntry || null;
    const autonomousAssistantText = messageText(autonomousAssistant);
    const autonomousGeneration = generationSignals(autonomousAssistant);

    const composer = getComposer();
    const composerText = composer
      ? normalizeText(composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement
          ? composer.value
          : composer.innerText || composer.textContent || "")
      : "";
    return {
      bridgeVersion: CONTENT_VERSION,
      documentId: DOCUMENT_ID,
      url: location.href,
      title: document.title,
      userCount: users.length,
      assistantCount: assistants.length,
      lastUserId: lastUser?.id || "",
      lastAssistantId: lastAssistant?.id || "",
      lastAssistantOwnerKind: lastAssistant?.ownerKind || "NONE",
      lastAssistantOwnerTrusted: lastAssistant?.ownerTrusted === true,
      lastAssistantReplicaCount: Number(lastAssistant?.replicaCount || 0),
      lastUserText: userText,
      lastUserHash: userText ? await sha256Hex(userText) : "",
      assistantText,
      assistantTextLength: assistantText.length,
      assistantHash: assistantText ? await sha256Hex(assistantText) : "",
      generating,
      signals,
      composerReady: Boolean(composer),
      composerEmpty: !composerText,
      composerTextHash: composerText ? await sha256Hex(composerText) : "",
      rateLimitWarning,
      modelEvidence: globalThis.GreenfieldModelObservation?.observe() || null,
      autonomousTurn: {
        expectedUserTurnId: autonomous.expectedUserTurnId || "",
        expectedUserIndex: Number.isInteger(autonomous.expectedUserIndex) ? autonomous.expectedUserIndex : null,
        resolvedUserTurnId: autonomous.resolvedUserTurnId || "",
        userTextHash: autonomous.userEntry ? await sha256Hex(messageText(autonomous.userEntry)) : "",
        resolvedBy: autonomous.resolvedBy || "NONE",
        assistantFound: Boolean(autonomousAssistant),
        assistantId: autonomousAssistant?.id || "",
        assistantOwnerKind: autonomousAssistant?.ownerKind || "NONE",
        assistantOwnerTrusted: autonomousAssistant?.ownerTrusted === true,
        assistantReplicaCount: Number(autonomousAssistant?.replicaCount || 0),
        assistantText: autonomousAssistantText,
        assistantTextLength: autonomousAssistantText.length,
        assistantHash: autonomousAssistantText ? await sha256Hex(autonomousAssistantText) : "",
        assistantGenerating: autonomousGeneration.generating === true,
        assistantSignals: autonomousGeneration.signals || {},
        nextUserTurnId: autonomous.nextUserTurnId || "",
        responseSlotClosed: autonomous.responseSlotClosed === true
      }
    };
  }

  function setNativeValue(element, value) {
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (!setter) throw new Error("COMPOSER_VALUE_SETTER_MISSING");
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

  function materializationEvidence(before, state, promptHash) {
    if (state.lastUserHash && state.lastUserHash === promptHash) return "PAGE_LAST_USER_HASH";
    if (Number(state.userCount || 0) > Number(before.userCount || 0)) return "USER_COUNT_INCREMENTED";
    if (state.generating && !before.generating) return "GENERATION_STARTED";
    if (Number(state.assistantCount || 0) > Number(before.assistantCount || 0)) return "ASSISTANT_COUNT_INCREMENTED";
    if (state.assistantHash && before.assistantHash && state.assistantHash !== before.assistantHash) return "ASSISTANT_HASH_CHANGED";
    if (before.composerEmpty === false && state.composerEmpty === true) return "COMPOSER_CLEARED";
    return "";
  }

  function materializedUserTurnReceipt(before, state) {
    const beforeCount = Number(before?.userCount);
    const afterCount = Number(state?.userCount);
    const userTurnId = String(state?.lastUserId || "");
    const beforeUserTurnId = String(before?.lastUserId || "");

    if (!Number.isInteger(beforeCount) || beforeCount < 0 ||
        !Number.isInteger(afterCount) || afterCount !== beforeCount + 1 ||
        !userTurnId || userTurnId === beforeUserTurnId) {
      return null;
    }

    return {
      userTurnId,
      userTurnIndex: beforeCount,
      userCount: afterCount,
      userTextHash: String(state?.lastUserHash || "")
    };
  }

  async function publishDispatchMaterialization(dispatchId, promptHash, before, state, evidence) {
    const receipt = materializedUserTurnReceipt(before, state);
    if (!receipt) return null;
    const result = await chrome.runtime.sendMessage({
      type: "EIC_GF_DISPATCH_MATERIALIZED",
      dispatchId: String(dispatchId || ""),
      promptHash: String(promptHash || ""),
      documentId: DOCUMENT_ID,
      evidence: String(evidence || "USER_TURN_MATERIALIZED"),
      receipt
    }).catch(() => null);
    return result?.ok === true ? receipt : null;
  }

  async function waitForMaterialization(before, promptHash, timeoutMs = 15000, expectedComposerHash = "") {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const state = await pageState();
      const evidence = materializationEvidence(before, state, promptHash);
      if (evidence) {
        return {
          acknowledged: true,
          evidence,
          elapsedMs: Date.now() - started,
          state,
          rateLimitDetected: false,
          rateLimitNoEffectConfirmed: false
        };
      }
      if (state.rateLimitWarning?.active === true) {
        const noEffectConfirmed =
          Number(state.userCount || 0) === Number(before.userCount || 0) &&
          state.lastUserHash !== promptHash &&
          state.generating !== true &&
          Boolean(expectedComposerHash) &&
          state.composerTextHash === expectedComposerHash;
        return {
          acknowledged: false,
          evidence: noEffectConfirmed
            ? "RATE_LIMIT_WARNING_COMPOSER_RETAINED_NO_MATERIALIZATION"
            : "RATE_LIMIT_WARNING_EFFECT_UNRESOLVED",
          elapsedMs: Date.now() - started,
          state,
          rateLimitDetected: true,
          rateLimitNoEffectConfirmed: noEffectConfirmed
        };
      }
      await new Promise((resolve) => setTimeout(resolve, document.visibilityState === "hidden" ? 600 : 180));
    }
    return {
      acknowledged: false,
      evidence: "",
      elapsedMs: Date.now() - started,
      state: await pageState(),
      rateLimitDetected: false,
      rateLimitNoEffectConfirmed: false
    };
  }

  async function submitPrompt(prompt, promptHash, dispatchId, safetyContext) {
    const id = String(dispatchId || "");
    if (!id) {
      return { ok: false, effectPossible: false, code: "DISPATCH_ID_REQUIRED", error: "Dispatch id missing.", documentId: DOCUMENT_ID };
    }

    const existing = dispatchRecords.get(id);
    if (existing?.promise) {
      forensic("PROMPT_DISPATCH_IDEMPOTENT_REPLAY", {
        dispatchId: id,
        promptHash,
        documentId: DOCUMENT_ID,
        status: existing.status || ""
      });
      return existing.promise;
    }
    if (existing?.result) {
      forensic("PROMPT_DISPATCH_IDEMPOTENT_RECEIPT", {
        dispatchId: id,
        promptHash,
        documentId: DOCUMENT_ID,
        status: existing.status || ""
      });
      return existing.result;
    }

    const record = {
      dispatchId: id,
      promptHash,
      documentId: DOCUMENT_ID,
      status: "PREPARED",
      effectIssued: false,
      result: null,
      promise: null
    };
    dispatchRecords.set(id, record);

    record.promise = (async () => {
      try {
        const before = await pageState();
        const S = globalThis.GreenfieldSafetyPolicy;
        const modelCheck = S?.evaluateModel(before.modelEvidence, safetyContext?.policy, { url:location.href, gptRoot:safetyContext?.gptRoot });
        if (!safetyContext || !modelCheck?.allowed) throw Object.assign(new Error(modelCheck?.code || "MODEL_PROOF_REQUIRED"), {code:modelCheck?.code || "MODEL_PROOF_REQUIRED"});
        if (before.rateLimitWarning?.active === true) {
          record.status = "NO_EFFECT_RATE_LIMIT_WARNING_ACTIVE";
          record.result = {
            ok: false,
            effectPossible: false,
            dispatchId: id,
            documentId: DOCUMENT_ID,
            code: "RATE_LIMIT_WARNING_ACTIVE",
            error: "A blocking ChatGPT rate-limit warning is active.",
            rateLimitDetected: true,
            rateLimitWarning: before.rateLimitWarning,
            before
          };
          return record.result;
        }
        if (before.generating) {
          record.status = "NO_EFFECT_TARGET_BUSY";
          record.result = {
            ok: false,
            effectPossible: false,
            dispatchId: id,
            documentId: DOCUMENT_ID,
            code: "TARGET_BUSY",
            error: "ChatGPT is already generating.",
            before
          };
          return record.result;
        }
        const composer = getComposer();
        if (!composer) {
          record.status = "NO_EFFECT_COMPOSER_MISSING";
          record.result = {
            ok: false,
            effectPossible: false,
            dispatchId: id,
            documentId: DOCUMENT_ID,
            code: "COMPOSER_MISSING",
            error: "ChatGPT composer was not found.",
            before
          };
          return record.result;
        }

        if (!before.composerEmpty && before.composerTextHash !== await sha256Hex(normalizeText(prompt))) {
          throw Object.assign(new Error("OPERATOR_DRAFT_PRESENT"), {code:"OPERATOR_DRAFT_PRESENT"});
        }
        composer.focus();
        setNativeValue(composer, prompt);
        await new Promise((resolve) => setTimeout(resolve, 120));

        const authorization = await chrome.runtime.sendMessage({
          type:"EIC_GF_AUTHORIZE_DISPATCH", dispatchId:id, promptHash
        });
        if (!authorization?.ok) throw Object.assign(new Error(authorization?.code || "DISPATCH_AUTHORIZATION_FAILED"), {code:authorization?.code || "DISPATCH_AUTHORIZATION_FAILED"});
        const finalProof = S.evaluateModel(globalThis.GreenfieldModelObservation.observe(), authorization.policy, {url:location.href,gptRoot:authorization.gptRoot});
        if (!finalProof.allowed) throw Object.assign(new Error(finalProof.code), {code:finalProof.code});
        const finalComposer = getComposer();
        const finalComposerText = finalComposer instanceof HTMLTextAreaElement || finalComposer instanceof HTMLInputElement
          ? finalComposer.value : finalComposer?.innerText || finalComposer?.textContent || "";
        if (finalComposer !== composer || normalizeText(finalComposerText) !== normalizeText(prompt)) {
          throw Object.assign(new Error("OPERATOR_DRAFT_CHANGED_BEFORE_SEND"), {code:"OPERATOR_DRAFT_CHANGED_BEFORE_SEND"});
        }
        const sendButton = getSendButton();
        if (!sendButton || sendButton.disabled || sendButton.getAttribute("aria-disabled") === "true") {
          throw Object.assign(new Error("SEND_CONTROL_UNAVAILABLE"), {code:"SEND_CONTROL_UNAVAILABLE"});
        }
        // No await from the final UI check through the click. No Enter-key fallback.
        const method = "send-button";
        record.effectIssued = true;
        record.status = "EFFECT_ISSUED";
        sendButton.click();

        forensic("PROMPT_SIDE_EFFECT_ISSUED", {
          dispatchId: id,
          documentId: DOCUMENT_ID,
          method,
          promptHash,
          baselineUserCount: before.userCount,
          baselineAssistantCount: before.assistantCount,
          baselineAssistantHash: before.assistantHash
        });

        const expectedComposerHash = await sha256Hex(normalizeText(prompt));
        const ack = await waitForMaterialization(before, promptHash, 15000, expectedComposerHash);
        const materializedReceipt = await publishDispatchMaterialization(
          id,
          promptHash,
          before,
          ack.state,
          ack.evidence
        );
        if (ack.rateLimitDetected && ack.rateLimitNoEffectConfirmed) {
          record.status = "RATE_LIMIT_REJECTED_NO_EFFECT";
          record.result = {
            ok: false,
            effectPossible: false,
            dispatchId: id,
            documentId: DOCUMENT_ID,
            code: "RATE_LIMIT_REJECTED_NO_EFFECT",
            error: "ChatGPT rate-limit warning rejected the prompt before materialization.",
            rateLimitDetected: true,
            rateLimitNoEffectConfirmed: true,
            rateLimitWarning: ack.state?.rateLimitWarning || null,
            acknowledged: false,
            acknowledgementEvidence: ack.evidence,
            elapsedMs: ack.elapsedMs,
            method,
            before,
            after: ack.state,
            materializedReceipt
          };
          return record.result;
        }

        record.status = ack.acknowledged ? "ACKNOWLEDGED" : "EFFECT_ISSUED_UNCONFIRMED";
        record.result = {
          ok: true,
          effectPossible: true,
          dispatchId: id,
          documentId: DOCUMENT_ID,
          acknowledged: ack.acknowledged,
          acknowledgementEvidence: ack.evidence,
          elapsedMs: ack.elapsedMs,
          method,
          before,
          after: ack.state,
          materializedReceipt,
          rateLimitDetected: ack.rateLimitDetected === true,
          rateLimitNoEffectConfirmed: ack.rateLimitNoEffectConfirmed === true,
          rateLimitWarning: ack.state?.rateLimitWarning || null
        };
        return record.result;
      } catch (error) {
        record.status = record.effectIssued ? "EFFECT_UNKNOWN_ERROR" : "NO_EFFECT_ERROR";
        record.result = {
          ok: false,
          effectPossible: record.effectIssued,
          dispatchId: id,
          documentId: DOCUMENT_ID,
          code: error?.code || error?.name || "CONTENT_SEND_ERROR",
          error: error?.message || String(error)
        };
        forensic("PROMPT_SUBMIT_ERROR", {
          dispatchId: id,
          documentId: DOCUMENT_ID,
          effectPossible: record.effectIssued,
          error: serializeError(error)
        }, "ERROR");
        return record.result;
      } finally {
        record.promise = null;
        // Receipt IDs for older operations cannot authorize a new click: the
        // worker authorizes only its current durable dispatch. Bound memory.
        for (const [oldId,old] of dispatchRecords) {
          if (dispatchRecords.size<=32) break;
          if (oldId!==id && !old.promise) dispatchRecords.delete(oldId);
        }
      }
    })();

    return record.promise;
  }

  function overlayElement() {
    let root = document.getElementById(OVERLAY_ID);
    if (root) return root;
    root = document.createElement("div");
    root.id = OVERLAY_ID;
    root.dataset.eicGfUi = "true";
    root.style.cssText = [
      "position:fixed",
      "right:18px",
      "top:74px",
      "z-index:2147483647",
      "font:600 12px/1.25 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "letter-spacing:.02em",
      "padding:9px 12px",
      "border-radius:12px",
      "background:rgba(7,28,26,.92)",
      "color:#d9fff2",
      "border:1px solid rgba(99,255,196,.45)",
      "box-shadow:0 10px 28px rgba(0,0,0,.28)",
      "backdrop-filter:blur(8px)",
      "pointer-events:none",
      "white-space:pre-line",
      "max-width:460px"
    ].join(";");
    document.documentElement.appendChild(root);
    return root;
  }

  // v1.7.9 overview: background sends static lines plus absolute countdown
  // deadlines; this page ticks the countdown locally between state syncs.
  function formatRemaining(ms) {
    const total = Math.max(0, Math.ceil(Number(ms) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = String(total % 60).padStart(2, "0");
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
  }

  function overlayCountdown(overview) {
    return (Array.isArray(overview?.countdown) ? overview.countdown : [])
      .filter((segment) => segment && Number.isFinite(Number(segment.atMs)) && typeof segment.template === "string");
  }

  function overlayLines(info, now = Date.now()) {
    const processShort = String(info.processId || "").replace(/^process-/, "").slice(0, 8);
    const lines = [`EIC Greenfield v${CONTENT_VERSION} · CONNECTED · ${info.phase || "ACTIVE"} · P:${processShort}`];
    const overview = info.overview && typeof info.overview === "object" ? info.overview : null;
    if (!overview) return lines;
    if (overview.mission) lines.push(String(overview.mission));
    const timed = overlayCountdown(overview)
      .map((segment) => segment.template.replace("{t}", formatRemaining(Number(segment.atMs) - now)));
    if (timed.length) lines.push(timed.join(" · "));
    else if (overview.phaseText) lines.push(String(overview.phaseText));
    if (overview.status) lines.push(String(overview.status));
    return lines;
  }

  function renderOverlay() {
    if (!overlayInfo) return;
    const root = overlayElement();
    const text = overlayLines(overlayInfo).join("\n");
    if (root.textContent !== text) root.textContent = text;
  }

  function stopOverlayTimer() {
    if (overlayTimer) clearInterval(overlayTimer);
    overlayTimer = null;
  }

  function updateOverlay(info) {
    if (!info?.linked) {
      stopOverlayTimer();
      overlayInfo = null;
      overlaySignature = "";
      const existing = document.getElementById(OVERLAY_ID);
      if (!existing) return false;
      existing.remove();
      forensic("MANAGED_TAB_OVERLAY_CLEARED", { reason: info?.reason || "unlinked" });
      return true;
    }
    const { reason: _reason, ...stable } = info;
    const signature = JSON.stringify(stable);
    overlayInfo = info;
    const root = overlayElement();
    const nextTitle = [
      "EIC Autonom Agent",
      info.overview?.title || `Window ${info.windowId ?? "?"}\nTab ${info.tabId ?? "?"}\nProcess ${info.processId || "?"}`
    ].join("\n");
    if (root.title !== nextTitle) root.title = nextTitle;
    renderOverlay();
    if (overlayCountdown(info.overview).length) {
      if (!overlayTimer) overlayTimer = setInterval(renderOverlay, 1000);
    } else {
      stopOverlayTimer();
    }
    if (signature === overlaySignature) return false;
    overlaySignature = signature;
    forensic("MANAGED_TAB_OVERLAY_RENDERED", {
      processId: info.processId || "",
      phase: info.phase || "",
      windowId: info.windowId ?? null,
      tabId: info.tabId ?? null
    });
    return true;
  }

  function scheduleDirty(reason = "dom") {
    if (dirtyTimer) clearTimeout(dirtyTimer);
    dirtyTimer = setTimeout(() => {
      dirtyTimer = null;
      chrome.runtime.sendMessage({
        type: "EIC_GF_OBSERVATION_DIRTY",
        reason
      }).catch?.(() => undefined);
    }, 350);
  }

  function startObserver() {
    observer?.disconnect();
    observer = new MutationObserver(() => scheduleDirty("mutation"));
    const target = document.querySelector("main") || document.body || document.documentElement;
    observer.observe(target, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "data-message-author-role",
        "data-is-streaming",
        "data-testid",
        "aria-busy",
        "aria-disabled",
        "disabled"
      ]
    });
  }

  async function handle(message) {
    if (!message || typeof message.type !== "string") return null;
    if (message.type === "EIC_GF_PING") {
      return { ok: true, version: CONTENT_VERSION, url: location.href };
    }
    if (message.type === "EIC_GF_GET_PAGE_STATE") {
      return {
        ok: true,
        state: await pageState({
          expectedUserTurnId: message.expectedUserTurnId || "",
          expectedUserIndex: Number.isInteger(message.expectedUserIndex) ? message.expectedUserIndex : null
        })
      };
    }
    if (message.type === "EIC_GF_RATE_LIMIT_RECOVERY_PREFLIGHT") {
      return rateLimitRecoveryPreflight();
    }
    if (message.type === "EIC_GF_SUBMIT_PROMPT") {
      const prompt = String(message.prompt || "");
      const promptHash = String(message.promptHash || "");
      if (!prompt || !promptHash) {
        return { ok: false, effectPossible: false, code: "PROMPT_INVALID", error: "Prompt or hash missing." };
      }
      return submitPrompt(prompt, promptHash, message.dispatchId, message.safetyContext);
    }
    if (message.type === "EIC_GF_OVERLAY_UPDATE") {
      return { ok: true, changed: updateOverlay(message.overlay || null) };
    }
    return null;
  }

  const onMessage = (message, _sender, sendResponse) => {
    handle(message)
      .then((result) => {
        if (result !== null) sendResponse(result);
      })
      .catch((error) => {
        forensic("CONTENT_MESSAGE_ERROR", { error: serializeError(error), messageType: message?.type || "" }, "ERROR");
        sendResponse({
          ok: false,
          effectPossible: false,
          code: error?.code || error?.name || "CONTENT_ERROR",
          error: error?.message || String(error)
        });
      });
    return true;
  };

  const onError = (event) => {
    forensic("CONTENT_UNHANDLED_ERROR", {
      error: serializeError(event?.error || new Error(event?.message || "Content error"))
    }, "ERROR");
  };
  const onRejection = (event) => {
    forensic("CONTENT_UNHANDLED_REJECTION", {
      error: serializeError(event?.reason || new Error("Unhandled rejection"))
    }, "ERROR");
  };

  chrome.runtime.onMessage.addListener(onMessage);
  listeners.push(() => chrome.runtime.onMessage.removeListener(onMessage));
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  listeners.push(() => window.removeEventListener("error", onError));
  listeners.push(() => window.removeEventListener("unhandledrejection", onRejection));

  startObserver();
  scheduleDirty("bridge-ready");
  chrome.runtime.sendMessage({ type: "EIC_GF_CONTENT_READY" })
    .then((result) => {
      if (result?.overlay) updateOverlay(result.overlay);
    })
    .catch(() => undefined);

  globalThis[BRIDGE] = {
    version: CONTENT_VERSION,
    documentId: DOCUMENT_ID,
    dispatchRecords,
    dispose() {
      if (dirtyTimer) clearTimeout(dirtyTimer);
      dirtyTimer = null;
      stopOverlayTimer();
      overlayInfo = null;
      observer?.disconnect();
      observer = null;
      document.getElementById(OVERLAY_ID)?.remove();
      for (const dispose of listeners.splice(0)) {
        try { dispose(); } catch {}
      }
    }
  };
})();
