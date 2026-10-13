import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const root = new URL('../',import.meta.url);
const read = path=>readFile(new URL(path,root),'utf8');
const [policy,observation,control,content,background,triggerHtml] = await Promise.all([
  read('lib/safety-policy.js'),read('lib/model-observation.js'),read('lib/thinking-control.js'),
  read('content.js'),read('background.js'),read('tests/fixtures/reasoning-trigger-2026-10-13.html')
]);
const url='https://chatgpt.com/g/g-test-eic/c/conversation-a';
const gptRoot='https://chatgpt.com/g/g-test-eic';
function body(name,source) {
  const match=new RegExp('^  (?:async )?function '+name+'\\(','m').exec(source);
  const start=match?.index ?? new RegExp('^(?:async )?function '+name+'\\(','m').exec(source)?.index;
  assert.notEqual(start,undefined,name);
  const indent=match?'  ':'';
  const end=new RegExp('^'+indent+'}[ \\t]*$','m').exec(source.slice(start));
  return source.slice(start,start+end.index+end[0].length);
}
function fixture({type='slider',initial='Balanserad',maxLabel='Pro',max=4,disabled=false,noReadback=false,dialog=false}={}) {
  const dom=new JSDOM(`<form><div contenteditable="true" role="textbox" aria-label="Fråga ChatGPT"></div>${triggerHtml}<button data-testid="send-button">Send</button></form>`,{url,runScripts:'outside-only'});
  const w=dom.window,d=w.document;
  d.querySelector('form').addEventListener('submit',event=>event.preventDefault());
  w.HTMLElement.prototype.getBoundingClientRect=function(){
    return this.closest('[hidden],[style*="display: none"]') ? {width:0,height:0} : {width:100,height:24};
  };
  w.eval(policy); w.eval(observation); w.eval(control);
  const trigger=d.querySelector('[data-codex-intelligence-trigger]');
  const label=trigger.querySelector('.ModelPickerTriggerLabel-xR9gDc');
  let selected=initial==='Pro'?max:initial==='Extra hög'?3:1;
  const counts={opens:0,sends:0,guard:0};
  const setLabel=(name)=>{
    selected=name==='Pro'?max:name==='Extra hög'?3:name==='Hög'?2:1;
    label.textContent=name;
    trigger.setAttribute('data-selected-reasoning-effort',name==='Pro'?'pro':name==='Extra hög'?'max':name==='Hög'?'high':'medium');
  };
  setLabel(initial);trigger.setAttribute('aria-controls','thinking-menu');
  if(disabled)trigger.disabled=true;
  trigger.addEventListener('click',()=>{
    if(trigger.getAttribute('aria-expanded')==='true'){
      trigger.setAttribute('aria-expanded','false');d.getElementById('thinking-menu')?.remove();return;
    }
    counts.opens++;trigger.setAttribute('aria-expanded','true');
    const popup=d.createElement('div');popup.id='thinking-menu';popup.setAttribute('role',dialog?'dialog':'menu');popup.setAttribute('aria-labelledby',trigger.id);
    if(type==='slider'||type==='range'){
      const slider=d.createElement(type==='range'?'input':'span');
      if(type==='range'){slider.type='range';slider.min='0';slider.max=String(max);slider.value=String(selected);}
      else {slider.setAttribute('role','slider');slider.setAttribute('aria-valuemin','0');slider.setAttribute('aria-valuemax',String(max));slider.setAttribute('aria-valuenow',String(selected));}
      const update=()=>{selected=max;slider.setAttribute('aria-valuenow',String(max));if(!noReadback)setLabel(maxLabel);};
      slider.addEventListener('keydown',e=>{if(e.key==='End')update();});slider.addEventListener('input',update);
      popup.append(slider);
    }else if(type==='options'){
      for(const name of ['Balanserad','Hög','Extra hög','Pro']){
        const option=d.createElement('button');option.textContent=name;option.setAttribute('role','menuitemradio');
        option.setAttribute('aria-checked',String(name===initial));
        option.addEventListener('click',()=>{setLabel(name);trigger.click();});popup.append(option);
      }
    } else {
      for(const name of ['GPT-5.6 Pro','Pro']){
        const other=d.createElement('button');other.textContent=name;other.setAttribute('role','menuitem');other.setAttribute('aria-haspopup','menu');popup.append(other);
      }
    }
    d.body.append(popup);
  });
  d.querySelector('[data-testid="send-button"]').addEventListener('click',()=>counts.sends++);
  const state={generating:false,composerReady:true,composerEmpty:true,composerTextHash:'',documentId:'doc',url};
  w.pageState=async()=>({...state,modelEvidence:w.GreenfieldModelObservation.observe()});
  w.assertContentActive=()=>{};
  w.sendRuntimeMessage=message=>w.chrome.runtime.sendMessage(message);
  w.DOCUMENT_ID='doc';w.visible=el=>el.getBoundingClientRect().width>0;
  w.eval(body('handle',content)+'\nwindow.handle=handle;');
  const ensure=()=>w.handle({type:'EIC_GF_ENSURE_HIGHEST_THINKING',documentId:'doc',expectedUrl:w.location.href,promptHash:'hash',policy:w.GreenfieldSafetyPolicy.defaults,gptRoot});
  const proof=()=>w.GreenfieldSafetyPolicy.evaluateModel(w.GreenfieldModelObservation.observe(),w.GreenfieldSafetyPolicy.defaults,{url:w.location.href,gptRoot,requireHighestEffort:true});
  return {dom,w,d,trigger,counts,state,setLabel,ensure,proof,close:()=>{w.GreenfieldThinkingControl.dispose();dom.window.close();}};
}

test('captured composer without prompt-textarea resolves selected Extra hög and rejects Balanced',()=>{
  const f=fixture({initial:'Extra hög'});
  try{
    assert.equal(f.d.querySelector('#prompt-textarea'),null);
    assert.equal(f.w.GreenfieldModelObservation.observe().effortEvidenceSource,'COMPOSER_SELECTED_CONTROL');
    assert.equal(f.w.GreenfieldModelObservation.observe().ambiguous,false);
    f.setLabel('Balanserad');
    const p=f.w.GreenfieldSafetyPolicy.evaluateModel(f.w.GreenfieldModelObservation.observe(),undefined,{url,gptRoot});
    assert.equal(p.code,'THINKING_EFFORT_TOO_LOW');
    for(const name of ['Balanced','Balanserad','Låg','Direkt','medium'])assert.equal(f.w.GreenfieldSafetyPolicy.effort(name),0);
  }finally{f.close();}
});
test('unranked control no longer grants Extended permission',()=>{
  const f=fixture();try{
    const e={...f.w.GreenfieldModelObservation.observe(),effortLabel:'Resonemangsansträngning'};
    assert.equal(f.w.GreenfieldSafetyPolicy.evaluateModel(e,undefined,{url,gptRoot}).code,'THINKING_EFFORT_UNKNOWN');
  }finally{f.close();}
});
for(const type of ['slider','range','options'])test(`${type}: Balanced becomes Pro and highest receipt is required`,async()=>{
  const f=fixture({type});try{
    assert.equal(f.proof().allowed,false);
    const result=await f.ensure();assert.equal(result.ok,true,JSON.stringify(result));
    assert.equal(f.proof().allowed,true);assert.equal(f.proof().highestEffortVerified,true);
    assert.equal(f.w.GreenfieldThinkingControl.selection().label,'Pro');assert.equal(f.counts.sends,0);
    assert.equal(f.trigger.getAttribute('aria-expanded'),'false');
    await f.ensure();assert.equal(f.counts.opens,1,'fresh verified setting is reused');
  }finally{f.close();}
});
test('Extra hög is upgraded when Pro exists; no hard-coded slider maximum',async()=>{
  const f=fixture({initial:'Extra hög',max:8});try{
    const r=await f.ensure();assert.equal(r.ok,true);assert.equal(r.proof.target,'8');assert.equal(r.proof.label,'Pro');
  }finally{f.close();}
});
test('Extra hög is retained when it is the maximum actually exposed',async()=>{
  const f=fixture({initial:'Extra hög',max:3,maxLabel:'Extra hög'});try{
    const r=await f.ensure();assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.changed,false);assert.equal(f.proof().allowed,true);
  }finally{f.close();}
});
test('disabled Pro option is skipped; highest available option is selected',async()=>{
  const f=fixture({type:'options'});try{
    f.trigger.addEventListener('click',()=>{const items=f.d.querySelectorAll('[role=menuitemradio]');if(items.length)items[3].setAttribute('aria-disabled','true');});
    const r=await f.ensure();assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.proof.label,'Extra hög');
  }finally{f.close();}
});
test('own dialog popup is allowed; unrelated blocking dialog is not',async()=>{
  const f=fixture({dialog:true});try{
    assert.equal((await f.ensure()).ok,true);
    const dialog=f.d.createElement('div');dialog.setAttribute('role','dialog');dialog.textContent='Other settings';f.d.body.append(dialog);
    assert.equal((await f.ensure()).code,'BLOCKING_CHATGPT_UI');
  }finally{f.close();}
});
test('disabled trigger, operator draft, active generation and wrong document do not change UI',async()=>{
  for(const reason of ['disabled','draft','busy','processing','connection','document']){
    const f=fixture({disabled:reason==='disabled'});try{
      if(reason==='draft'){f.state.composerEmpty=false;f.state.composerTextHash='other';}
      if(reason==='busy')f.state.generating=true;
      if(reason==='processing')f.state.providerNotices={processingNotice:true};
      if(reason==='connection')f.state.providerNotices={connectionInterrupted:true};
      if(reason==='document')f.w.DOCUMENT_ID='other';
      const r=await f.ensure();assert.equal(r.ok,false,reason);assert.equal(f.counts.opens,0,reason);assert.equal(f.counts.sends,0);
    }finally{f.close();}
  }
});
test('model submenu and conversation text never count as effort options',async()=>{
  const f=fixture({type:'model-menu'});try{
    const article=f.d.createElement('article');article.innerHTML='<button role="menuitem">Pro</button>';f.d.body.append(article);
    const r=await f.ensure();assert.equal(r.ok,false);assert.equal(r.code,'THINKING_OPTIONS_UNVERIFIED');assert.equal(f.proof().allowed,false);
  }finally{f.close();}
});
test('slider movement without selected-control readback fails within deadline',async()=>{
  const f=fixture({noReadback:true});try{
    const realNow=f.w.Date.now.bind(f.w.Date);let offset=0;f.w.Date.now=()=>realNow()+offset;
    f.trigger.addEventListener('click',()=>{if(f.trigger.getAttribute('aria-expanded')==='true')setTimeout(()=>offset=7000,200);});
    const r=await f.ensure();assert.equal(r.ok,false);assert.equal(r.code,'THINKING_SELECTION_TIMEOUT');assert.equal(f.proof().allowed,false);assert.equal(f.counts.sends,0);
  }finally{f.close();}
});
test('new session and reset to Balanced require a fresh selection',async()=>{
  const f=fixture();try{
    assert.equal((await f.ensure()).ok,true);
    f.w.history.pushState({},'', '/g/g-test-eic/c/conversation-b');f.setLabel('Balanserad');
    assert.equal(f.proof().allowed,false);
    assert.equal((await f.ensure()).ok,true);assert.equal(f.counts.opens,2);
  }finally{f.close();}
});
test('opening model picker invalidates old maximum even after closing it',async()=>{
  const f=fixture();try{
    await f.ensure();f.trigger.click();f.trigger.click();await Promise.resolve();
    assert.equal(f.proof().allowed,false);await f.ensure();assert.equal(f.proof().allowed,true);
  }finally{f.close();}
});
test('expired receipt is rejected and refreshed; another document has no receipt',async()=>{
  const f=fixture(),other=fixture({initial:'Pro'});try{
    await f.ensure();assert.equal(other.proof().allowed,false);
    const now=f.w.Date.now.bind(f.w.Date);f.w.Date.now=()=>now()+61000;
    assert.equal(f.proof().allowed,false);assert.equal((await f.ensure()).ok,true);assert.equal(f.counts.opens,2);
  }finally{f.close();other.close();}
});
test('two independent documents select independently',async()=>{
  const a=fixture(),b=fixture();try{
    const results=await Promise.all([a.ensure(),b.ensure()]);assert(results.every(r=>r.ok));assert.equal(a.counts.opens,1);assert.equal(b.counts.opens,1);
  }finally{a.close();b.close();}
});
test('navigation during selection cancels operation',async()=>{
  const f=fixture();try{
    f.trigger.addEventListener('click',()=>f.w.history.pushState({},'','/g/g-test-eic/c/other'));
    const r=await f.ensure();assert.equal(r.code,'THINKING_SELECTION_SESSION_CHANGED');assert.equal(f.proof().allowed,false);
  }finally{f.close();}
});
test('background preflight respects uncertain effects and owner changes',async()=>{
  const f=fixture();try{
    let calls=0,blocked=false;
    const deps={Safety:f.w.GreenfieldSafetyPolicy,readSafety:async()=>({policy:f.w.GreenfieldSafetyPolicy.defaults}),
      providerTransportPending:()=>false,holdForSafety:async(p,d)=>({...p,hold:d}),
      transportTransitionBoundary:async p=>({blocked,process:p}),bridgeMessage:async()=>{calls++;return f.ensure();},
      tabState:async()=>({...await f.w.pageState(),url:f.w.location.href}),audit:async()=>{}};
    const run=Function(...Object.keys(deps),body('ensureHighestThinkingBeforeSend',background)+';return ensureHighestThinkingBeforeSend;')(...Object.values(deps));
    const p={phase:'SENDING',tabId:1,gptRoot,pendingPrompt:{hash:'hash',dispatch:{effectPossible:null}}};
    const page={...await f.w.pageState(),url};
    assert.equal((await run(p,page)).handled,true);assert.equal(calls,0);
    p.pendingPrompt.dispatch=null;blocked=true;await run(p,page);assert.equal(calls,0);
    blocked=false;const result=await run(p,page);assert.equal(result.handled,false);assert.equal(calls,1);assert.equal(result.page.modelEvidence.highestEffort.status,'VERIFIED');
  }finally{f.close();}
});
test('real submitPrompt never clicks if level resets after background authorization',async()=>{
  const f=fixture();try{
    await f.ensure();
    const w=f.w,composer=f.d.querySelector('[contenteditable]');
    Object.assign(w,{
      dispatchRecords:new Map(),forensic:()=>{},serializeError:e=>({message:e.message}),getComposer:()=>composer,
      normalizeText:s=>String(s||''),sha256Hex:async()=>'hash',setNativeValue:(el,value)=>{el.textContent=value;},
      getSendButton:()=>f.d.querySelector('[data-testid="send-button"]'),
      chrome:{runtime:{sendMessage:async()=>{f.setLabel('Balanserad');return {ok:true,policy:w.GreenfieldSafetyPolicy.defaults,gptRoot};}}}
    });
    w.eval(body('submitPrompt',content)+'\nwindow.submitPrompt=submitPrompt;');
    const r=await w.submitPrompt('work','hash','dispatch-1',{policy:w.GreenfieldSafetyPolicy.defaults,gptRoot});
    assert.equal(r.ok,false);assert.equal(r.effectPossible,false);assert.equal(f.counts.sends,0);assert.equal(r.code,'THINKING_MAXIMUM_UNVERIFIED');
  }finally{f.close();}
});
test('verified maximum allows one real submitPrompt click and its receipt prevents replay',async()=>{
  const f=fixture();try{
    const w=f.w,composer=f.d.querySelector('[contenteditable]');
    await f.ensure();
    Object.assign(w,{
      dispatchRecords:new Map(),forensic:()=>{},serializeError:e=>({message:e.message}),getComposer:()=>composer,
      normalizeText:s=>String(s||''),sha256Hex:async()=>'hash',setNativeValue:(el,value)=>{el.textContent=value;},
      getSendButton:()=>f.d.querySelector('[data-testid="send-button"]'),promptMarkerValue:s=>s,
      publishDispatchMaterialization:async()=>({userTurnId:'u1'}),
      waitForMaterialization:async()=>({acknowledged:true,evidence:'USER_TURN',elapsedMs:1,state:{},rateLimitDetected:false}),
      chrome:{runtime:{sendMessage:async()=>({ok:true,policy:w.GreenfieldSafetyPolicy.defaults,gptRoot})}}
    });
    w.eval(body('submitPrompt',content)+'\nwindow.submitPrompt=submitPrompt;');
    const args=['initialization','hash','dispatch-1',{policy:w.GreenfieldSafetyPolicy.defaults,gptRoot}];
    const first=await w.submitPrompt(...args);assert.equal(first.ok,true,JSON.stringify(first));assert.equal(f.counts.sends,1);
    const second=await w.submitPrompt(...args);assert.equal(second.acknowledged,true);assert.equal(f.counts.sends,1);
  }finally{f.close();}
});
test('quota notice and wrong GPT stop selection before any click',async()=>{
  for(const kind of ['quota','wrong-gpt']){
    const f=fixture();try{
      if(kind==='quota'){const e=f.d.createElement('div');e.setAttribute('role','alert');e.textContent="You have reached your message limit";f.d.body.append(e);}
      else f.w.history.pushState({},'','/g/g-other/c/conversation');
      const r=await f.ensure();assert.equal(r.ok,false);assert.equal(f.counts.opens,0);assert.equal(f.counts.sends,0);
    }finally{f.close();}
  }
});
test('ambiguous controls are left unchanged; a related open menu is recovered',async()=>{
  const f=fixture();try{
    const duplicate=f.trigger.cloneNode(true);f.trigger.parentElement.append(duplicate);
    assert.equal((await f.ensure()).ok,false);assert.equal(f.counts.opens,0);
    duplicate.remove();f.trigger.click();
    assert.equal((await f.ensure()).ok,true);assert.equal(f.proof().allowed,true);assert.equal(f.counts.sends,0);
  }finally{f.close();}
});

test('already selected option is verified after a generic open-menu label closes',async()=>{
  const f=fixture({type:'options',initial:'Pro'});try{
    let choiceClicks=0;
    f.trigger.addEventListener('click',()=>{
      if(f.trigger.getAttribute('aria-expanded')==='true'){
        f.trigger.querySelector('.ModelPickerTriggerLabel-xR9gDc').textContent='Resonemangsansträngning';
        f.d.querySelectorAll('[role=menuitemradio]').forEach(el=>el.addEventListener('click',()=>choiceClicks++));
      }else f.setLabel('Pro');
    });
    const result=await f.ensure();assert.equal(result.ok,true,JSON.stringify(result));
    assert.equal(result.changed,false);assert.equal(f.proof().allowed,true);assert.equal(choiceClicks,0);
  }finally{f.close();}
});
