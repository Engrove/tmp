import {withReasoningDependencies} from './fixtures/reasoning-dependencies.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

// v1.9.38 regression for diagnostics 2026-10-30T16:18:49Z: the visible
// control showed Extra hög/max, the adapter's last attempt was VERIFIED, yet
// the receipt was null (RECEIPT_MISSING_OR_INVALIDATED) and every send ended in
// THINKING_MAXIMUM_UNVERIFIED. A selection-preserving DOM mutation inside the
// trigger revoked the receipt. The DOM events below are a simulation of React
// re-commits/re-layout, not a recording of ChatGPT's own code.
const root=new URL('../',import.meta.url);
const read=name=>readFile(new URL(name,root),'utf8');
const [policy,observation,installed,triggerHtml,content,background,common]=await Promise.all([
  read('lib/safety-policy.js'),read('lib/model-observation.js'),read('lib/thinking-control.js'),
  read('tests/fixtures/reasoning-trigger-2026-10-30.html'),read('content.js'),read('background.js'),import(new URL('lib/common.mjs',root))
]);
const adapter=process.env.GREENFIELD_BASELINE_ADAPTER ? await readFile(process.env.GREENFIELD_BASELINE_ADAPTER,'utf8') : installed;
const url='https://chatgpt.com/g/g-69e0b4be34308191aa6c05db1908be1b-eic';
const gptRoot=url;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function body(name,source) {
  const match=new RegExp('^  (?:async )?function '+name+'\\(','m').exec(source);
  const start=match?.index ?? new RegExp('^(?:async )?function '+name+'\\(','m').exec(source)?.index;
  assert.notEqual(start,undefined,name);
  const indent=match?'  ':'';
  const end=new RegExp('^'+indent+'}[ \\t]*$','m').exec(source.slice(start));
  return source.slice(start,start+end.index+end[0].length);
}

function fixture() {
  const dom=new JSDOM(`<form><div contenteditable="true" role="textbox" id="prompt-textarea"></div><div id="footer">${triggerHtml}<button type="button" data-testid="send-button">Send</button></div></form>`,{url,runScripts:'outside-only'});
  const w=dom.window,d=w.document,trigger=d.querySelector('[data-composer-navigation-target="reasoning"]');
  let now=1793377102068;
  const counts={opens:0,sends:0};
  w.Date.now=()=>now;
  w.setTimeout=(fn,ms=0)=>{queueMicrotask(()=>{now+=ms;fn();});return 1;};
  w.HTMLElement.prototype.getBoundingClientRect=function(){return this.closest('[hidden]')?{width:0,height:0}:{left:0,top:0,width:160,height:24};};
  const valueSpan=()=>trigger.querySelector('.min-w-0.truncate');
  const attrs=(el,values)=>{for(const [k,v] of Object.entries(values))el.setAttribute(k,v);return el;};
  function open(){
    if(d.getElementById('effort-menu'))return;
    counts.opens++;
    const menu=attrs(d.createElement('div'),{role:'menu',id:'effort-menu','aria-labelledby':trigger.id,tabindex:'-1','data-state':'open'});
    const control=attrs(d.createElement('div'),{role:'menuitem',tabindex:'-1','aria-label':'Prestanda','aria-describedby':'effort-value'});
    const value=attrs(d.createElement('span'),{id:'effort-value'});value.textContent='Extra hög, 4 av 4.';
    menu.append(control,value);d.body.append(menu);
    attrs(trigger,{'aria-controls':menu.id,'aria-expanded':'true','data-state':'open'});valueSpan().textContent='Resonemangsnivå';
  }
  function close(){
    d.getElementById('effort-menu')?.remove();trigger.removeAttribute('aria-controls');
    attrs(trigger,{'aria-expanded':'false','data-state':'closed'});valueSpan().textContent='Extra hög';
  }
  trigger.addEventListener('keydown',e=>{if(e.key==='ArrowDown')open();});
  d.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
  d.querySelector('[data-testid="send-button"]').addEventListener('click',()=>counts.sends++);
  w.eval(policy);w.eval(observation);w.eval(adapter);
  const mutate={
    sameTextNode:()=>valueSpan().replaceChildren(d.createTextNode('Extra hög')),
    remountInner:()=>{const s=trigger.querySelector('.ModelPickerTriggerContent-MFmRQj');s.replaceWith(s.cloneNode(true));},
    move:()=>d.getElementById('footer').append(trigger),
    level:(label,value)=>{valueSpan().textContent=label;if(value)trigger.setAttribute('data-selected-reasoning-effort',value);}
  };
  const ensure=()=>w.GreenfieldThinkingControl.ensureHighest({expectedUrl:url,guard:async()=>({ok:true})});
  const gate=()=>w.GreenfieldSafetyPolicy.evaluateModel(w.GreenfieldModelObservation.observe(),w.GreenfieldSafetyPolicy.defaults,{url,gptRoot,requireHighestEffort:true});
  const status=()=>w.GreenfieldThinkingControl.receiptStatus();
  return {dom,w,d,trigger,counts,mutate,ensure,gate,status,advance:ms=>{now+=ms;},
    close:()=>{w.GreenfieldThinkingControl.dispose();dom.window.close();}};
}

for (const kind of ['sameTextNode','remountInner','move']) {
  test(`field signature: selection-preserving ${kind} keeps the Extra hög receipt valid`,async()=>{
    const f=fixture();try{
      assert.equal((await f.ensure()).ok,true);await flush();
      assert.equal(f.status().currentReceiptValid,true);
      f.mutate[kind]();await flush();
      assert.equal(f.w.GreenfieldThinkingControl.selection().label,'Extra hög');
      assert.equal(f.w.GreenfieldModelObservation.observe().effortLabel,'Extra hög');
      const s=f.status();
      assert.equal(s.currentReceiptValid,true,JSON.stringify(s));
      assert.equal(s.invalidation,null);
      assert.equal(s.events.at(-1).kind,'CONTROL_RERENDERED_SAME_SELECTION');
      assert.equal(f.gate().allowed,true);
      const opens=f.counts.opens;assert.equal((await f.ensure()).ok,true);assert.equal(f.counts.opens,opens);
    }finally{f.close();}
  });
}

const definite={
  'reasoning value changes to high':[f=>f.mutate.level('Hög','high'),'REASONING_VALUE_CHANGED'],
  'Pro label is shown':[f=>f.mutate.level('Pro'),'PRO_SELECTED'],
  'recognized lower level is shown with stale max value':[f=>f.mutate.level('Hög'),'REASONING_LEVEL_CHANGED'],
  'menu is opened':[f=>f.trigger.setAttribute('aria-expanded','true'),'MENU_OPENED'],
  'selected model attribute changes':[f=>f.trigger.setAttribute('data-selected-model','other-model'),'MODEL_CHANGED']
};
for (const [name,[change,reason]] of Object.entries(definite)) {
  test(`definite change revokes permanently: ${name}`,async()=>{
    const f=fixture();try{
      assert.equal((await f.ensure()).ok,true);await flush();
      change(f);await flush();
      const s=f.status();
      assert.equal(s.currentReceiptValid,false);assert.equal(s.receiptInvalidReason,'RECEIPT_MISSING_OR_INVALIDATED');
      assert.equal(s.invalidation.reason,reason);assert.equal(s.invalidation.expected.label,'Extra hög');
      assert.equal(f.gate().code,'THINKING_MAXIMUM_UNVERIFIED');
      // Reverting the DOM never restores a revoked receipt.
      f.trigger.setAttribute('aria-expanded','false');f.trigger.removeAttribute('data-selected-model');
      f.mutate.level('Extra hög','max');await flush();
      assert.equal(f.status().currentReceiptValid,false);assert.equal(f.gate().allowed,false);
    }finally{f.close();}
  });
}

// Found during 1.9.38 review: a same-task open+close (or change+revert) leaves
// the final DOM identical, but the menu was open and may have changed the model
// invisibly. The attribute write itself is the evidence.
const sameBatch={
  'menu opened and closed in one task':[f=>{f.trigger.setAttribute('aria-expanded','true');f.trigger.setAttribute('aria-expanded','false');},'MENU_OPENED'],
  'reasoning value changed and restored in one task':[f=>{f.trigger.setAttribute('data-selected-reasoning-effort','high');f.trigger.setAttribute('data-selected-reasoning-effort','max');},'REASONING_VALUE_CHANGED'],
  'model attribute written and removed in one task':[f=>{f.trigger.setAttribute('data-selected-model','other');f.trigger.removeAttribute('data-selected-model');},'MODEL_CHANGED'],
  'control absent while its menu attribute changes':[f=>{const t=f.trigger,p=t.parentNode;t.setAttribute('aria-expanded','true');t.remove();t.setAttribute('aria-expanded','false');p.prepend(t);},'MENU_OPENED']
};
for (const [name,[change,reason]] of Object.entries(sameBatch)) {
  test(`same-batch transition still revokes: ${name}`,async()=>{
    const f=fixture();try{
      assert.equal((await f.ensure()).ok,true);await flush();
      change(f);await flush();
      assert.equal(f.w.GreenfieldThinkingControl.selection().label,'Extra hög');
      const s=f.status();assert.equal(s.currentReceiptValid,false);assert.equal(s.invalidation?.reason,reason);
      assert.equal(f.gate().code,'THINKING_MAXIMUM_UNVERIFIED');
    }finally{f.close();}
  });
}

test('a thinking disclosure in a conversation turn is not the composer control',async()=>{
  const f=fixture();try{
    const turn=f.d.createElement('article');turn.setAttribute('data-testid','conversation-turn-2');
    turn.innerHTML='<form><button type="button" data-testid="thinking-toggle" aria-expanded="false">Tänkte i 30 s</button></form>';
    f.d.body.append(turn);
    assert.equal((await f.ensure()).ok,true);await flush();
    const toggle=turn.querySelector('button');toggle.setAttribute('aria-expanded','true');toggle.setAttribute('aria-expanded','false');await flush();
    const s=f.status();assert.equal(s.currentReceiptValid,true,JSON.stringify(s));assert.equal(s.invalidation,null);
    assert.equal(f.gate().allowed,true);
  }finally{f.close();}
});

test('transient absence is recorded; use time still requires the identical present control',async()=>{
  const f=fixture();try{
    assert.equal((await f.ensure()).ok,true);await flush();
    const footer=f.d.getElementById('footer');f.trigger.remove();await flush();
    assert.equal(f.status().receiptInvalidReason,'RECEIPT_CONTROL_UNAVAILABLE');assert.equal(f.gate().allowed,false);
    footer.prepend(f.trigger);await flush();
    const s=f.status();assert.equal(s.currentReceiptValid,true,JSON.stringify(s));
    // Arrays originate in the jsdom realm; compare values, not prototypes.
    assert.equal(JSON.stringify(s.events.map(e=>e.kind)),JSON.stringify(['CONTROL_ABSENT','CONTROL_RERENDERED_SAME_SELECTION']));
    assert.equal(f.gate().allowed,true);
  }finally{f.close();}
});

test('non-definite text difference blocks at use time and is never a permission',async()=>{
  const f=fixture();try{
    assert.equal((await f.ensure()).ok,true);await flush();
    f.mutate.level('');await flush();
    assert.equal(f.status().receiptInvalidReason,'RECEIPT_SELECTION_CHANGED');assert.equal(f.gate().allowed,false);
    assert.equal(f.status().events.at(-1).kind,'CONTROL_TEXT_DIFFERS');
    f.mutate.level('Extra hög');await flush();
    assert.equal(f.status().currentReceiptValid,true);assert.equal(f.gate().allowed,true);
  }finally{f.close();}
});

test('TTL and URL binding are unchanged after a tolerated re-render',async()=>{
  const f=fixture();try{
    assert.equal((await f.ensure()).ok,true);await flush();
    f.mutate.sameTextNode();await flush();f.advance(60001);
    assert.equal(f.status().receiptInvalidReason,'RECEIPT_TTL_EXPIRED');assert.equal(f.gate().allowed,false);
  }finally{f.close();}
});

test('a new verified receipt clears the previous invalidation trail',async()=>{
  const f=fixture();try{
    assert.equal((await f.ensure()).ok,true);await flush();
    f.trigger.setAttribute('aria-expanded','true');await flush();f.trigger.setAttribute('aria-expanded','false');await flush();
    assert.equal(f.status().invalidation.reason,'MENU_OPENED');
    assert.equal((await f.ensure()).ok,true);await flush();
    const s=f.status();assert.equal(s.currentReceiptValid,true);assert.equal(s.invalidation,null);assert.equal(s.events.length,0);
  }finally{f.close();}
});

function wireSubmit(f,{onStage}) {
  const w=f.w,composer=f.d.getElementById('prompt-textarea');
  const state={generating:false,composerReady:true,composerEmpty:true,composerTextHash:'',documentId:'doc',url};
  Object.assign(w,{
    dispatchRecords:new Map(),forensic:()=>{},serializeError:e=>({message:e.message,code:e.code}),getComposer:()=>composer,
    normalizeText:s=>String(s||''),sha256Hex:async()=>'hash',
    setNativeValue:(el,value)=>{el.textContent=value;if(value)onStage();},
    getSendButton:()=>f.d.querySelector('[data-testid="send-button"]'),promptMarkerValue:s=>s,
    materializedUserTurnReceipt:()=>({userTurnId:'fixture-user',userTurnIndex:0}),publishDispatchMaterialization:async()=>({userTurnId:'u1'}),
    waitForMaterialization:async()=>({acknowledged:true,evidence:'USER_TURN',elapsedMs:1,state:{},rateLimitDetected:false}),
    pageState:async()=>({...state,modelEvidence:w.GreenfieldModelObservation.observe()}),assertContentActive:()=>{},DOCUMENT_ID:'doc',
    chrome:{runtime:{sendMessage:async()=>{await flush();return {ok:true,policy:w.GreenfieldSafetyPolicy.defaults,gptRoot};}}}
  });
  w.sendRuntimeMessage=message=>w.chrome.runtime.sendMessage(message);
  w.eval(['normalizeComposerText','readComposerValue','submitPrompt'].map(name=>body(name,content)).join('\n')+'\nwindow.submitPrompt=submitPrompt;');
  return ()=>w.submitPrompt('{"messageId":"a2a"}\nFULL SESSION PRE-PROMPT','hash','send-a23582f2',{policy:w.GreenfieldSafetyPolicy.defaults,gptRoot});
}

test('real submitPrompt: staging re-layout that preserves Extra hög no longer blocks the click',async()=>{
  const f=fixture();try{
    assert.equal((await f.ensure()).ok,true);await flush();
    const submit=wireSubmit(f,{onStage:()=>{f.mutate.move();f.mutate.sameTextNode();}});
    const r=await submit();
    assert.equal(r.ok,true,JSON.stringify(r));assert.equal(f.counts.sends,1);
  }finally{f.close();}
});

test('real submitPrompt: staging that really changes the level is refused after staging with explicit detail',async()=>{
  const f=fixture();try{
    assert.equal((await f.ensure()).ok,true);await flush();
    const submit=wireSubmit(f,{onStage:()=>f.mutate.level('Hög','high')});
    const r=await submit();
    assert.equal(r.ok,false);assert.equal(r.effectPossible,false);assert.equal(f.counts.sends,0);
    assert.equal(r.code,'THINKING_MAXIMUM_UNVERIFIED');
    assert.equal(r.detail,'POST_STAGE RECEIPT_MISSING_OR_INVALIDATED REASONING_VALUE_CHANGED label=Hög');
  }finally{f.close();}
});

test('detail survives background contentSend and the persisted error record',async()=>{
  const fn=new Function('audit','withMissionOwner','bridgeMessage','readSafety','promptCausalMarker','chrome','TAB_HEALTH','reasoningPolicyForProcess',
    body('contentSend',background).replace(/^async function/,'return async function'));
  const send=fn(async()=>{},async(_p,_s,cb)=>cb(),async()=>({ok:false,effectPossible:false,code:'THINKING_MAXIMUM_UNVERIFIED',
    error:'THINKING_MAXIMUM_UNVERIFIED',detail:'POST_STAGE RECEIPT_MISSING_OR_INVALIDATED MENU_OPENED label=Extra hög'}),
    async()=>({policy:{}}),()=>'marker',{storage:{local:{}}},{SUBMIT_TIMEOUT_MS:1000},
    withReasoningDependencies({}).reasoningPolicyForProcess);
  await assert.rejects(send({tabId:1,gptRoot},{text:'x',hash:'h'},'op'),error=>{
    assert.equal(error.code,'THINKING_MAXIMUM_UNVERIFIED');assert.equal(error.effectPossible,false);
    assert.equal(error.detail,'POST_STAGE RECEIPT_MISSING_OR_INVALIDATED MENU_OPENED label=Extra hög');
    assert.equal(common.errorRecord(error).detail,error.detail);return true;
  });
  assert.equal('detail' in common.errorRecord(Object.assign(new Error('x'),{code:'C'})),false);
  assert.match(background,/return holdForSafety\(retryable,\{code:error\.code,retryAtMs:error\.retryAtMs,detail:error\.detail \|\| ""\}\);/);
  const detail=new Function(body('receiptHoldDetail',background)+'\nreturn receiptHoldDetail;')();
  assert.equal(detail('PRE_DISPATCH',{effortLabel:'Extra hög',receiptStatus:{receiptInvalidReason:'RECEIPT_MISSING_OR_INVALIDATED',events:[{kind:'CONTROL_ABSENT'}]}}),
    'PRE_DISPATCH RECEIPT_MISSING_OR_INVALIDATED CONTROL_ABSENT label=Extra hög');
});
