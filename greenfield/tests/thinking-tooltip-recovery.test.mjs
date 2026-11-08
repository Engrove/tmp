import {withReasoningDependencies} from './fixtures/reasoning-dependencies.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const root=new URL('../',import.meta.url);
const read=name=>readFile(new URL(name,root),'utf8');
const [policy,observation,installed,triggerHtml,background,content]=await Promise.all([
  read('lib/safety-policy.js'),read('lib/model-observation.js'),read('lib/thinking-control.js'),
  read('tests/fixtures/reasoning-trigger-2026-10-30.html'),read('background.js'),read('content.js')
]);
const adapter=process.env.GREENFIELD_BASELINE_ADAPTER ? await readFile(process.env.GREENFIELD_BASELINE_ADAPTER,'utf8') : installed;
const url='https://chatgpt.com/g/g-test-eic/c/tooltip-recovery';
const gptRoot='https://chatgpt.com/g/g-test-eic';

// Trigger bytes are extracted from the supplied 2026-10-30 HTML. Open/close
// events are a simulation of the diagnostic sequence, not a live React test.
function fixture({tooltip='passive',refuseClose=false,initial='Extra hög'}={}) {
  const dom=new JSDOM(`<form><textarea></textarea>${triggerHtml}<button type="button" data-testid="send-button">Send</button></form>`,{url,runScripts:'outside-only'});
  const w=dom.window,d=w.document,trigger=d.querySelector('[data-composer-navigation-target="reasoning"]');
  let now=1793338053743,guardResult={ok:true};
  const counts={opens:0,clicks:0,escapes:0,sends:0,selection:0};
  w.Date.now=()=>now;
  w.setTimeout=(fn,ms=0)=>{queueMicrotask(()=>{now+=ms;fn();});return 1;};
  w.HTMLElement.prototype.getBoundingClientRect=function(){return this.closest('[hidden]')?{width:0,height:0}:{left:0,top:0,width:160,height:24};};
  const label=trigger.querySelector('.ModelPickerTriggerLabel-xR9gDc');
  const attrs=(el,values)=>{for(const [k,v] of Object.entries(values))el.setAttribute(k,v);return el;};
  function paint(open){
    attrs(trigger,{'aria-expanded':String(open),'data-state':open?'open':'closed','data-selected-reasoning-effort':initial==='Extra hög'?'max':'high'});
    label.textContent=open?'Resonemangsnivå':initial;
  }
  function tip(interactive=false){
    if(d.getElementById('tip-wrapper'))return;
    const wrapper=attrs(d.createElement('div'),{'data-radix-popper-content-wrapper':'',id:'tip-wrapper'});
    const tip=attrs(d.createElement('div'),{role:'tooltip',id:'reasoning-tip','data-state':'delayed-open'});
    tip.textContent='ResonemangsnivåCtrl+Shift+M';
    if(interactive==='slider')tip.append(attrs(d.createElement('span'),{role:'slider',tabindex:'0','aria-valuemin':'1','aria-valuemax':'4','aria-valuenow':'4','aria-valuetext':'Extra hög'}));
    if(interactive==='button'){
      const button=d.createElement('button');button.type='button';button.textContent='Other action';tip.append(button);
    }
    wrapper.append(tip);d.body.append(wrapper);trigger.setAttribute('aria-describedby',tip.id);
  }
  function open(){
    if(d.getElementById('effort-menu'))return;
    counts.opens++;d.getElementById('tip-wrapper')?.remove();trigger.removeAttribute('aria-describedby');
    const wrapper=attrs(d.createElement('div'),{'data-radix-popper-content-wrapper':'',id:'menu-wrapper'});
    const menu=attrs(d.createElement('div'),{role:'menu',id:'effort-menu','aria-labelledby':trigger.id,tabindex:'-1','data-state':'open'});
    const control=attrs(d.createElement('div'),{role:'menuitem',tabindex:'-1','aria-label':'Prestanda','aria-describedby':'effort-value effort-help'});
    control.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key))counts.selection++;});
    const value=attrs(d.createElement('span'),{id:'effort-value'});value.textContent=`${initial}, ${initial==='Extra hög'?4:3} av 4.`;
    const help=attrs(d.createElement('span'),{id:'effort-help'});help.textContent='Använd vänster- och högerpiltangenterna för att justera prestandan';
    menu.append(control,value,help);wrapper.append(menu);d.body.append(wrapper);
    trigger.setAttribute('aria-controls',menu.id);paint(true);
  }
  function closeMenu(){
    if(refuseClose)return;
    d.getElementById('menu-wrapper')?.remove();trigger.removeAttribute('aria-controls');paint(false);
    if(tooltip!=='none')tip(tooltip==='interactive'?'slider':tooltip==='button'?'button':false);
  }
  trigger.addEventListener('pointerover',()=>tip());
  trigger.addEventListener('keydown',e=>{if(e.key==='ArrowDown')open();});
  trigger.addEventListener('click',()=>{counts.clicks++;trigger.getAttribute('aria-expanded')==='true'?closeMenu():open();});
  d.addEventListener('keydown',e=>{if(e.key==='Escape'){counts.escapes++;closeMenu();}});
  d.querySelector('[data-testid="send-button"]').addEventListener('click',()=>counts.sends++);
  paint(false);w.eval(policy);w.eval(observation);w.eval(adapter);
  const ensure=()=>w.GreenfieldThinkingControl.ensureHighest({expectedUrl:url,guard:async()=>guardResult});
  return {w,d,trigger,counts,ensure,advance:ms=>{now+=ms;},allowClose:()=>{refuseClose=false;},setGuard:v=>{guardResult=v;},
    page:()=>({documentId:'doc-tooltip',url,generating:false,composerReady:true,composerEmpty:true,modelEvidence:w.GreenfieldModelObservation.observe()}),
    close:()=>{w.GreenfieldThinkingControl.dispose();dom.window.close();}};
}

test('field failure: passive Radix tooltip restored by Escape does not block a verified closed menu',async()=>{
  const f=fixture();try{
    const result=await f.ensure();assert.equal(result.ok,true,JSON.stringify(result));
    assert.equal(result.proof.label,'Extra hög');assert.equal(result.changed,false);
    assert.equal(f.trigger.getAttribute('aria-expanded'),'false');assert.equal(f.d.querySelector('[role=menu]'),null);
    assert.ok(f.d.querySelector('[role=tooltip]'));assert.equal(f.counts.clicks,0);assert.equal(f.counts.selection,0);
    const before={...f.counts};assert.equal((await f.ensure()).ok,true);assert.deepEqual(f.counts,before);
  }finally{f.close();}
});

test('real unclosed menu stays blocked and action-free within cooldown, then recovers without DOM changes',async()=>{
  const f=fixture({refuseClose:true,tooltip:'none'});try{
    const first=await f.ensure();assert.equal(first.code,'THINKING_MENU_CLOSE_FAILED');assert.equal(f.w.GreenfieldThinkingControl.proof(),null);
    const before={...f.counts};f.allowClose();
    assert.equal((await f.ensure()).repeated,true);assert.deepEqual(f.counts,before);
    f.advance(30001);
    const recovered=await f.ensure();assert.equal(recovered.ok,true,JSON.stringify(recovered));
    assert.equal(f.d.querySelector('[role=menu]'),null);assert.equal(f.counts.sends,0);
    assert.equal(f.w.GreenfieldThinkingControl.diagnostics().recoveredOpenMenu,true);
  }finally{f.close();}
});

test('persistently unclosed menu is retried at bounded intervals and never grants a receipt',async()=>{
  const f=fixture({refuseClose:true,tooltip:'none'});try{
    assert.equal((await f.ensure()).code,'THINKING_MENU_CLOSE_FAILED');
    for(let i=0;i<2;i++){
      const before={...f.counts};assert.equal((await f.ensure()).repeated,true);assert.deepEqual(f.counts,before);
      f.advance(30001);assert.equal((await f.ensure()).code,'THINKING_MENU_CLOSE_FAILED');
      assert.ok(f.counts.escapes>before.escapes);assert.ok(f.counts.escapes-before.escapes<=2);
      assert.equal(f.w.GreenfieldThinkingControl.proof(),null);assert.equal(f.counts.sends,0);
    }
  }finally{f.close();}
});

test('tooltip containing an actual effort control is still an open interactive surface',async()=>{
  const f=fixture({tooltip:'interactive'});try{
    const result=await f.ensure();assert.equal(result.code,'THINKING_MENU_CLOSE_FAILED');
    assert.equal(f.w.GreenfieldThinkingControl.proof(),null);assert.equal(f.counts.sends,0);
  }finally{f.close();}
});

test('tooltip containing an unrelated button is not classified as passive help',async()=>{
  const f=fixture({tooltip:'button'});try{
    assert.equal((await f.ensure()).code,'THINKING_MENU_CLOSE_FAILED');assert.equal(f.w.GreenfieldThinkingControl.proof(),null);
  }finally{f.close();}
});

test('retry cannot bypass a draft guard or navigation boundary',async()=>{
  for(const reason of ['draft','navigation']){
    const f=fixture({refuseClose:true,tooltip:'none'});try{
      await f.ensure();const before={...f.counts};f.advance(30001);
      if(reason==='draft')f.setGuard({ok:false,code:'OPERATOR_DRAFT_PRESENT'});
      else f.w.history.pushState({},'', '/g/g-test-eic/c/other');
      const result=await f.ensure();assert.equal(result.code,reason==='draft'?'OPERATOR_DRAFT_PRESENT':'THINKING_SELECTION_SESSION_CHANGED');
      assert.deepEqual(f.counts,before);assert.equal(f.w.GreenfieldThinkingControl.proof(),null);
    }finally{f.close();}
  }
});

test('passive tooltip does not authorize a lower effort level',async()=>{
  const f=fixture({initial:'Hög'});try{
    const result=await f.ensure();assert.equal(result.ok,false);assert.equal(result.code,'THINKING_TARGET_UNAVAILABLE');
    assert.equal(f.w.GreenfieldThinkingControl.proof(),null);assert.equal(f.counts.sends,0);
  }finally{f.close();}
});

function functionSource(name,source,indent=''){
  const start=new RegExp(`^${indent}(?:async )?function ${name}\\(`,'m').exec(source)?.index;assert.notEqual(start,undefined,name);
  const tail=source.slice(start),end=new RegExp('^'+indent+'}\\s*$','m').exec(tail);assert.ok(end);
  return tail.slice(0,end.index+end[0].length);
}
test('held process passes real preflight and real submit exactly once with a residual tooltip',async()=>{
  const f=fixture();try{
    const w=f.w,composer=f.d.querySelector('textarea'),holds=[];
    const deps={Date:w.Date,Safety:w.GreenfieldSafetyPolicy,readSafety:async()=>({policy:w.GreenfieldSafetyPolicy.defaults}),providerTransportPending:()=>false,
      holdForSafety:async(p,d)=>{holds.push(d);return {...p,hold:d};},transportTransitionBoundary:async p=>({blocked:false,process:p}),
      bridgeMessage:async()=>f.ensure(),tabState:async()=>f.page(),audit:async()=>{}};
    const preflight=Function(...Object.keys(withReasoningDependencies(deps)),functionSource('ensureHighestThinkingBeforeSend',background)+';return ensureHighestThinkingBeforeSend;')(...Object.values(deps));
    const process={phase:'SENDING',tabId:1,gptRoot,pendingPrompt:{hash:'hash',dispatch:null},safety:{hold:{code:'THINKING_MENU_CLOSE_FAILED'}}};
    assert.equal((await preflight(process,f.page())).handled,false,JSON.stringify(holds));assert.equal(holds.length,0);
    Object.assign(w,{DOCUMENT_ID:'doc-tooltip',assertContentActive:()=>{},dispatchRecords:new Map(),forensic:()=>{},serializeError:e=>({message:e.message}),
      pageState:async()=>f.page(),getComposer:()=>composer,normalizeText:s=>String(s||''),sha256Hex:async()=>'hash',setNativeValue:(el,v)=>{el.value=v;},
      getSendButton:()=>f.d.querySelector('[data-testid="send-button"]'),promptMarkerValue:s=>s,sendRuntimeMessage:async()=>({ok:true,policy:w.GreenfieldSafetyPolicy.defaults,gptRoot}),
      materializedUserTurnReceipt:()=>({userTurnId:'fixture-user',userTurnIndex:0}),publishDispatchMaterialization:async()=>({userTurnId:'fixture-user'}),
      waitForMaterialization:async()=>({acknowledged:true,evidence:'USER_TURN',elapsedMs:1,state:{},rateLimitDetected:false})});
    w.eval(['normalizeComposerText','readComposerValue','submitPrompt'].map(name=>functionSource(name,content,'  ')).join('\n')+'\nwindow.realSubmit=submitPrompt;');
    const args=['Resume the authorized task.','hash','tooltip-dispatch-1',{policy:w.GreenfieldSafetyPolicy.defaults,gptRoot}];
    assert.equal((await w.realSubmit(...args)).ok,true);assert.equal((await w.realSubmit(...args)).acknowledged,true);assert.equal(f.counts.sends,1);
  }finally{f.close();}
});
