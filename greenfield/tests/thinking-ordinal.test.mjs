import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const root=new URL('../',import.meta.url);
const read=name=>readFile(new URL(name,root),'utf8');
const [policy,observation,installedAdapter,captured,background,content]=await Promise.all([
  read('lib/safety-policy.js'),read('lib/model-observation.js'),read('lib/thinking-control.js'),
  read('tests/fixtures/reasoning-trigger-2026-10-13.html'),read('background.js'),read('content.js')
]);
const adapter=process.env.GREENFIELD_BASELINE_ADAPTER ? await readFile(process.env.GREENFIELD_BASELINE_ADAPTER,'utf8') : installedAdapter;
const url='https://chatgpt.com/g/g-test/c/ordinal',gptRoot='https://chatgpt.com/g/g-test';
const frequencies=[];
const labels=['Balanserad','Hög','Extra hög','Extra hög'];

// Open DOM/handlers are constructed from the diagnostic text, not a live DOM capture.
function fixture({initial=4,kind='text',rerender=false,reject=false,staleReadback=false,conflict=false,modelOnly=false,seed=1,max=4,guard=async()=>({ok:true})}={}) {
  const dom=new JSDOM(`<form><textarea></textarea>${captured}<button data-testid="send-button">Send</button></form>`,{url,runScripts:'outside-only'});
  const w=dom.window,d=w.document;
  d.querySelector('form').addEventListener('submit',event=>event.preventDefault());
  let now=0,random=seed,selected=initial,trigger=d.querySelector('[data-codex-intelligence-trigger]'),timerId=0;
  const counts={navigation:0,input:0,sends:0,opens:0};
  const timers=new Set();
  w.Date.now=()=>1791875260000+now;
  w.setTimeout=(fn,ms=0)=>{const id=++timerId;timers.add(id);queueMicrotask(()=>{if(timers.delete(id)){random=(Math.imul(random,1664525)+1013904223)>>>0;now+=ms+random%11;fn();}});return id;};
  w.clearTimeout=id=>timers.delete(id);
  w.HTMLElement.prototype.getBoundingClientRect=()=>({left:1,top:1,width:160,height:24});
  const label=()=>selected===max?'Extra hög':labels[Math.min(selected-1,1)];
  const update=(generic=false)=>{
    const value=staleReadback?'Balanserad':label();
    trigger.querySelector('.ModelPickerTriggerLabel-xR9gDc').textContent=generic?'Resonemangsansträngning':value;
    trigger.setAttribute('data-selected-reasoning-effort',value==='Extra hög'?'max':value==='Hög'?'high':'medium');
  };
  function close(){d.getElementById('ordinal-menu')?.remove();d.getElementById('ordinal-tip')?.remove();trigger.setAttribute('aria-expanded','false');trigger.removeAttribute('aria-controls');update();}
  function openModels(){counts.navigation++;const p=d.getElementById('ordinal-menu');p.innerHTML='<div role="menuitem">GPT-5.6 Sol</div><button role="menuitem">Pro</button>';update();}
  function build(){
    const popup=d.createElement('div');popup.id='ordinal-menu';popup.setAttribute('role','menu');
    const nav=d.createElement('button');nav.type='button';nav.textContent=label();nav.addEventListener('click',openModels);popup.append(nav);
    if(!modelOnly){
      const controller=d.createElement('div');controller.tabIndex=0;
      if(kind==='numeric')for(const [k,v] of Object.entries({'aria-valuemin':1,'aria-valuemax':max,'aria-valuenow':selected}))controller.setAttribute(k,String(v));
      const status=d.createElement('span');status.id='ordinal-status';
      const announcement=`${label()}, ${selected} av ${max}. Använd vänster- och högerpiltangenterna för att justera prestandan`;
      if(kind==='aria')controller.setAttribute('aria-label',announcement);
      else if(kind==='description'){controller.setAttribute('aria-describedby',status.id);status.textContent=announcement;}
      else status.textContent=announcement;
      controller.append(status);popup.append(controller);
      if(conflict){const other=d.createElement('div');other.tabIndex=0;other.textContent='Hög, 2 av 6. Använd vänster- och högerpiltangenterna';popup.append(other);}
      controller.addEventListener('keydown',e=>{
        if(e.key!=='ArrowRight'&&e.key!=='End')return;
        if(kind!=='numeric'&&e.key==='End')return;
        // Numeric custom controls also support only the advertised arrow keys.
        if(kind==='numeric'&&e.key==='End')return;
        counts.input++;if(reject)return;
        selected=Math.min(max,selected+1);update(true);
        if(rerender){const replacement=trigger.cloneNode(true);trigger.replaceWith(replacement);trigger=replacement;bind();}
        popup.replaceWith(build());
      });
    }
    return popup;
  }
  function open(){if(d.getElementById('ordinal-menu'))return;counts.opens++;d.getElementById('ordinal-tip')?.remove();trigger.setAttribute('aria-expanded','true');trigger.setAttribute('aria-controls','ordinal-menu');update(true);d.body.append(build());}
  function bind(){
    trigger.addEventListener('keydown',e=>{if(e.key==='ArrowDown')open();});
    trigger.addEventListener('click',()=>trigger.getAttribute('aria-expanded')==='true'?close():open());
    trigger.addEventListener('pointerover',()=>{if(d.getElementById('ordinal-tip')||d.getElementById('ordinal-menu'))return;const tip=d.createElement('div');tip.id='ordinal-tip';tip.setAttribute('role','tooltip');tip.textContent='ResonemangsansträngningCtrl+Shift+M';d.body.append(tip);});
    trigger.addEventListener('pointerout',()=>d.getElementById('ordinal-tip')?.remove());
  }
  d.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
  d.querySelector('[data-testid="send-button"]').addEventListener('click',()=>counts.sends++);
  update();bind();w.eval(policy);w.eval(observation);w.eval(adapter);
  return {w,d,counts,selected:()=>selected,set(value){selected=value;update();},
    ensure:()=>w.GreenfieldThinkingControl.ensureHighest({expectedUrl:w.location.href,guard}),
    proof:()=>w.GreenfieldSafetyPolicy.evaluateModel(w.GreenfieldModelObservation.observe(),undefined,{url:w.location.href,gptRoot,requireHighestEffort:true}),
    close(){w.GreenfieldThinkingControl.dispose();dom.window.close();}};
}

for(const kind of ['text','aria','description','numeric'])test(`${kind}: advertised maximum succeeds without clicking model navigation`,async()=>{
  const f=fixture({kind});try{
    const result=await f.ensure();assert.equal(result.ok,true,JSON.stringify(result));
    assert.equal(f.proof().allowed,true);assert.equal(f.counts.navigation,0);assert.equal(f.counts.input,0);assert.equal(f.counts.sends,0);
  }finally{f.close();}
});
for(const kind of ['text','aria','description','numeric'])test(`${kind}: Balanced reaches discovered maximum with arrow-only control`,async()=>{
  const f=fixture({kind,initial:1,rerender:true});try{
    const result=await f.ensure();assert.equal(result.ok,true,JSON.stringify(result));
    assert.equal(f.selected(),4);assert.equal(f.proof().allowed,true);assert.equal(f.counts.input,3);assert.equal(f.counts.navigation,0);
    assert.equal(f.d.getElementById('ordinal-menu'),null);
  }finally{f.close();}
});
test('six seeded failures become six successes without changing the modeled external menu',async()=>{
  for(let seed=1;seed<=6;seed++){
    const f=fixture({seed});try{
      const result=await f.ensure();frequencies.push({seed,ok:result.ok,code:result.code||'VERIFIED',navigationClicks:f.counts.navigation});
    }finally{f.close();}
  }
  if(process.env.GREENFIELD_FREQUENCY_OUTPUT)await writeFile(process.env.GREENFIELD_FREQUENCY_OUTPUT,JSON.stringify({scope:'CONSTRUCTED_DOM_NOT_LIVE_CHROME',rows:frequencies},null,2)+'\n');
  assert.equal(frequencies.filter(r=>!r.ok).length,0,JSON.stringify(frequencies));
});
test('the maximum is discovered rather than hard-coded to four',async()=>{
  const f=fixture({max:6,initial:3});try{assert.equal((await f.ensure()).ok,true);assert.equal(f.selected(),6);assert.equal(f.counts.navigation,0);}finally{f.close();}
});
test('unknown singleton named button is never clicked or accepted as maximum',async()=>{
  const f=fixture({modelOnly:true});try{assert.equal((await f.ensure()).ok,false);assert.equal(f.proof().allowed,false);assert.equal(f.counts.navigation,0);}finally{f.close();}
});
test('conflicting ordinal controls cannot authorize a send',async()=>{
  const f=fixture({conflict:true});try{assert.equal((await f.ensure()).ok,false);assert.equal(f.proof().allowed,false);assert.equal(f.counts.input,0);assert.equal(f.counts.navigation,0);}finally{f.close();}
});
test('rejected input stays blocked and unchanged retries make no new actions',async()=>{
  const f=fixture({initial:1,reject:true});try{
    assert.equal((await f.ensure()).ok,false);assert.equal(f.proof().allowed,false);const prior={...f.counts};
    assert.equal((await f.ensure()).repeated,true);assert.deepEqual(f.counts,prior);
  }finally{f.close();}
});
test('maximum announcement with stale closed selection is rejected',async()=>{
  const f=fixture({initial:1,staleReadback:true});try{assert.equal((await f.ensure()).ok,false);assert.equal(f.proof().allowed,false);assert.equal(f.counts.sends,0);}finally{f.close();}
});
test('new session invalidates ordinal receipt and maximizes Balanced again',async()=>{
  const f=fixture();try{
    assert.equal((await f.ensure()).ok,true);f.w.history.pushState({},'','/g/g-test/c/new-session');f.set(1);
    assert.equal(f.proof().allowed,false);assert.equal((await f.ensure()).ok,true);assert.equal(f.selected(),4);assert.equal(f.counts.opens,2);
  }finally{f.close();}
});
test('a paused or rejected context does not hold another context',async()=>{
  const paused=fixture({initial:1,guard:async()=>({ok:false,code:'ADMISSION_PAUSED'})}),active=fixture({initial:1});
  try{const [a,b]=await Promise.all([paused.ensure(),active.ensure()]);assert.equal(a.ok,false);assert.equal(b.ok,true);assert.equal(paused.counts.opens,0);assert.equal(active.selected(),4);}finally{paused.close();active.close();}
});

function functionSource(name,source,indent=''){
  const start=source.indexOf(`${indent}async function ${name}(`);assert.ok(start>=0);
  const tail=source.slice(start),end=new RegExp('^'+indent+'}\\s*$','m').exec(tail);assert.ok(end);
  return tail.slice(0,end.index+end[0].length);
}
test('real background maximum preflight releases initialization; real submit sends exactly once',async()=>{
  const f=fixture({initial:1});try{
    const w=f.w,composer=f.d.querySelector('textarea');
    const page=()=>({documentId:'doc-ordinal',url:w.location.href,generating:false,composerReady:true,composerEmpty:true,modelEvidence:w.GreenfieldModelObservation.observe()});
    const deps={Safety:w.GreenfieldSafetyPolicy,readSafety:async()=>({policy:w.GreenfieldSafetyPolicy.defaults}),providerTransportPending:()=>false,
      holdForSafety:async(p,d)=>({...p,hold:d}),transportTransitionBoundary:async p=>({blocked:false,process:p}),bridgeMessage:async()=>f.ensure(),tabState:async()=>page(),audit:async()=>{}};
    const preflight=Function(...Object.keys(deps),functionSource('ensureHighestThinkingBeforeSend',background)+';return ensureHighestThinkingBeforeSend;')(...Object.values(deps));
    const process={phase:'SENDING',tabId:1,gptRoot,pendingPrompt:{hash:'hash',dispatch:null}};
    const allowed=await preflight(process,page());assert.equal(allowed.handled,false,JSON.stringify(allowed));
    Object.assign(w,{DOCUMENT_ID:'doc-ordinal',assertContentActive:()=>{},dispatchRecords:new Map(),forensic:()=>{},serializeError:e=>({message:e.message}),
      pageState:async()=>page(),getComposer:()=>composer,normalizeText:s=>String(s||''),sha256Hex:async()=>'hash',setNativeValue:(el,v)=>{el.value=v;},
      getSendButton:()=>f.d.querySelector('[data-testid="send-button"]'),promptMarkerValue:s=>s,sendRuntimeMessage:async()=>({ok:true,policy:w.GreenfieldSafetyPolicy.defaults,gptRoot}),
      publishDispatchMaterialization:async()=>({userTurnId:'init-ready'}),waitForMaterialization:async()=>({acknowledged:true,evidence:'USER_TURN',elapsedMs:1,state:{},rateLimitDetected:false})});
    w.eval(functionSource('submitPrompt',content,'  ')+'\nwindow.realSubmit=submitPrompt;');
    const args=['Open project 71. Reply only READY.','hash','initialization-1',{policy:w.GreenfieldSafetyPolicy.defaults,gptRoot}];
    assert.equal((await w.realSubmit(...args)).ok,true);assert.equal((await w.realSubmit(...args)).acknowledged,true);assert.equal(f.counts.sends,1);assert.equal(f.counts.navigation,0);
  }finally{f.close();}
});
