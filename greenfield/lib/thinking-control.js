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
  // Some composer controls expose range values without role=slider.
  const sliderSelector = "[role='slider'], input[type='range'], [aria-valuemin][aria-valuemax][aria-valuenow]:not([role='progressbar']):not([role='meter'])";
  const optionSelector = "[role='menuitemradio'],[role='menuitem'],[role='option'],[role='radio'],button";
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
      trigger:controlSummary(el),popups:allVisible(popupSelector).map(controlSummary),sliders:allVisible(sliderSelector).map(controlSummary)});
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
      let strategy, target, changed = false, verifiedRank=null;
      if (sliders.length === 1) {
        const slider = sliders[0], before = sliderValues(slider);
        if (!before || disabled(slider)) fail("THINKING_SLIDER_UNVERIFIED");
        strategy = selectionStrategy = "SLIDER_MAXIMUM"; target = String(before.max);chosenControl=controlSummary(slider);
        changed = before.now !== before.max;
        if (changed) {
          await check();
          if (!slider.isConnected || currentPopup()!==popup) fail("THINKING_CONTROL_CHANGED");
          slider.focus({preventScroll:true});
          if (slider.matches("input[type='range']")) {
            recordAction("RANGE_MAXIMUM",slider);
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(slider,target);
            slider.dispatchEvent(new Event("input",{bubbles:true}));
            slider.dispatchEvent(new Event("change",{bubbles:true}));
          } else {
            recordAction("KEY_END",slider);keypress(slider,"End");
            const readRange=()=>{
              const p=currentPopup();
              if (!p || modelSurface(p)) return null;
              const matches=[...(p.matches(sliderSelector)?[p]:[]),...p.querySelectorAll(sliderSelector)].filter(visible);
              const inner=matches.filter(s=>!matches.some(t=>s!==t && s.contains(t)));
              if(inner.length!==1 || disabled(inner[0]))return null;
              const values=sliderValues(inner[0]);
              return values && values.max===before.max && values.min===before.min ? {el:inner[0],...values} : null;
            };
            // Custom ranges may implement only Left/Right. Reacquire after
            // every event because React can replace both trigger and control.
            const atMaximum=await poll(()=>{const c=readRange();return c?.now===before.max;},Math.min(deadline,Date.now()+250));
            if(!atMaximum)for(let step=0;step<32;step++){
              await check();const current=readRange();
              if(!current)fail("THINKING_CONTROL_CHANGED");
              if(current.now===before.max)break;
              current.el.focus({preventScroll:true});recordAction("KEY_ARROW_RIGHT",current.el);keypress(current.el,"ArrowRight");
              await until(()=>{const next=readRange();return next && next.now>current.now;});
            }
          }
        }
        await until(()=>{
          const activePopup = currentPopup();
          const current = activePopup?.matches(sliderSelector) ? activePopup : activePopup?.querySelector(sliderSelector);
          const value = current && visible(current) && !disabled(current) && sliderValues(current);
          return value && value.max === before.max && value.now === value.max && (!changed || key() !== priorKey);
        });
      } else if (!sliders.length) {
        const ordinal=ordinalControls(popup);
        if (ordinal.length>1) fail("THINKING_CONTROL_AMBIGUOUS");
        if (ordinal.length===1) {
          const before=ordinal[0];strategy=selectionStrategy="ORDINAL_MAXIMUM";target=String(before.max);
          chosenControl=controlSummary(ordinalTarget(before,popup));changed=before.now!==before.max;
          const readOrdinal=()=>{
            const p=currentPopup(),values=ordinalControls(p);
            return values.length===1 && values[0].max===before.max ? {...values[0],popup:p} : null;
          };
          // The announced denominator is the available maximum. Do not
          // click the adjacent named button when this level is already set.
          for(let step=0;step<32;step++){
            await check();const current=readOrdinal();
            if(!current)fail("THINKING_CONTROL_CHANGED");
            if(current.now===before.max){verifiedRank=current.rank;break;}
            const targetControl=ordinalTarget(current,current.popup);
            targetControl.focus?.({preventScroll:true});recordAction("KEY_ARROW_RIGHT",targetControl);keypress(targetControl,"ArrowRight");
            await until(()=>{const next=readOrdinal();return next && next.now>current.now;});
          }
          if(verifiedRank===null)fail("THINKING_SELECTION_TIMEOUT");
        } else {
          const options = namedOptions(popup);
          const highest = Math.max(-1,...options.map(x=>x.rank));
          const best = options.filter(x=>x.rank===highest);
          if (highest < 2 || best.length !== 1) fail("THINKING_OPTIONS_UNVERIFIED");
          const chosen = best[0].el, targetLabel = text(chosen);
          strategy = selectionStrategy = "HIGHEST_AVAILABLE_OPTION"; target = targetLabel;verifiedRank=highest;chosenControl=controlSummary(chosen);
          const selected = chosen.getAttribute("aria-checked") === "true" || chosen.getAttribute("aria-selected") === "true";
          const priorRank=/^pro$/iu.test(prior.label)?4:globalThis.GreenfieldSafetyPolicy.effort(prior.label || prior.value);
          if (!selected && priorRank!==highest) { await check();if(!chosen.isConnected)fail("THINKING_CONTROL_CHANGED");recordAction("OPTION_CLICK",chosen);chosen.click(); changed = true; }
          // An already-selected maximum needs no transition. Its name may
          // be hidden by a generic trigger label until the menu is closed.
          if(changed)await until(()=>{
            const current = selection();
            const rank = current && (/^pro$/iu.test(current.label) ? 4 : globalThis.GreenfieldSafetyPolicy.effort(current.label || current.value));
            return rank === highest && key() !== priorKey;
          });
        }
      } else fail("THINKING_CONTROL_AMBIGUOUS");
      await check();
      stage="CLOSE_REASONING";
      if (!await closeOwned()) fail("THINKING_MENU_CLOSE_FAILED");
      opened = false;
      const selected = selection();
      if (!selected || globalThis.GreenfieldSafetyPolicy.effort(selected.label) === 0) fail("THINKING_SELECTION_READBACK_FAILED");
      const selectedRank=strategy==="HIGHEST_AVAILABLE_OPTION" && /^pro$/iu.test(selected.label) ? 4 : globalThis.GreenfieldSafetyPolicy.effort(selected.label || selected.value);
      if ((verifiedRank!==null && selectedRank!==verifiedRank) || (changed && key()===priorKey)) fail("THINKING_SELECTION_READBACK_FAILED");
      const selectionKey = key();
      await pause(); await check();
      if (key() !== selectionKey) fail("THINKING_SELECTION_READBACK_FAILED");
      receipt = {status:"VERIFIED",url,verifiedAtMs:Date.now(),selectionKey,modelKey:modelKey(),
        label:selection().label,value:selection().value,strategy,target};
      if (!proof()) fail("THINKING_SELECTION_READBACK_FAILED");
      outcome = {ok:true,changed,previous:prior,proof:proof()};
      failedAttempt=null;
      lastAttempt={ok:true,stage:"VERIFIED",openingMethod,recoveredOpenMenu,selected:selection(),strategy:selectionStrategy,chosenControl,actions,observedSurfaces,atMs:Date.now()};
    } catch (error) {
      receipt = null;
      outcome = {ok:false,changed:false,code:error?.code || "THINKING_SELECTION_FAILED",detail:stage};
      lastAttempt={...outcome,stage,openingMethod,recoveredOpenMenu,strategy:selectionStrategy,chosenControl,actions,observedSurfaces,atMs:Date.now(),
        controls:currentPopup()?[...currentPopup().querySelectorAll(optionSelector+",[tabindex],[aria-valuetext],[aria-describedby]")].filter(visible).slice(0,24).map(controlSummary):[],
        trigger:controlSummary(trigger()),popup:controlSummary(currentPopup()),sliders:allVisible(sliderSelector).map(controlSummary)};
    } finally {
      if (opened && !disposed && location.href === url) {
        try { if (!await closeOwned()) lastAttempt={...lastAttempt,cleanup:"MENU_STILL_OPEN"}; }
        catch { lastAttempt={...lastAttempt,cleanup:"UNSAFE_OR_UNAVAILABLE"}; }
      }
    }
    if (outcome?.ok === false && ["THINKING_OPTIONS_UNVERIFIED","THINKING_SLIDER_UNVERIFIED","THINKING_SELECTION_TIMEOUT","THINKING_SELECTION_READBACK_FAILED","THINKING_CONTROL_AMBIGUOUS","THINKING_CONTROL_CHANGED","THINKING_MENU_CLOSE_FAILED","THINKING_MENU_OWNERSHIP_UNVERIFIED"].includes(outcome.code)) {
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
