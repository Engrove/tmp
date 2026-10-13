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
  function trigger() {
    const forms = [...document.querySelectorAll("form")].filter(f =>
      [...f.querySelectorAll("[contenteditable='true'], textarea")].some(visible));
    const strong = forms.flatMap(f => [...f.querySelectorAll(
      "button[data-codex-intelligence-trigger], button[data-composer-navigation-target='reasoning'], button[data-selected-reasoning-effort], button[data-testid*='thinking'], button[data-testid*='reasoning']"
    )]).filter(visible);
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
  const changes = new MutationObserver(records=>{
    if (!receipt) return;
    const el = trigger();
    if (!el || records.some(r=>r.target===el || el.contains(r.target) ||
        [...r.removedNodes].some(node=>node===el || node.contains?.(el)))) receipt = null;
  });
  changes.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,
    attributeFilter:["aria-expanded","data-selected-reasoning-effort","data-selected-model","disabled","aria-disabled"]});
  function proof() {
    const el = trigger();
    if (disposed || !receipt || !el || disabled(el) || receipt.url !== location.href ||
        receipt.selectionKey !== key(el) || receipt.modelKey !== modelKey() || Date.now() - receipt.verifiedAtMs > 60000 ||
        el.getAttribute("aria-expanded") === "true") return null;
    return { ...receipt };
  }
  function fail(code) { throw Object.assign(new Error(code), {code}); }
  const pause = () => new Promise(resolve => setTimeout(resolve,100));
  const popupSelector = "[role='menu'], [role='listbox'], [role='dialog'], [role='tooltip'], [data-radix-popper-content-wrapper], [data-slot='popover-content']";
  const sliderSelector = "[role='slider'], input[type='range']";
  const allVisible = selector => [...document.querySelectorAll(selector)].filter(visible);
  function popupFor(el, previous) {
    if (!el) return null;
    const controlled = [el.getAttribute("aria-controls"),el.getAttribute("aria-describedby")].filter(Boolean).join(" ").split(/\s+/).map(id=>document.getElementById(id)).filter(visible);
    const linked = allVisible(popupSelector).filter(p => el.id && (p.getAttribute("aria-labelledby") || "").split(/\s+/).includes(el.id));
    const candidates = [...new Set([...controlled,...linked,...allVisible(popupSelector).filter(p=>!previous.has(p))])];
    // Popper wrappers can contain the same menu. Keep the innermost owner.
    const roots = candidates.filter(p => !candidates.some(q=>p!==q && p.contains(q)));
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
      expanded:el.getAttribute("aria-expanded"),state:el.getAttribute("data-state"),
      min:el.getAttribute("aria-valuemin") ?? (el.matches("input[type='range']") ? el.min : null),
      max:el.getAttribute("aria-valuemax") ?? (el.matches("input[type='range']") ? el.max : null),
      now:el.getAttribute("aria-valuenow") ?? (el.matches("input[type='range']") ? el.value : null)};
  }
  function surfaceKey() {
    const el=trigger();
    return JSON.stringify({url:location.href,selection:selection(el),model:modelKey(),disabled:el?disabled(el):true,
      trigger:controlSummary(el),popups:allVisible(popupSelector).map(controlSummary),sliders:allVisible(sliderSelector).map(controlSummary)});
  }
  function effortSurface(popup) {
    if (!popup) return false;
    if (popup.matches(sliderSelector) || [...popup.querySelectorAll(sliderSelector)].some(visible)) return true;
    const options=[...popup.querySelectorAll("[role='menuitemradio'],[role='menuitem'],[role='option'],[role='radio'],button")].filter(visible);
    // A bare Pro entry in a model list is not a reasoning level.
    if (options.some(el=>globalThis.GreenfieldSafetyPolicy.modelVersion(text(el)) || /^\d+(?:\.\d+)*$/u.test(text(el)))) return false;
    return options.some(el=>optionRank(el)>=0);
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
    const exact = /^(?:pro|heavy|max|maximum|extra hög|extra high|extra-high|xhigh|extended|utökad|utökat|förlängd|high|hög|deep|djup|djupgående|intensive|intensiv|light|standard|low|medium|balanced|balanserad|direkt|instant)$/iu;
    if (!value && !exact.test(label)) return -1;
    if (/^pro$/iu.test(label) || /^pro$/iu.test(value)) return 4;
    return globalThis.GreenfieldSafetyPolicy.effort(value || label);
  }
  async function maximize({guard, expectedUrl}) {
    const started = Date.now(), url = location.href;
    const deadline = started + 6000;
    let opened = false, owner = null, previous = new Set(), initialFocus = document.activeElement;
    let outcome = null, stage = "PREFLIGHT", openingMethod = "", recoveredOpenMenu = false;
    const observedSurfaces=[];
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
    const closed = () => trigger()?.getAttribute("aria-expanded") !== "true" && !currentPopup();
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
      await check();
      const cached = proof();
      if (cached) return {ok:true,changed:false,proof:cached};
      if (failedAttempt?.key === surfaceKey()) {
        lastAttempt={...lastAttempt,suppressedRepeatedActions:true};
        return {...failedAttempt.result,repeated:true};
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
      stage="SELECT_MAXIMUM";
      let sliders = [ ...(popup.matches(sliderSelector) ? [popup] : []), ...popup.querySelectorAll(sliderSelector) ].filter(visible);
      sliders = sliders.filter(s=>!sliders.some(t=>s!==t && s.contains(t)));
      let strategy, target, changed = false;
      if (sliders.length === 1) {
        const slider = sliders[0], before = sliderValues(slider);
        if (!before || disabled(slider)) fail("THINKING_SLIDER_UNVERIFIED");
        strategy = "SLIDER_MAXIMUM"; target = String(before.max);
        changed = before.now !== before.max;
        if (changed) {
          await check();
          slider.focus({preventScroll:true});
          if (slider.matches("input[type='range']")) {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(slider,target);
            slider.dispatchEvent(new Event("input",{bubbles:true}));
            slider.dispatchEvent(new Event("change",{bubbles:true}));
          } else {
            slider.dispatchEvent(new KeyboardEvent("keydown",{key:"End",code:"End",bubbles:true,cancelable:true}));
            slider.dispatchEvent(new KeyboardEvent("keyup",{key:"End",code:"End",bubbles:true}));
          }
        }
        await until(()=>{
          const activePopup = currentPopup();
          const current = activePopup?.matches(sliderSelector) ? activePopup : activePopup?.querySelector(sliderSelector);
          const value = current && visible(current) && !disabled(current) && sliderValues(current);
          return value && value.max === before.max && value.now === value.max && (!changed || key() !== priorKey);
        });
      } else if (!sliders.length) {
        const options = [...popup.querySelectorAll("[role='menuitemradio'], [role='menuitem'], [role='option'], [role='radio'], button")]
          .filter(el=>visible(el) && !disabled(el)).map(el=>({el,rank:optionRank(el)})).filter(x=>x.rank>=0);
        const highest = Math.max(-1,...options.map(x=>x.rank));
        const best = options.filter(x=>x.rank===highest);
        if (highest < 2 || best.length !== 1) fail("THINKING_OPTIONS_UNVERIFIED");
        const chosen = best[0].el, targetLabel = text(chosen);
        strategy = "HIGHEST_AVAILABLE_OPTION"; target = targetLabel;
        const selected = chosen.getAttribute("aria-checked") === "true" || chosen.getAttribute("aria-selected") === "true";
        if (!selected) { await check(); chosen.click(); changed = true; }
        await until(()=>{
          const current = selection();
          const rank = current && (/^pro$/iu.test(current.label) ? 4 : globalThis.GreenfieldSafetyPolicy.effort(current.label || current.value));
          return rank === highest && (!changed || key() !== priorKey);
        });
      } else fail("THINKING_CONTROL_AMBIGUOUS");
      await check();
      stage="CLOSE_REASONING";
      if (!await closeOwned()) fail("THINKING_MENU_CLOSE_FAILED");
      opened = false;
      const selected = selection();
      if (!selected || globalThis.GreenfieldSafetyPolicy.effort(selected.label) === 0) fail("THINKING_SELECTION_READBACK_FAILED");
      const selectionKey = key();
      await pause(); await check();
      if (key() !== selectionKey) fail("THINKING_SELECTION_READBACK_FAILED");
      receipt = {status:"VERIFIED",url,verifiedAtMs:Date.now(),selectionKey,modelKey:modelKey(),
        label:selection().label,value:selection().value,strategy,target};
      if (!proof()) fail("THINKING_SELECTION_READBACK_FAILED");
      outcome = {ok:true,changed,previous:prior,proof:proof()};
      failedAttempt=null;
      lastAttempt={ok:true,stage:"VERIFIED",openingMethod,recoveredOpenMenu,selected:selection(),observedSurfaces,atMs:Date.now()};
    } catch (error) {
      receipt = null;
      outcome = {ok:false,changed:false,code:error?.code || "THINKING_SELECTION_FAILED",detail:stage};
      lastAttempt={...outcome,stage,openingMethod,recoveredOpenMenu,observedSurfaces,atMs:Date.now(),
        trigger:controlSummary(trigger()),popup:controlSummary(currentPopup()),sliders:allVisible(sliderSelector).map(controlSummary)};
    } finally {
      if (opened && !disposed && location.href === url) {
        try { if (!await closeOwned()) lastAttempt={...lastAttempt,cleanup:"MENU_STILL_OPEN"}; }
        catch { lastAttempt={...lastAttempt,cleanup:"UNSAFE_OR_UNAVAILABLE"}; }
      }
    }
    if (outcome?.ok === false && ["THINKING_OPTIONS_UNVERIFIED","THINKING_SLIDER_UNVERIFIED","THINKING_SELECTION_TIMEOUT","THINKING_MENU_CLOSE_FAILED","THINKING_MENU_OWNERSHIP_UNVERIFIED"].includes(outcome.code)) {
      failedAttempt={key:surfaceKey(),result:outcome};
    }
    return outcome;
  }
  function ensureHighest(options) {
    if (running) return Promise.resolve({ok:false,code:"THINKING_SELECTION_BUSY"});
    running = maximize(options).finally(()=>{running=null;});
    return running;
  }
  globalThis.GreenfieldThinkingControl = Object.freeze({
    ensureHighest, proof, selection, trigger,
    diagnostics() {return lastAttempt ? {...lastAttempt} : null;},
    retry() {failedAttempt=null;},
    dispose() {disposed=true;receipt=null;changes.disconnect();}
  });
})();
