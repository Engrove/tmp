import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {fieldModelMenu} from './fixtures/field-model-menu-2026-10-13.mjs';

const root=new URL('../',import.meta.url);
const read=name=>readFile(new URL(name,root),'utf8');
const [policy,observation,installedAdapter,captured]=await Promise.all([
  read('lib/safety-policy.js'),read('lib/model-observation.js'),read('lib/thinking-control.js'),
  read('tests/fixtures/reasoning-trigger-2026-10-13.html')
]);
// Negative control: GREENFIELD_BASELINE_ADAPTER=rare/repro_harness/thinking-control-1.9.12.js fails here.
const adapter=process.env.GREENFIELD_BASELINE_ADAPTER ? await readFile(process.env.GREENFIELD_BASELINE_ADAPTER,'utf8') : installedAdapter;
const menu=options=>fieldModelMenu({JSDOM,policy,observation,adapter,captured,...options});

for(const variant of ['describedby','arialabel'])for(const start of [4,1])test(`field menu (${variant}) from ${start}/4 is verified at the announced maximum`,async()=>{
  for(let seed=1;seed<=3;seed++){
    const f=menu({variant,start,seed});try{
      const result=await f.ensure();assert.equal(result.ok,true,JSON.stringify({seed,result,diagnostics:f.diagnostics()}));
      assert.equal(f.position(),4);assert.equal(f.proof().allowed,true);
      assert.equal(f.counts.input,4-start);assert.equal(f.counts.navigation,0);
      assert.equal(f.d.getElementById('radix-_r_29_'),null);
    }finally{f.close();}
  }
});

test('two keyboard controls with identical announcements stay ambiguous and report their candidates',async()=>{
  const f=menu({variant:'twin'});try{
    const result=await f.ensure();assert.equal(result.code,'THINKING_CONTROL_AMBIGUOUS');assert.equal(f.proof().allowed,false);
    assert.equal(f.counts.input,0);assert.equal(f.counts.navigation,0);
    const candidates=f.diagnostics().ordinalCandidates;
    assert.ok(candidates.length>=2,JSON.stringify(candidates));
    assert.ok(candidates.some(c=>c.ariaLabel==='Prestanda' && c.describedBy==='wp-value wp-instructions' && c.now===4 && c.max===4),JSON.stringify(candidates));
  }finally{f.close();}
});

function functionSource(name,source,indent=''){
  const start=source.indexOf(`${indent}async function ${name}(`);assert.ok(start>=0);
  const tail=source.slice(start),end=new RegExp('^'+indent+'}\\s*$','m').exec(tail);assert.ok(end);
  return tail.slice(0,end.index+end[0].length);
}
test('field menu: real background preflight releases initialization; real submit sends exactly once',async()=>{
  const [background,content]=await Promise.all([read('background.js'),read('content.js')]);
  const f=menu({variant:'describedby'});try{
    const w=f.w,composer=f.d.querySelector('textarea');let sends=0;
    f.d.querySelector('[data-testid="send-button"]').addEventListener('click',()=>sends++);
    const page=()=>({documentId:'doc-field',url:w.location.href,generating:false,composerReady:true,composerEmpty:true,modelEvidence:w.GreenfieldModelObservation.observe()});
    const holds=[];
    const deps={Safety:w.GreenfieldSafetyPolicy,readSafety:async()=>({policy:w.GreenfieldSafetyPolicy.defaults}),providerTransportPending:()=>false,
      holdForSafety:async(p,d)=>{holds.push(d);return {...p,hold:d};},transportTransitionBoundary:async p=>({blocked:false,process:p}),bridgeMessage:async()=>f.ensure(),tabState:async()=>page(),audit:async()=>{}};
    const preflight=Function(...Object.keys(deps),functionSource('ensureHighestThinkingBeforeSend',background)+';return ensureHighestThinkingBeforeSend;')(...Object.values(deps));
    const process={phase:'SENDING',tabId:1,gptRoot:w.location.href,pendingPrompt:{hash:'hash',dispatch:null}};
    const allowed=await preflight(process,page());assert.equal(allowed.handled,false,JSON.stringify({allowed,holds,diagnostics:f.diagnostics()}));
    Object.assign(w,{DOCUMENT_ID:'doc-field',assertContentActive:()=>{},dispatchRecords:new Map(),forensic:()=>{},serializeError:e=>({message:e.message}),
      pageState:async()=>page(),getComposer:()=>composer,normalizeText:s=>String(s||''),sha256Hex:async()=>'hash',setNativeValue:(el,v)=>{el.value=v;},
      getSendButton:()=>f.d.querySelector('[data-testid="send-button"]'),promptMarkerValue:s=>s,sendRuntimeMessage:async()=>({ok:true,policy:w.GreenfieldSafetyPolicy.defaults,gptRoot:w.location.href}),
      publishDispatchMaterialization:async()=>({userTurnId:'init-ready'}),waitForMaterialization:async()=>({acknowledged:true,evidence:'USER_TURN',elapsedMs:1,state:{},rateLimitDetected:false})});
    w.eval(functionSource('submitPrompt',content,'  ')+'\nwindow.realSubmit=submitPrompt;');
    const args=['Open project 71. Reply only READY.','hash','initialization-1',{policy:w.GreenfieldSafetyPolicy.defaults,gptRoot:w.location.href}];
    assert.equal((await w.realSubmit(...args)).ok,true);assert.equal((await w.realSubmit(...args)).acknowledged,true);
    assert.equal(sends,1);assert.equal(f.counts.navigation,0);assert.equal(holds.length,0);
  }finally{f.close();}
});
