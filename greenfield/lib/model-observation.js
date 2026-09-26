(() => {
  const excluded = "[data-message-author-role], [data-testid^='conversation-turn'], article, [data-eic-gf-ui='true'], aside";
  const visible = el => {
    if (!el || el.closest(excluded)) return false;
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden" && el.getAttribute("aria-hidden") !== "true";
  };
  const label = el => [el.innerText || el.textContent || "", el.getAttribute("aria-label") || ""].join(" ").replace(/\s+/g," ").trim().slice(0,240);
  const normalized = s => String(s || "").normalize("NFKC").toLowerCase().replace(/\s+/g," ").trim();
  function controls(selectors) {
    return [...new Set(selectors.flatMap(s => [...document.querySelectorAll(s)]))].filter(visible);
  }
  function parseCurrentModelNotice(text) {
    // Only an explicit current-use statement. Family/marketing names are
    // intentionally generic so future labels (for example Astra or a later
    // family) do not require a release.
    const s = String(text || "").replace(/\s+/g," ").trim();
    const lead = s.match(/(?:du\s+använder|you\s+are\s+(?:currently\s+)?using|you['’]re\s+(?:currently\s+)?using|käytät|käytössäsi\s+on)\s+(.{0,120})/iu)?.[1] || "";
    if (!lead) return "";
    const localized = lead.replace(/\s+-malli(?:a|ä|ssa|ssä)?\b.*$/iu, "");
    return localized.match(/\bGPT[- ]\d+(?:\.\d+){0,3}(?:\s+[A-Za-z0-9_-]+){0,2}/iu)?.[0] || "";
  }
  function parseRecommendedModel(text) {
    const s = String(text || "").replace(/\s+/g," ").trim();
    if (!/(?:recommended\s+model|creator.{0,30}recommend|rekommenderad(?:e)?\s+modell|skaparens.{0,30}rekommender|suositeltu\s+malli|suosittelee.{0,30}malli)/iu.test(s)) return "";
    return s.match(/\bGPT[- ]\d+(?:\.\d+){0,3}(?:\s+[A-Za-z0-9_-]+){0,2}/iu)?.[0] || "";
  }

  function resolveModelLabels(labels, S) {
    const unique = [...new Set(labels.map(s => String(s || "").trim()).filter(Boolean))];
    if (!unique.length) return { label:"", ambiguous:false };
    const degradedStates = [...new Set(unique.map(item => S.degradedModelSignal?.(item) ? "degraded" : "normal"))];
    if (degradedStates.length > 1) return { label:"", ambiguous:true };
    const byVersion = new Map();
    const unversioned = [];
    for (const item of unique) {
      const v = S.modelVersion?.(item);
      if (v) {
        const key = v.parts.join(".");
        if (!byVersion.has(key)) byVersion.set(key,[]);
        byVersion.get(key).push(item);
      } else {
        unversioned.push(item);
      }
    }
    if (byVersion.size > 1) return { label:"", ambiguous:true };
    if (byVersion.size === 1) {
      const values = [...byVersion.values()][0];
      // Prefer the shortest clean descriptor when several controls expose the
      // same numeric version with different family/assistive wording.
      return { label:[...values].sort((a,b)=>a.length-b.length)[0], ambiguous:false };
    }
    const semantic = [...new Set(unversioned.map(normalized))];
    return semantic.length === 1 ? {label:unique[0],ambiguous:false} : {label:"",ambiguous:true};
  }

  function resolveEffortLabels(labels, S) {
    const unique = [...new Set(labels.map(s => String(s || "").trim()).filter(Boolean))];
    if (!unique.length) return { label:"", ambiguous:false };
    const ranked = unique.map(item => ({item,rank:S.effort?.(item) ?? -1}));
    const knownRanks = [...new Set(ranked.filter(x=>x.rank >= 0).map(x=>x.rank))];
    if (knownRanks.length > 1) return { label:"", ambiguous:true };
    if (knownRanks.length === 1) {
      const candidates = ranked.filter(x=>x.rank === knownRanks[0]).map(x=>x.item);
      return { label:[...candidates].sort((a,b)=>a.length-b.length)[0], ambiguous:false };
    }
    const semantic = [...new Set(unique.map(normalized))];
    return semantic.length === 1 ? {label:unique[0],ambiguous:false} : {label:"",ambiguous:true};
  }

  function observe() {
    const S = globalThis.GreenfieldSafetyPolicy;

    // Known selectors remain first. Generic selector/aria fallbacks are
    // deliberately restricted to interactive controls and later filtered.
    const modelElements = controls([
      "button[data-testid='model-switcher-dropdown-button']",
      "button[data-testid='model-selector']",
      "button[data-testid='model-picker-button']",
      "button[data-testid*='model' i]",
      "[role='button'][data-testid*='model' i]",
      "header button[aria-label*='model' i]",
      "header [role='button'][aria-label*='model' i]",
      "form button[aria-label*='model' i]",
      "form [role='button'][aria-label*='model' i]"
    ]).filter(el => {
      const t = label(el);
      const testid = String(el.getAttribute("data-testid") || "").toLowerCase();
      const aria = String(el.getAttribute("aria-label") || "").toLowerCase();
      return /\bgpt[- ]?\d/iu.test(t) ||
        /(model-switcher|model-selector|model-picker)/u.test(testid) ||
        ((/model|modell/u.test(aria)) && (el.hasAttribute("aria-haspopup") || /selector|switcher|picker/u.test(testid)));
    });
    const controlLabels = [...new Set(modelElements.map(label).filter(Boolean))];

    const noticeElements = controls([
      "header", "[role='banner']", "[data-testid='gpt-model-warning']",
      "[data-testid='model-recommendation-banner']", "[data-testid*='model' i]"
    ]);
    const noticeLabels = [...new Set(noticeElements
      .map(e=>parseCurrentModelNotice((e.innerText || e.textContent || "").slice(0,1200))).filter(Boolean))];
    const recommendationLabels = [...new Set(noticeElements
      .map(e=>parseRecommendedModel((e.innerText || e.textContent || "").slice(0,1200))).filter(Boolean))];

    // Explicit "you are using ..." evidence wins over generic model controls.
    // Different family names with the same numeric version are not ambiguous.
    const resolvedModel = resolveModelLabels(noticeLabels.length ? noticeLabels : controlLabels, S);

    const structuralEffortElements = controls([
      "button[data-testid='reasoning-effort-selector']",
      "button[data-testid='thinking-effort-dropdown-button']",
      "button[data-testid='thinking-time-menu-trigger']",
      "button[data-testid*='reasoning' i]",
      "button[data-testid*='thinking' i]",
      "button[aria-label*='Thinking time' i]",
      "button[aria-label*='Reasoning effort' i]",
      "button[aria-label*='Tänketid' i]",
      "button[aria-label*='Tänknivå' i]",
      "button[aria-label*='Ajattelu' i]",
      "button[aria-label*='Päättely' i]"
    ]);

    // The selected effort chip may have no stable test id. The composer-local
    // control is stronger evidence than generic document controls, so when one
    // exists it owns effort resolution. This prevents unrelated UI controls
    // such as Swedish "Nåla fast Djupanalys ..." from contaminating the rank.
    const composer = document.querySelector("#prompt-textarea");
    const composerEffortElements = [];
    for (const button of composer?.closest("form")?.querySelectorAll("button") || []) {
      if (!visible(button)) continue;
      const t = label(button);
      if ((S.effort?.(t) ?? -1) >= 0 || S.reasoningSignal?.(t)) composerEffortElements.push(button);
    }
    // v1.8.6: ChatGPT's newer composer has no effort chip; the model picker
    // ("Välj ChatGPT-modell") shows the selected thinking level as its text,
    // e.g. "Extra hög" or "Direkt". A picker whose text ranks as an effort is
    // the selected-effort control when neither source above exists.
    const switcherEffortElements = modelElements.filter(el => (S.effort?.(label(el)) ?? -1) >= 0);
    const effortElements = [...new Set(
      composerEffortElements.length ? composerEffortElements
        : structuralEffortElements.length ? structuralEffortElements
          : switcherEffortElements
    )];
    const effortLabels = [...new Set(effortElements.map(label).filter(Boolean))];
    const resolvedEffort = resolveEffortLabels(effortLabels, S);
    const effortEvidenceSource = composerEffortElements.length
      ? "COMPOSER_SELECTED_CONTROL"
      : structuralEffortElements.length
        ? "STRUCTURAL_REASONING_CONTROL"
        : switcherEffortElements.length
          ? "MODEL_SWITCHER_SELECTED_EFFORT"
          : "NONE";

    const selectedModes = controls(["[role='tab'][aria-selected='true']", "button[aria-pressed='true']", "[data-testid='chat-mode-selector'] [data-state='active']"]);
    const modeLabels = selectedModes.map(e => (e.innerText || e.textContent || "").trim().toLowerCase());
    const mode = modeLabels.includes("work") ? "WORK" : modeLabels.includes("codex") ? "CODEX" : "CHAT";

    const notices = controls([
      "[role='alert']", "[role='alertdialog']", "[role='dialog']", "[aria-modal='true']",
      "[data-testid*='usage-limit']", "[data-testid*='rate-limit']", "[data-testid='model-fallback-notice']",
      "form [role='status']"
    ]);
    let quota = { active:false };
    for (const notice of notices) {
      const text = (notice.innerText || notice.textContent || "").replace(/\s+/g," ").trim();
      if (!S.quotaSignal(text)) continue;
      const reset = S.resetTime(text,Date.now(),notice.querySelector("time[datetime]")?.getAttribute("datetime") || "");
      quota = { active:true, text:text.slice(0,600), signature:text.slice(0,600), resetAtMs:reset.atMs, resetConfidence:reset.confidence };
      break;
    }

    const ambiguous = resolvedModel.ambiguous || resolvedEffort.ambiguous;
    return {
      source:"CHATGPT_UI_CONTROLS_V1",
      observedAtMs:Date.now(),
      modelLabel:resolvedModel.label,
      effortLabel:resolvedEffort.label,
      reasoningControlSeen:effortElements.length > 0,
      effortControlSeen:effortElements.length > 0,
      ambiguous,
      ambiguityKind:resolvedModel.ambiguous ? "model" : resolvedEffort.ambiguous ? "effort" : "",
      mode, quota,
      blockingUi:notices.some(e=>e.matches("[role='dialog'],[role='alertdialog'],[aria-modal='true']") && !S.quotaSignal(e.innerText || e.textContent || "")),
      adapterVersion:5,
      effortEvidenceSource,
      controlsSeen:{
        model:controlLabels,
        effort:effortLabels,
        currentUseNotices:noticeLabels,
        recommendations:recommendationLabels
      }
    };
  }
  globalThis.GreenfieldModelObservation = Object.freeze({
    observe, parseCurrentModelNotice, parseRecommendedModel, resolveModelLabels, resolveEffortLabels
  });
})();
