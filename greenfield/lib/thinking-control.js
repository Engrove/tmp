// Composer-only UI adapter. No API calls, guessed model names or prompt edits.
// A receipt is local to this document, URL, selected control and short lifetime.
(() => {
  globalThis.GreenfieldThinkingControl?.dispose?.();
  const excluded = "[data-message-author-role], [data-testid^='conversation-turn'], article, aside, [data-eic-gf-ui='true']";
  let receipt = null, running = null, disposed = false, lastAttempt = null, failedAttempt = null;
  const norm = s => String(s || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const visible = el => {
    if (!el?.isConnected || el.closest(excluded + ", [hidden], [aria-hidden='true'], [inert]")) return false;
    const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  function text(el) {
    const copy = el.cloneNode(true);
    copy.querySelectorAll("[hidden], [aria-hidden='true']").forEach(e => e.remove());
    return norm(copy.textContent).slice(0,240);
  }
  const disabled = el => el.disabled || el.hasAttribute("data-disabled") || Boolean(el.closest("[inert], [aria-disabled='true']"));
  const strongTriggerSelector = "button[data-codex-intelligence-trigger], button[data-composer-navigation-target='reasoning'], button[data-selected-reasoning-effort], button[data-testid*='thinking'], button[data-testid*='reasoning']";
  function trigger() {
    const forms = [...document.querySelectorAll("form")].filter(f =>
      [...f.querySelectorAll("[contenteditable='true'], textarea")].some(visible));
    const strong = forms.flatMap(f => [...f.querySelectorAll(strongTriggerSelector)]).filter(visible);
    const candidates = strong.length ? strong : forms.flatMap(f => [...f.querySelectorAll("button[aria-haspopup]")]).filter(el =>
      visible(el) && !/^(?:remove|ta bort|poista)\b/iu.test(el.getAttribute("aria-label") || "") &&
      (globalThis.GreenfieldSafetyPolicy.effort(text(el)) >= 0 ||
       /thinking|reasoning|tänketid|tänknivå|resonemangsansträngning|päättely|ajattelu/iu.test(text(el) + " " + el.getAttribute("aria-label"))));
    const unique = [...new Set(candidates)];
    return unique.length === 1 ? unique[0] : null;
  }
  function selection(el = trigger()) {
    if (!el) return null;
    return { label:text(el), value:el.getAttribute("data-selected-reasoning-effort") || "",
      model:el.getAttribute("data-selected-model") || "" };
  }
  const key = el => JSON.stringify(selection(el));
  const modelKey = () => JSON.stringify([...document.querySelectorAll(
    "button[data-testid*='model' i], header button[aria-label*='model' i], form button[aria-label*='model' i]"
  )].filter(visible).map(el=>[text(el),el.getAttribute("aria-label") || ""]).sort());
  // v1.9.38: a receipt certifies a selection, not a DOM node. ChatGPT's
  // composer re-commits identical label text, remounts label spans and moves the
  // unchanged control during re-layout (e.g. when the prompt is staged). Those
  // mutations leave label/value/model unchanged and must not revoke the receipt.
  // A definite change revokes it permanently: any write of aria-expanded,
  // data-selected-reasoning-effort or data-selected-model on the control (the
  // framework writes these only on a real transition; a remounted node gets its
  // attributes before insertion), even if a later write in the same batch
  // restored the value; or a recognized non-target level or Pro shown. The
  // trigger shows only the level, so an opened menu may have changed the model
  // invisibly. Any other difference is judged at use time by receiptStatus(),
  // which still demands exact URL, selection, model, closed menu, enabled
  // control and TTL.
  const DEFINITE_ATTRIBUTE_CHANGES = {"aria-expanded":"MENU_OPENED",
    "data-selected-reasoning-effort":"REASONING_VALUE_CHANGED","data-selected-model":"MODEL_CHANGED"};
  function definiteAttributeChange(records, el) {
    // Only composer controls count; conversation turns (e.g. a "thinking"
    // disclosure in an answer) are excluded exactly as in visible().
    const composerControl = node => Boolean(node.closest?.("form")) && !node.closest(excluded);
    for (const r of records) {
      const reason = r.type === "attributes" && DEFINITE_ATTRIBUTE_CHANGES[r.attributeName];
      if (reason && (r.target === el || composerControl(r.target) &&
          (r.target.matches(strongTriggerSelector) || !el && r.target.matches("button[aria-haspopup]")))) return reason;
    }
    return "";
  }
  let receiptInvalidation = null, receiptEvents = [];
  function receiptEvent(kind, el) {
    const now = Date.now(), last = receiptEvents[receiptEvents.length - 1];
    if (last?.kind === kind) { last.count++; last.lastAtMs = now; return; }
    receiptEvents.push({kind, atMs:now, lastAtMs:now, count:1, ageMs:receipt ? now - receipt.verifiedAtMs : null,
      observed:el ? selection(el) : null});
    if (receiptEvents.length > 8) receiptEvents.shift();
  }
  function revokeReceipt(reason, el) {
    if (!receipt) return;
    const now = Date.now();
    receiptInvalidation = {reason, atMs:now, ageMs:now - receipt.verifiedAtMs,
      expected:{label:receipt.label, value:receipt.value}, observed:el ? selection(el) : null};
    receipt = null;
  }
  function definiteChange(el) {
    if (el.getAttribute("aria-expanded") === "true") return "MENU_OPENED";
    const S = globalThis.GreenfieldSafetyPolicy, now = selection(el);
    let expectedModel;
    try { expectedModel = JSON.parse(receipt.selectionKey).model || ""; } catch { return "RECEIPT_KEY_INVALID"; }
    if (now.value && now.value !== receipt.value) return "REASONING_VALUE_CHANGED";
    if (now.model && now.model !== expectedModel) return "MODEL_CHANGED";
    if (/^pro$/iu.test(now.label)) return "PRO_SELECTED";
    if (S.effort(now.label) >= 0 && !S.matchesReasoningLevel(now.label, receipt.reasoningLevel ?? "xhigh")) return "REASONING_LEVEL_CHANGED";
    return "";
  }
  const changes = new MutationObserver(records=>{
    if (!receipt) return;
    const el = trigger();
    const transition = definiteAttributeChange(records, el);
    if (transition) { revokeReceipt(transition, el); return; }
    // Absence is not a selection. Use time requires the control to be present.
    if (!el) { receiptEvent("CONTROL_ABSENT", null); return; }
    const touched = records.some(r=>r.target===el || el.contains(r.target) ||
      [...r.removedNodes, ...r.addedNodes].some(node=>node===el || node.contains?.(el)));
    if (!touched) return;
    const change = definiteChange(el);
    if (change) { revokeReceipt(change, el); return; }
    receiptEvent(key(el) === receipt.selectionKey ? "CONTROL_RERENDERED_SAME_SELECTION" : "CONTROL_TEXT_DIFFERS", el);
  });
  changes.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,
    attributeFilter:["aria-expanded","data-selected-reasoning-effort","data-selected-model","disabled","aria-disabled"]});
  function receiptStatus() {
    const el = trigger();
    const ageMs = receipt ? Date.now() - receipt.verifiedAtMs : null;
    const reason = disposed ? "RECEIPT_DOCUMENT_DISPOSED" : !receipt ? "RECEIPT_MISSING_OR_INVALIDATED"
      : !el || disabled(el) ? "RECEIPT_CONTROL_UNAVAILABLE" : receipt.url !== location.href ? "RECEIPT_URL_CHANGED"
      : receipt.selectionKey !== key(el) || receipt.modelKey !== modelKey() ? "RECEIPT_SELECTION_CHANGED"
      : el.getAttribute("aria-expanded") === "true" ? "RECEIPT_MENU_OPEN"
      : ageMs < -1000 ? "RECEIPT_CLOCK_INVALID" : ageMs > 60000 ? "RECEIPT_TTL_EXPIRED" : "";
    return {currentReceiptValid:!reason,receiptInvalidReason:reason,ageMs,
      expiresAtMs:receipt ? receipt.verifiedAtMs + 60000 : null,ttlMs:60000,
      invalidation:receiptInvalidation ? JSON.parse(JSON.stringify(receiptInvalidation)) : null,
      events:JSON.parse(JSON.stringify(receiptEvents))};
  }
  function proof() {
    return receiptStatus().currentReceiptValid ? { ...receipt } : null;
  }
  function fail(code) { throw Object.assign(new Error(code), {code}); }
  const pause = () => new Promise(resolve => setTimeout(resolve,100));
  const popupSelector = "[role='menu'], [role='listbox'], [role='dialog'], [role='tooltip'], [data-radix-popper-content-wrapper], [data-slot='popover-content']";
  // Some composer controls expose range values without role=slider.
  const sliderSelector = "[role='slider'], input[type='range'], [aria-valuemin][aria-valuemax][aria-valuenow]:not([role='progressbar']):not([role='meter'])";
  const optionSelector = "[role='menuitemradio'],[role='menuitem'],[role='option'],[role='radio'],button";
  const allVisible = selector => [...document.querySelectorAll(selector)].filter(visible);
  function passiveTooltip(el) {
    // Radix may restore the trigger's explanatory tooltip as the menu closes.
    // It is not an open menu, including its popper wrapper. Older reasoning
    // controls do live in tooltips: retain any actual effort surface.
    const tooltip = el.matches("[role='tooltip']") || el.closest("[role='tooltip']") || el.querySelector("[role='tooltip']");
    const interactive = "button,a[href],input,select,textarea,[contenteditable='true'],[role='button'],[role='menuitem'],[role='menuitemradio'],[role='option'],[role='radio'],[tabindex]:not([tabindex='-1'])";
    return Boolean(tooltip) && !el.matches("[role='menu'],[role='listbox'],[role='dialog']") &&
      !el.querySelector("[role='menu'],[role='listbox'],[role='dialog']") &&
      !el.matches(interactive) && ![...el.querySelectorAll(interactive)].some(visible) && !effortSurface(el);
  }
  function popupCandidates(el, previous) {
    if (!el) return [];
    const controlled = (el.getAttribute("aria-controls") || "").split(/\s+/).map(id=>document.getElementById(id)).filter(visible);
    // aria-describedby also references ordinary text, not just popup owners.
    const described = (el.getAttribute("aria-describedby") || "").split(/\s+/).map(id=>document.getElementById(id))
      .filter(p=>visible(p) && (p.matches(popupSelector) || effortSurface(p)));
    const linked = allVisible(popupSelector).filter(p => el.id && (p.getAttribute("aria-labelledby") || "").split(/\s+/).includes(el.id));
    const candidates = [...new Set([...controlled,...described,...linked,...allVisible(popupSelector).filter(p=>!previous.has(p))])]
      .filter(p=>!passiveTooltip(p));
    // Popper wrappers can contain the same menu. Keep the innermost owner.
    return candidates.filter(p => !candidates.some(q=>p!==q && p.contains(q)));
  }
  function popupFor(el, previous) {
    if (!el) return null;
    const roots = popupCandidates(el,previous);
    const withSlider = roots.filter(p=>p.matches(sliderSelector) || p.querySelector(sliderSelector));
    if (withSlider.length === 1) return withSlider[0];
    if (roots.length === 1) return roots[0];
    if (!roots.length) {
      const sliders = allVisible(sliderSelector).filter(p=>!previous.has(p));
      if (sliders.length === 1) return sliders[0];
    }
    return null;
  }
  function pointer(el, entering, relatedTarget = null) {
    if (!el?.isConnected) return;
    const rect = el.getBoundingClientRect();
    const init = {bubbles:true,cancelable:true,pointerType:"mouse",pointerId:1,
      clientX:Number(rect.left || 0)+rect.width/2,clientY:Number(rect.top || 0)+rect.height/2,relatedTarget};
    const Pointer = globalThis.PointerEvent || MouseEvent;
    // React derives enter/leave from over/out. Native listeners may listen
    // directly to enter/leave or to movement; none of these selects a model.
    el.dispatchEvent(new Pointer(entering ? "pointerover" : "pointerout",init));
    el.dispatchEvent(new Pointer(entering ? "pointerenter" : "pointerleave",{...init,bubbles:false}));
    el.dispatchEvent(new MouseEvent(entering ? "mouseover" : "mouseout",init));
    el.dispatchEvent(new MouseEvent(entering ? "mouseenter" : "mouseleave",{...init,bubbles:false}));
    if (entering) {
      el.dispatchEvent(new Pointer("pointermove",init));
      el.dispatchEvent(new MouseEvent("mousemove",init));
    }
  }
  function keypress(el, key) {
    if (!el?.isConnected) return;
    el.dispatchEvent(new KeyboardEvent("keydown",{key,code:key,bubbles:true,cancelable:true}));
    el.dispatchEvent(new KeyboardEvent("keyup",{key,code:key,bubbles:true}));
  }
  function controlSummary(el) {
    if (!el) return null;
    return {tag:el.tagName,role:el.getAttribute("role") || "",label:text(el).slice(0,120),
      id:el.id || "",tabIndex:el.getAttribute("tabindex"),
      ariaLabel:el.getAttribute("aria-label"),valueText:el.getAttribute("aria-valuetext"),
      selected:el.getAttribute("aria-selected"),checked:el.getAttribute("aria-checked"),hasPopup:el.getAttribute("aria-haspopup"),
      expanded:el.getAttribute("aria-expanded"),state:el.getAttribute("data-state"),
      min:el.getAttribute("aria-valuemin") ?? (el.matches("input[type='range']") ? el.min : null),
      max:el.getAttribute("aria-valuemax") ?? (el.matches("input[type='range']") ? el.max : null),
      now:el.getAttribute("aria-valuenow") ?? (el.matches("input[type='range']") ? el.value : null)};
  }
  function surfaceKey() {
    const el=trigger();
    return JSON.stringify({url:location.href,selection:selection(el),model:modelKey(),disabled:el?disabled(el):true,
      trigger:controlSummary(el),popups:allVisible(popupSelector).filter(p=>!passiveTooltip(p)).map(controlSummary),sliders:allVisible(sliderSelector).map(controlSummary)});
  }
  function modelSurface(popup) {
    const options=[...popup.querySelectorAll(optionSelector)].filter(visible);
    // A bare Pro entry in a model list is not a reasoning level.
    return options.some(el=>globalThis.GreenfieldSafetyPolicy.modelVersion(text(el)) || /^\d+(?:\.\d+)*$/u.test(text(el)));
  }
  function namedOptions(popup) {
    const options=[...popup.querySelectorAll(optionSelector)].filter(visible)
      .map(el=>({el,rank:optionRank(el)})).filter(x=>x.rank>=0);
    const distinct=new Set(options.map(x=>x.rank)).size;
    // One unmarked named button may navigate to the model picker. A group of
    // choices or explicit choice semantics is required before clicking it.
    return options.filter(({el})=>!disabled(el) && (distinct>=2 ||
      el.matches("[role='menuitemradio'],[role='radio'],[role='option'],[aria-checked],[aria-selected],[data-reasoning-effort],[data-effort]")));
  }
  function ordinalControls(popup) {
    return collapseAnnouncement(ordinalCandidates(popup),popup);
  }
  // One announced position can be exposed by several nodes: the value text and
  // a control that references it (aria-describedby) or repeats it (aria-label).
  // Identical values with exactly one keyboard target are one control; any
  // other combination stays ambiguous.
  function collapseAnnouncement(found,popup) {
    if (found.length<2 || new Set(found.map(v=>`${v.now}/${v.max}/${v.rank}`)).size!==1) return found;
    const targets=new Set(found.map(v=>ordinalTarget(v,popup)).filter(el=>el!==popup));
    return targets.size===1 ? [{...found[0],el:[...targets][0]}] : found;
  }
  function ordinalCandidates(popup) {
    if (!popup || modelSurface(popup)) return [];
    const found=[];
    for (const el of [popup,...popup.querySelectorAll("[aria-label],[aria-valuetext],[aria-describedby],span,div,p,button,[role]")]) {
      if (!visible(el) || disabled(el)) continue;
      const described=(el.getAttribute("aria-describedby") || "").split(/\s+/)
        .map(id=>document.getElementById(id)).filter(node=>node && popup.contains(node)).map(text);
      const sources=[el.getAttribute("aria-valuetext"),el.getAttribute("aria-label"),...described,text(el)].filter(Boolean);
      const values=[];
      for (const source of sources) {
        const value=norm(source);
        for (const match of value.matchAll(/(?<![\d.])([1-9]\d*)\s*(?:av|of|\/|von|sur|de)\s*([1-9]\d*)(?!\d)/giu)) {
          const now=Number(match[1]),max=Number(match[2]);
          const label=norm(value.slice(0,match.index).replace(/[,;:.\s]+$/u,""));
          const rank=globalThis.GreenfieldSafetyPolicy.effort(label);
          if (now>max || max<2 || max>32 || rank<0 || globalThis.GreenfieldSafetyPolicy.modelVersion(label)) continue;
          values.push({now,max,label,rank});
        }
      }
      // Ancestor text can contain several controls. Never infer one position
      // from contradictory values or levels in that text.
      const keys=new Set(values.map(v=>`${v.now}/${v.max}/${v.rank}`));
      if (keys.size===1) found.push({el,...values[0]});
    }
    return found.filter(a=>!found.some(b=>a!==b && a.el.contains(b.el)));
  }
  function ordinalTarget(control,popup) {
    for (let el=control.el;el && popup.contains(el);el=el.parentElement) {
      if (el.matches("button,input,[tabindex],[role='slider'],[role='spinbutton']")) return el;
      if (el===popup) break;
    }
    // Key events bubble to the control's existing handler; never synthesize
    // a click on a named header or install new DOM attributes/listeners.
    return control.el;
  }
  function effortSurface(popup) {
    if (!popup || modelSurface(popup)) return false;
    if (popup.matches(sliderSelector) || [...popup.querySelectorAll(sliderSelector)].some(visible)) return true;
    return ordinalControls(popup).length>0 || namedOptions(popup).length>0;
  }
  function sliderValues(el) {
    const native = el.matches("input[type='range']");
    const rawMax = native ? el.max || "100" : el.getAttribute("aria-valuemax");
    const rawMin = native ? el.min || "0" : el.getAttribute("aria-valuemin");
    const rawNow = native ? el.value : el.getAttribute("aria-valuenow");
    const max = Number(rawMax), min = Number(rawMin), now = Number(rawNow);
    if (rawMax == null || rawMin == null || rawNow == null || ![max,min,now].every(Number.isFinite) || max <= min || now < min || now > max) return null;
    return {min,max,now};
  }
  function optionRank(el) {
    if (el.hasAttribute("aria-haspopup")) return -1; // model-family submenu
    const value = el.getAttribute("data-reasoning-effort") || el.getAttribute("data-effort") || "";
    const label = text(el);
    if (globalThis.GreenfieldSafetyPolicy.modelVersion(label)) return -1;
    // Do not click arbitrary prose mentioning High/Pro or a model submenu.
    const exact = /^(?:pro|heavy|max|maximum|extra hög|extra high|extra-high|xhigh|extended|utökad|utökat|förlängd|high|hög|deep|djup|djupgående|intensive|intensiv|light|låg|lätt|standard|low|medium|balanced|balanserad|direkt|instant)$/iu;
    if (!value && !exact.test(label)) return -1;
    if (/^pro$/iu.test(label) || /^pro$/iu.test(value)) return 4;
    return globalThis.GreenfieldSafetyPolicy.effort(value || label);
  }
  async function maximize({guard, expectedUrl, reasoningLevel = "xhigh"}) {
    const started = Date.now(), url = location.href;
    const deadline = started + 6000;
    let opened = false, owner = null, previous = new Set(), initialFocus = document.activeElement;
    let outcome = null, stage = "PREFLIGHT", openingMethod = "", recoveredOpenMenu = false;
    const observedSurfaces=[],actions=[];
    let chosenControl=null,selectionStrategy="";
    const recordAction=(type,el)=>{
      if(actions.length<32) actions.push({type,elapsedMs:Date.now()-started,target:controlSummary(el)});
    };
    const captureSurface = () => observedSurfaces.push({stage,trigger:controlSummary(trigger()),
      popups:allVisible(popupSelector).filter(p=>!previous.has(p)).map(controlSummary).slice(0,6),
      sliders:allVisible(sliderSelector).map(controlSummary).slice(0,6)});
    const check = async (limit = deadline) => {
      if (disposed || Date.now() >= limit) fail("THINKING_SELECTION_TIMEOUT");
      if (location.href !== url || expectedUrl && expectedUrl !== url) fail("THINKING_SELECTION_SESSION_CHANGED");
      const verdict = await guard({ownedPopup:opened ? popupFor(trigger() || owner,previous) : null});
      if (!verdict?.ok) fail(verdict?.code || "THINKING_SELECTION_UNSAFE");
      if (disposed || Date.now() >= limit) fail("THINKING_SELECTION_TIMEOUT");
      if (location.href !== url) fail("THINKING_SELECTION_SESSION_CHANGED");
    };
    const poll = async (predicate, limit = deadline) => {
      while (Date.now() < limit) {
        await check(Math.max(limit,deadline));
        const result = predicate();
        if (result) return result;
        await pause();
      }
      return null;
    };
    const until = async predicate => {
      const result=await poll(predicate);
      if (!result) fail("THINKING_SELECTION_TIMEOUT");
      return result;
    };
    const currentPopup = () => popupFor(trigger(),previous);
    const closed = () => {
      const current=trigger();
      // Ambiguous popup ownership is not evidence that all menus are closed.
      return current && current.getAttribute("aria-expanded") !== "true" &&
        popupCandidates(current,previous).length===0 && !currentPopup();
    };
    const closeOwned = async () => {
      const limit=Date.now()+1000;
      await check(limit);
      const current=trigger(), popup=currentPopup();
      // Reacquire the unique composer control. React may replace the element
      // during a selection; referential equality with `owner` is not ownership.
      if (!current) return false;
      if (popup) pointer(popup,false,document.body);
      pointer(current,false,document.body);
      keypress(popup || current,"Escape");
      if (document.activeElement === current || popup?.contains(document.activeElement)) document.activeElement?.blur?.();
      if (initialFocus?.isConnected && initialFocus !== document.body && initialFocus !== current && !popup?.contains(initialFocus)) initialFocus.focus?.({preventScroll:true});
      if (await poll(closed,Math.min(limit,Date.now()+500))) return true;
      // A click is a fallback only for a still-expanded dropdown. Never click
      // a closed model picker to dismiss a hover card.
      if (trigger()?.getAttribute("aria-expanded") === "true") {
        await check(limit);trigger().click();
      }
      return Boolean(await poll(closed,limit));
    };
    try {
      const S = globalThis.GreenfieldSafetyPolicy;
      const requested = S.normalizeReasoningLevel(reasoningLevel);
      const matchesTarget = label => S.matchesReasoningLevel(label, requested);
      await check();
      const cached = proof();
      if (cached && (cached.reasoningLevel ?? "xhigh") === requested) return {ok:true,changed:false,proof:cached};
      if (failedAttempt?.reasoningLevel === requested && failedAttempt.key === surfaceKey() && (!failedAttempt.retryAtMs || Date.now()<failedAttempt.retryAtMs)) {
        lastAttempt={...lastAttempt,suppressedRepeatedActions:true};
        return {...failedAttempt.result,repeated:true,retryAtMs:failedAttempt.retryAtMs || null};
      }
      receipt = null;
      owner = trigger();
      if (!owner || disabled(owner)) fail("THINKING_CONTROL_UNAVAILABLE");
      const prior = selection(owner), priorKey = key(owner);
      previous = new Set([...allVisible(popupSelector),...allVisible(sliderSelector)]);
      // Recover a related model dropdown left open by an earlier attempt.
      // Unrelated popups remain in `previous` and are never dismissed.
      if (owner.getAttribute("aria-expanded") === "true") {
        stage="RECOVER_OPEN_MENU";
        const related=popupFor(owner,previous);
        if (!related) fail("THINKING_MENU_OWNERSHIP_UNVERIFIED");
        opened=true;
        previous.delete(related);
        if (!await closeOwned()) fail("THINKING_MENU_CLOSE_FAILED");
        recoveredOpenMenu=true;opened=false;
      }
      previous = new Set([...allVisible(popupSelector),...allVisible(sliderSelector)]);
      stage="OPEN_REASONING_HOVER";openingMethod="HOVER";opened=true;
      owner=trigger();pointer(owner,true,document.body);
      let popup=await poll(()=>{const p=currentPopup();return effortSurface(p)&&p;},Math.min(deadline,Date.now()+1200));
      captureSurface();
      if (!popup) {
        // Dedicated effort dropdowns also exist. Keyboard activation supports
        // Radix triggers whose open handler is not bound to HTMLElement.click.
        stage="OPEN_REASONING_MENU";openingMethod="KEYBOARD";
        await check();owner=trigger();owner.focus({preventScroll:true});keypress(owner,"ArrowDown");
        popup=await poll(currentPopup,Math.min(deadline,Date.now()+400));
        if (!popup && trigger()?.getAttribute("aria-expanded") !== "true") {
          await check();openingMethod="CLICK";trigger().click();
          popup=await poll(currentPopup,Math.min(deadline,Date.now()+600));
        }
        captureSurface();
        if (!effortSurface(popup)) fail("THINKING_OPTIONS_UNVERIFIED");
      }
      stage="SELECT_REASONING_LEVEL";
      const selectedTarget = () => matchesTarget(selection()?.label);
      const isPro = label => /^pro$/iu.test(norm(label));
      let sliders = [ ...(popup.matches(sliderSelector) ? [popup] : []), ...popup.querySelectorAll(sliderSelector) ].filter(visible);
      sliders = sliders.filter(s=>!sliders.some(t=>s!==t && s.contains(t)));
      let strategy, target, changed = false;
      if (sliders.length > 1) fail("THINKING_CONTROL_AMBIGUOUS");
      const ordinal = sliders.length ? [] : ordinalControls(popup);
      if (ordinal.length > 1) fail("THINKING_CONTROL_AMBIGUOUS");
      if (sliders.length || ordinal.length) {
        strategy = selectionStrategy = sliders.length ? "SLIDER_TARGET" : "ORDINAL_TARGET";
        const readControl = () => {
          const p = currentPopup();
          if (!p || modelSurface(p)) return null;
          if (!sliders.length) {
            const found = ordinalControls(p);
            return found.length === 1 ? {...found[0],min:1,popup:p,el:ordinalTarget(found[0],p)} : null;
          }
          const all = [...(p.matches(sliderSelector)?[p]:[]),...p.querySelectorAll(sliderSelector)].filter(visible);
          const inner = all.filter(a=>!all.some(b=>a!==b && a.contains(b)));
          if (inner.length!==1 || disabled(inner[0])) return null;
          const el = inner[0], values = sliderValues(el);
          if (!values) return null;
          const announcements = ordinalControls(p);
          const announced = announcements.length===1 && announcements[0].now===values.now ? announcements[0].label : "";
          return {...values,el,popup:p,label:el.getAttribute("aria-valuetext") || announced || selection()?.label || ""};
        };
        const before = readControl();
        if (!before) fail("THINKING_SLIDER_UNVERIFIED");
        chosenControl = controlSummary(before.el);
        // Move towards the explicitly named target in either direction. A
        // missing level must not be replaced by the next higher/lower level.
        const targetRank = S.reasoningRank(requested);
        const initialRank = isPro(before.label) ? 4 : S.reasoningRank(before.label);
        if (initialRank < 0) fail("THINKING_TARGET_UNAVAILABLE");
        const direction = initialRank > targetRank ? -1 : 1;
        const seen = new Set();
        let verified = false;
        for (let step=0;step<32;step++) {
          await check();
          const current = readControl();
          if (!current || current.max!==before.max || current.min!==before.min || seen.has(current.now)) fail("THINKING_CONTROL_CHANGED");
          seen.add(current.now);
          if (matchesTarget(current.label)) { target=String(current.now);verified=true;break; }
          const rank = isPro(current.label) ? 4 : S.reasoningRank(current.label);
          if (rank<0 || direction>0 && rank>=targetRank || direction<0 && rank<=targetRank) fail("THINKING_TARGET_UNAVAILABLE");
          if (direction>0 && current.now>=current.max || direction<0 && current.now<=current.min) fail("THINKING_TARGET_UNAVAILABLE");
          // The top can be quota-limited Pro. Without a named target already
          // visible there, do not explore that unknown endpoint. Named menus
          // and already-selected Extra high at the endpoint remain supported.
          const increment=current.el.matches("input[type='range']") ? Number(current.el.step || 1) : 1;
          if (direction>0 && current.now+increment>=current.max) fail("THINKING_TARGET_UNAVAILABLE");
          const el=current.el;
          el.focus?.({preventScroll:true});
          if (el.matches("input[type='range']")) {
            const increment=Number(el.step || 1);
            if (!Number.isFinite(increment) || increment<=0) fail("THINKING_SLIDER_UNVERIFIED");
            const next=Math.max(current.min,Math.min(current.max,current.now+direction*increment));
            recordAction(direction>0 ? "RANGE_STEP_UP" : "RANGE_STEP_DOWN",el);
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,String(next));
            el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));
          } else {
            const key=direction>0?"ArrowRight":"ArrowLeft";
            recordAction(direction>0?"KEY_ARROW_RIGHT":"KEY_ARROW_LEFT",el);keypress(el,key);
          }
          changed=true;
          await until(()=>{const next=readControl();return next && direction*(next.now-current.now)>0;});
        }
        if (!verified) fail("THINKING_TARGET_UNAVAILABLE");
      } else {
        const options = namedOptions(popup).filter(x=>matchesTarget(text(x.el)));
        if (options.length!==1) fail("THINKING_TARGET_UNAVAILABLE");
        const chosen=options[0].el;
        strategy=selectionStrategy="NAMED_TARGET";target=text(chosen);chosenControl=controlSummary(chosen);
        const selected=chosen.getAttribute("aria-checked")==="true" || chosen.getAttribute("aria-selected")==="true";
        if (!selected && !matchesTarget(prior.label)) {
          await check();if(!chosen.isConnected)fail("THINKING_CONTROL_CHANGED");
          recordAction("OPTION_CLICK",chosen);chosen.click();changed=true;
          await until(()=>selectedTarget() && key()!==priorKey);
        }
      }
      await check();
      stage="CLOSE_REASONING";
      if (!await closeOwned()) fail("THINKING_MENU_CLOSE_FAILED");
      opened = false;
      const selected = selection();
      if (!selected || !matchesTarget(selected.label) || changed && key()===priorKey) fail("THINKING_SELECTION_READBACK_FAILED");
      const selectionKey = key();
      await pause(); await check();
      if (key() !== selectionKey) fail("THINKING_SELECTION_READBACK_FAILED");
      receiptInvalidation = null; receiptEvents = [];
      receipt = {status:"VERIFIED",url,verifiedAtMs:Date.now(),selectionKey,modelKey:modelKey(),
        label:selection().label,value:selection().value,strategy,target,reasoningLevel:requested};
      if (!proof()) fail("THINKING_SELECTION_READBACK_FAILED");
      outcome = {ok:true,changed,previous:prior,proof:proof()};
      failedAttempt=null;
      lastAttempt={ok:true,stage:"VERIFIED",openingMethod,recoveredOpenMenu,selected:selection(),strategy:selectionStrategy,chosenControl,actions,observedSurfaces,atMs:Date.now()};
    } catch (error) {
      receipt = null;
      outcome = {ok:false,changed:false,code:error?.code || "THINKING_SELECTION_FAILED",detail:stage};
      lastAttempt={...outcome,stage,openingMethod,recoveredOpenMenu,strategy:selectionStrategy,chosenControl,actions,observedSurfaces,atMs:Date.now(),
        controls:currentPopup()?[...currentPopup().querySelectorAll(optionSelector+",[tabindex],[aria-valuetext],[aria-describedby]")].filter(visible).slice(0,24).map(controlSummary):[],
        ordinalCandidates:ordinalCandidates(currentPopup()).slice(0,8).map(c=>({...controlSummary(c.el),
          describedBy:c.el.getAttribute("aria-describedby"),now:c.now,max:c.max,level:c.label})),
        trigger:controlSummary(trigger()),popup:controlSummary(currentPopup()),sliders:allVisible(sliderSelector).map(controlSummary)};
    } finally {
      if (opened && !disposed && location.href === url) {
        try { if (!await closeOwned()) lastAttempt={...lastAttempt,cleanup:"MENU_STILL_OPEN"}; }
        catch { lastAttempt={...lastAttempt,cleanup:"UNSAFE_OR_UNAVAILABLE"}; }
      }
    }
    if (outcome?.ok === false && ["THINKING_TARGET_UNAVAILABLE","THINKING_OPTIONS_UNVERIFIED","THINKING_SLIDER_UNVERIFIED","THINKING_SELECTION_TIMEOUT","THINKING_SELECTION_READBACK_FAILED","THINKING_CONTROL_AMBIGUOUS","THINKING_CONTROL_CHANGED","THINKING_MENU_CLOSE_FAILED","THINKING_MENU_OWNERSHIP_UNVERIFIED"].includes(outcome.code)) {
      // React/event handlers can recover without changing the DOM key. Every
      // cached UI failure gets a cooldown; retry still runs guard/full readback.
      const retryAtMs=Date.now()+30000;
      failedAttempt={key:surfaceKey(),result:outcome,retryAtMs,reasoningLevel};
      if (retryAtMs) {
        outcome={...outcome,retryAtMs};
        lastAttempt={...lastAttempt,retryAtMs};
      }
    }
    return outcome;
  }
  // Keep the bridge API name for compatibility. The requested slot level is
  // authoritative; missing legacy configuration defaults to Extra high.
  function ensureHighest(options) {
    if (running) return Promise.resolve({ok:false,code:"THINKING_SELECTION_BUSY"});
    running = maximize(options).finally(()=>{running=null;});
    return running;
  }
  globalThis.GreenfieldThinkingControl = Object.freeze({
    ensureHighest, proof, receiptStatus, selection, trigger,
    diagnostics() {return lastAttempt ? {...lastAttempt} : null;},
    retry() {failedAttempt=null;},
    dispose() {disposed=true;receipt=null;changes.disconnect();}
  });
})();
