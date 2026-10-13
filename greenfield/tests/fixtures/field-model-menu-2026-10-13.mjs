// Open reasoning menu modelled on field diagnostics 2026-10-13T10:50:43Z and
// ChatGPT's sv-SE strings composer.modelPicker.workPower.keyboardControl.*.
// The open menu DOM was not captured; see rare/evidence_log.md (E302, E304, A301).
// Variants: describedby = Prestanda references the announcement (A301a),
// arialabel = an element repeats it as aria-label (A301b), plain = text only,
// twin = two separate keyboard controls with identical announcements.
const MAX=4,names=['Balanserad','Hög','Hög','Extra hög'];
const nameAt=p=>names[p-1];
const effortAttr=p=>p===MAX?'max':p>=2?'high':'medium';
export const fieldUrl='https://chatgpt.com/g/g-69e0b4be34308191aa6c05db1908be1b-eic';

export function fieldModelMenu({JSDOM,policy,observation,adapter,captured,variant='describedby',seed=1,start=MAX}) {
  const dom=new JSDOM(`<form><textarea></textarea>${captured}<button data-testid="send-button">Send</button></form>`,{url:fieldUrl,runScripts:'outside-only'});
  const w=dom.window,d=w.document;
  let now=0,random=seed,position=start,timerId=0;
  const counts={navigation:0,input:0,opens:0,escape:0};
  const timers=new Set();
  w.Date.now=()=>1791888500000+now;
  w.setTimeout=(fn,ms=0)=>{const id=++timerId;timers.add(id);queueMicrotask(()=>{if(timers.delete(id)){random=(Math.imul(random,1664525)+1013904223)>>>0;now+=ms+random%11;fn();}});return id;};
  w.clearTimeout=id=>timers.delete(id);
  w.HTMLElement.prototype.getBoundingClientRect=()=>({left:1,top:1,width:160,height:24});
  const trigger=d.querySelector('[data-codex-intelligence-trigger]');
  const triggerLabel=trigger.querySelector('.ModelPickerTriggerLabel-xR9gDc');
  const paintTrigger=open=>{
    triggerLabel.textContent=open?'Resonemangsansträngning':nameAt(position);
    trigger.setAttribute('data-selected-reasoning-effort',effortAttr(position));
  };
  const announcement=()=>`${nameAt(position)}, ${position} av ${MAX}.`;
  const attrs=(el,values)=>{for(const [k,v] of Object.entries(values))el.setAttribute(k,v);return el;};
  function keyboardControl(wrapper,suffix){
    const power=attrs(d.createElement('div'),{role:'menuitem',tabindex:'-1','aria-label':'Prestanda'});
    const track=attrs(d.createElement('div'),{'aria-hidden':'true'});track.textContent='▮'.repeat(position);power.append(track);
    const value=d.createElement('span');value.id=`wp-value${suffix}`;value.textContent=announcement();
    const instructions=d.createElement('span');instructions.id=`wp-instructions${suffix}`;
    instructions.textContent='Använd vänster- och högerpiltangenterna för att justera prestandan';
    if(variant==='describedby' || variant==='twin')power.setAttribute('aria-describedby',`${value.id} ${instructions.id}`);
    if(variant==='arialabel')power.append(attrs(d.createElement('div'),{'aria-label':announcement()}));
    power.addEventListener('keydown',e=>{
      if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;
      counts.input++;position=Math.max(1,Math.min(MAX,position+(e.key==='ArrowRight'?1:-1)));
      paintTrigger(true);wrapper.replaceWith(buildMenu());
    });
    return [power,value,instructions];
  }
  function buildMenu(){
    const wrapper=attrs(d.createElement('div'),{'data-radix-popper-content-wrapper':'',id:'gf-field-wrapper'});
    const menu=attrs(d.createElement('div'),{role:'menu',id:'radix-_r_29_',tabindex:'-1','data-state':'open','aria-labelledby':'radix-_r_28_'});
    const models=attrs(d.createElement('div'),{role:'menuitem',tabindex:'0','aria-label':'Välj modell'});
    models.textContent=nameAt(position);models.addEventListener('click',()=>{counts.navigation++;});
    menu.append(models,...keyboardControl(wrapper,''));
    if(variant==='twin')menu.append(...keyboardControl(wrapper,'-2'));
    wrapper.append(menu);
    return wrapper;
  }
  const tooltip=()=>d.getElementById('_r_2b_');
  function open(){
    if(d.getElementById('radix-_r_29_'))return;
    counts.opens++;tooltip()?.remove();trigger.removeAttribute('aria-describedby');
    attrs(trigger,{'aria-expanded':'true','data-state':'open','aria-controls':'radix-_r_29_'});
    paintTrigger(true);d.body.append(buildMenu());
  }
  function close(){
    d.getElementById('gf-field-wrapper')?.remove();tooltip()?.remove();
    attrs(trigger,{'aria-expanded':'false','data-state':'closed'});trigger.removeAttribute('aria-controls');paintTrigger(false);
  }
  trigger.addEventListener('pointerover',()=>{
    if(tooltip()||d.getElementById('radix-_r_29_'))return;
    const tip=attrs(d.createElement('div'),{id:'_r_2b_',role:'tooltip'});tip.textContent='ResonemangsansträngningCtrl+Shift+M';
    trigger.setAttribute('aria-describedby','_r_2b_');d.body.append(tip);
  });
  trigger.addEventListener('pointerout',()=>{tooltip()?.remove();trigger.removeAttribute('aria-describedby');});
  trigger.addEventListener('keydown',e=>{if(e.key==='ArrowDown')open();});
  trigger.addEventListener('click',()=>trigger.getAttribute('aria-expanded')==='true'?close():open());
  d.addEventListener('keydown',e=>{if(e.key==='Escape'){counts.escape++;close();}});
  paintTrigger(false);
  w.eval(policy);w.eval(observation);w.eval(adapter);
  return {w,d,counts,position:()=>position,
    ensure:()=>w.GreenfieldThinkingControl.ensureHighest({expectedUrl:w.location.href,guard:async()=>({ok:true})}),
    proof:()=>w.GreenfieldSafetyPolicy.evaluateModel(w.GreenfieldModelObservation.observe(),undefined,{url:w.location.href,gptRoot:fieldUrl,requireHighestEffort:true}),
    diagnostics:()=>w.GreenfieldThinkingControl.diagnostics(),
    close(){w.GreenfieldThinkingControl.dispose();dom.window.close();}};
}
