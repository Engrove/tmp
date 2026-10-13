import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const root=new URL('../',import.meta.url);
const source=await readFile(new URL('lib/thinking-control.js',root),'utf8');
const baseline=process.env.GREENFIELD_BASELINE_ADAPTER;
const adapter=baseline ? await readFile(baseline,'utf8') : source;
const policy=await readFile(new URL('lib/safety-policy.js',root),'utf8');
const observation=await readFile(new URL('lib/model-observation.js',root),'utf8');
const captured=await readFile(new URL('tests/fixtures/reasoning-trigger-2026-10-13.html',root),'utf8');
const url='https://chatgpt.com/g/g-test/c/thread';

// The closed trigger is captured HTML. Open surfaces/events are an explicit
// test model of the screenshots and Radix hover/dropdown semantics, not a
// claim that the user's open ChatGPT DOM has been captured or live-tested.
function fixture({hover=true,preopened=false,replace=false,unlinked=false,refuseClose=false,noReadback=false,guard=async()=>({ok:true})}={}) {
  const dom=new JSDOM(`<form><textarea></textarea><span data-state="closed">${captured}</span></form>`,{url,runScripts:'outside-only'});
  const w=dom.window,d=w.document;
  w.HTMLElement.prototype.getBoundingClientRect=function(){return {left:40,top:40,width:120,height:30};};
  w.eval(policy);w.eval(observation);w.eval(adapter);
  const counts={hover:0,models:0,modelSelections:0,maximum:0,escapes:0};
  let active=d.querySelector('button'),value=3,hoverTimer=null;
  const update=()=>{
    active.setAttribute('data-selected-reasoning-effort',value===4?'pro':'max');
    active.querySelector('.ModelPickerTriggerLabel-xR9gDc').textContent=value===4?'Pro':'Extra hög';
  };
  const closeHover=()=>{if(refuseClose)return;d.getElementById('reasoning-tip')?.remove();active.removeAttribute('aria-describedby');};
  const closeModel=()=>{if(refuseClose)return;d.getElementById('model-menu')?.remove();active.setAttribute('aria-expanded','false');active.removeAttribute('aria-controls');};
  function openModels() {
    if(d.getElementById('model-menu')){closeModel();return;}
    closeHover();counts.models++;active.setAttribute('aria-expanded','true');
    if(!unlinked)active.setAttribute('aria-controls','model-menu');
    const menu=d.createElement('div');menu.id='model-menu';menu.setAttribute('role','menu');
    // Pro is intentionally enabled to prove it cannot be mistaken for effort.
    for(const name of ['6','GPT-5.6 Sol','GPT-5.5','Pro']) {
      const item=d.createElement('div');item.setAttribute('role','menuitem');item.textContent=name;
      item.addEventListener('click',()=>counts.modelSelections++);menu.append(item);
    }
    d.body.append(menu);
  }
  function bind(button) {
    button.addEventListener('click',openModels);
    button.addEventListener('keydown',e=>{if(e.key==='ArrowDown')openModels();});
    button.addEventListener('pointerover',()=>{
      if(!hover || hoverTimer || d.getElementById('reasoning-tip') || d.getElementById('model-menu'))return;
      counts.hover++;hoverTimer=w.setTimeout(()=>{
        hoverTimer=null;
        if(replace){const fresh=active.cloneNode(true);active.replaceWith(fresh);active=fresh;bind(active);}
        const tip=d.createElement('div');tip.id='reasoning-tip';tip.setAttribute('role','tooltip');
        tip.setAttribute('data-state','open');active.setAttribute('aria-describedby',tip.id);
        const slider=d.createElement('span');slider.tabIndex=0;slider.setAttribute('role','slider');
        for(const [key,val] of Object.entries({'aria-valuemin':0,'aria-valuemax':4,'aria-valuenow':value}))slider.setAttribute(key,String(val));
        slider.addEventListener('keydown',e=>{
          if(e.key!=='End')return;counts.maximum++;value=4;slider.setAttribute('aria-valuenow','4');
          if(!noReadback)update();
          if(replace){const fresh=active.cloneNode(true);active.replaceWith(fresh);active=fresh;bind(active);}
        });
        tip.append(slider);d.body.append(tip);
      },100);
    });
    button.addEventListener('pointerout',()=>{if(hoverTimer){w.clearTimeout(hoverTimer);hoverTimer=null;}closeHover();});
  }
  d.addEventListener('keydown',e=>{if(e.key==='Escape'){counts.escapes++;closeHover();closeModel();}});
  update();bind(active);
  if(preopened)openModels();
  return {w,d,counts,current:()=>active,openModels,
    ensure:()=>w.GreenfieldThinkingControl.ensureHighest({expectedUrl:url,guard}),
    close:()=>{w.GreenfieldThinkingControl.dispose();dom.window.close();}};
}

test('dual-purpose picker: hover reaches maximum without opening or selecting a model',async()=>{
  const f=fixture();try{
    const r=await f.ensure();assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.proof.label,'Pro');
    assert.equal(f.counts.models,0);assert.equal(f.counts.modelSelections,0);assert.equal(f.counts.maximum,1);
    assert.equal(f.d.querySelector('[role=tooltip]'),null);assert.equal(f.current().getAttribute('aria-expanded'),'false');
    assert.equal(f.w.GreenfieldThinkingControl.diagnostics().openingMethod,'HOVER');
  }finally{f.close();}
});

test('open model menu from a previous attempt is closed before opening the reasoning surface',async()=>{
  const f=fixture({preopened:true});try{
    const r=await f.ensure();assert.equal(r.ok,true,JSON.stringify(r));assert.equal(f.counts.models,1);
    assert.equal(f.counts.modelSelections,0);assert.equal(f.w.GreenfieldThinkingControl.diagnostics().recoveredOpenMenu,true);
  }finally{f.close();}
});

test('replaced trigger can be closed after selection and yields a valid maximum receipt',async()=>{
  const f=fixture({replace:true});try{
    const before=f.current(),r=await f.ensure();assert.equal(r.ok,true,JSON.stringify(r));assert.notEqual(f.current(),before);
    assert.equal(f.d.querySelector('[role=tooltip]'),null);assert.ok(f.w.GreenfieldThinkingControl.proof());
    assert.equal(f.counts.models,0);
  }finally{f.close();}
});

test('model-only list never selects its bare Pro item and does not repeat UI actions on unchanged retries',async()=>{
  const f=fixture({hover:false});try{
    const first=await f.ensure();assert.equal(first.ok,false);assert.equal(first.code,'THINKING_OPTIONS_UNVERIFIED');
    assert.equal(f.counts.modelSelections,0);assert.equal(f.d.getElementById('model-menu'),null);
    const before={...f.counts};
    for(let n=0;n<3;n++){const r=await f.ensure();assert.equal(r.repeated,true);assert.equal(r.code,first.code);}
    assert.deepEqual(f.counts,before);assert.equal(f.w.GreenfieldThinkingControl.proof(),null);
    assert.equal(f.w.GreenfieldModelObservation.observe().thinkingControl.suppressedRepeatedActions,true);
    f.w.GreenfieldThinkingControl.retry();await f.ensure();assert.equal(f.counts.models,before.models+1);
  }finally{f.close();}
});

test('unlinked already-open menu is left untouched and unchanged retries do not click it',async()=>{
  const f=fixture({preopened:true,unlinked:true});try{
    const first=await f.ensure();assert.equal(first.code,'THINKING_MENU_OWNERSHIP_UNVERIFIED');
    assert.equal(f.counts.escapes,0);assert.equal(f.counts.models,1);assert.equal(f.counts.modelSelections,0);
    assert.equal((await f.ensure()).repeated,true);assert.equal(f.counts.escapes,0);
  }finally{f.close();}
});

test('failure after DOM replacement cleans up the owned surface and prevents a timeout/open-menu cycle',async()=>{
  const f=fixture({replace:true,noReadback:true});try{
    const now=f.w.Date.now.bind(f.w.Date);let offset=0;
    f.w.Date.now=()=>now()+offset;
    const timer=setTimeout(()=>{offset=7000;},500);
    const first=await f.ensure();clearTimeout(timer);
    assert.equal(first.code,'THINKING_SELECTION_TIMEOUT');assert.equal(f.d.getElementById('reasoning-tip'),null);
    const before={...f.counts};
    assert.equal((await f.ensure()).repeated,true);assert.deepEqual(f.counts,before);assert.equal(f.w.GreenfieldThinkingControl.proof(),null);
  }finally{f.close();}
});

test('a menu that refuses dismissal is not repeatedly toggled by later retries',async()=>{
  const f=fixture({preopened:true,refuseClose:true});try{
    const first=await f.ensure();assert.equal(first.code,'THINKING_MENU_CLOSE_FAILED');
    const before={...f.counts};assert.equal((await f.ensure()).repeated,true);assert.deepEqual(f.counts,before);
    assert.equal(f.w.GreenfieldThinkingControl.proof(),null);
  }finally{f.close();}
});

test('unrelated pre-existing menus are preserved when the composer hover is used',async()=>{
  const f=fixture();try{
    const unrelated=f.d.createElement('div');unrelated.setAttribute('role','menu');unrelated.textContent='Other menu';f.d.body.append(unrelated);
    assert.equal((await f.ensure()).ok,true);assert.equal(unrelated.isConnected,true);
  }finally{f.close();}
});

test('a guard rejection forbids menu recovery and maximum selection',async()=>{
  const f=fixture({preopened:true,guard:async()=>({ok:false,code:'OPERATOR_DRAFT_PRESENT'})});try{
    const r=await f.ensure();assert.equal(r.code,'OPERATOR_DRAFT_PRESENT');assert.equal(f.counts.escapes,0);assert.equal(f.counts.maximum,0);
  }finally{f.close();}
});

test('operator recheck resets the failed attempt through the real content handler',async()=>{
  const content=await readFile(new URL('content.js',root),'utf8');
  const start=content.indexOf('  async function handle('),tail=content.slice(start);
  const end=/^  }\s*$/m.exec(tail);
  assert.ok(start>=0 && end);
  const f=fixture();try{
    let resets=0;
    f.w.GreenfieldThinkingControl={retry:()=>resets++};
    f.w.assertContentActive=()=>{};f.w.pageState=async()=>({});
    f.w.eval(tail.slice(0,end.index+end[0].length)+'\nwindow.realHandle=handle;');
    await f.w.realHandle({type:'EIC_GF_GET_PAGE_STATE',source:'diagnostics-export'});assert.equal(resets,0);
    await f.w.realHandle({type:'EIC_GF_GET_PAGE_STATE',source:'operator-model-recheck'});assert.equal(resets,1);
    await f.w.realHandle({type:'EIC_GF_GET_PAGE_STATE',source:'operator-model-recheck-after-bridge-refresh'});assert.equal(resets,2);
  }finally{f.w.GreenfieldThinkingControl={dispose(){}};f.close();}
});
