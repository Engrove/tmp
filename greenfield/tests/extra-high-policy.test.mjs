import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {JSDOM} from 'jsdom';
const root=process.env.GF_QUALITY_BASELINE ? pathToFileURL(resolve(process.env.GF_QUALITY_BASELINE)+'/') : new URL('../',import.meta.url);
const read=n=>readFile(new URL(n,root),'utf8');
const [policy,adapter,observation]=await Promise.all(['lib/safety-policy.js','lib/thinking-control.js','lib/model-observation.js'].map(read));
const url='https://chatgpt.com/g/g-policy-eic/c/same-turn';
// Constructed controls with real adapter code; visibility, timers and event handlers are simulated.
function fixture({kind='ordinal',initial=1,missing=false,disabledTarget=false,readback=true,replace=false}={}) {
 const labels=missing?['Balanserad','Utökad','Hög','Pro']:['Balanserad','Utökad','Hög','Extra hög','Pro'];
 const dom=new JSDOM('<form><textarea></textarea><button type="button" id="effort" data-codex-intelligence-trigger="true" aria-label="Välj ChatGPT-modell" aria-haspopup="menu" aria-expanded="false"></button></form>',{url,runScripts:'outside-only'});
 const w=dom.window,d=w.document;w.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:100,height:30});
 let position=initial,tick=0;const counts={pro:0,keys:[],opens:0};const timers=new Set();let timer=0;
 w.Date.now=()=>1792480000000+tick;
 w.setTimeout=(fn,ms=0)=>{const id=++timer;timers.add(id);queueMicrotask(()=>{if(timers.delete(id)){tick+=ms;fn();}});return id;};w.clearTimeout=id=>timers.delete(id);
 const trigger=()=>d.getElementById('effort');
 const selected=()=>labels[position-1];
 const update=()=>{trigger().textContent=selected();trigger().setAttribute('data-selected-reasoning-effort',selected()==='Extra hög'?'max':'medium');};
 const close=()=>{d.getElementById('choices')?.remove();trigger().setAttribute('aria-expanded','false');trigger().removeAttribute('aria-controls');update();};
 const apply=value=>{if(value===position)return;position=value;if(selected()==='Pro')counts.pro++;if(readback)update();if(replace){const n=trigger().cloneNode(true);trigger().replaceWith(n);bind();}d.getElementById('choices')?.replaceWith(menu());};
 function menu(){
  const p=d.createElement('div');p.id='choices';p.setAttribute('role','menu');
  if(kind==='options')for(let i=0;i<labels.length;i++){
   const b=d.createElement('button');b.textContent=labels[i];b.setAttribute('role','menuitemradio');b.setAttribute('aria-checked',String(i===position-1));if(disabledTarget&&labels[i]==='Extra hög')b.setAttribute('aria-disabled','true');b.addEventListener('click',()=>{apply(i+1);close();});p.append(b);
  }else{
   const c=d.createElement(kind==='range'?'input':'div');c.tabIndex=0;
   if(kind==='range'){c.type='range';c.min='1';c.max=String(labels.length);c.value=String(position);c.step='1';c.setAttribute('aria-valuetext',selected());c.addEventListener('input',()=>apply(Number(c.value)));}
   else if(kind==='slider'){c.setAttribute('role','slider');for(const[k,v]of Object.entries({'aria-valuemin':1,'aria-valuemax':labels.length,'aria-valuenow':position,'aria-valuetext':selected()}))c.setAttribute(k,String(v));}
   else c.textContent=`${selected()}, ${position} av ${labels.length}. Använd vänster- och högerpiltangenterna för att justera prestandan`;
   c.addEventListener('keydown',e=>{counts.keys.push(e.key);if(e.key==='End')apply(labels.length);if(e.key==='ArrowRight')apply(Math.min(labels.length,position+1));if(e.key==='ArrowLeft')apply(Math.max(1,position-1));});p.append(c);
  }return p;
 }
 function open(){if(d.getElementById('choices'))return;counts.opens++;trigger().setAttribute('aria-expanded','true');trigger().setAttribute('aria-controls','choices');d.body.append(menu());}
 function bind(){trigger().addEventListener('pointerover',open);trigger().addEventListener('click',()=>d.getElementById('choices')?close():open());trigger().addEventListener('keydown',e=>{if(e.key==='ArrowDown')open();});}
 d.addEventListener('keydown',e=>{if(e.key==='Escape')close();});update();bind();w.eval(policy);w.eval(observation);w.eval(adapter);
 return {w,d,counts,selected,ensure:()=>w.GreenfieldThinkingControl.ensureHighest({expectedUrl:url,guard:async()=>({ok:true})}),proof:()=>w.GreenfieldSafetyPolicy.evaluateModel(w.GreenfieldModelObservation.observe(),undefined,{url,gptRoot:url,requireHighestEffort:true}),close(){w.GreenfieldThinkingControl.dispose();w.close();}};
}
for(const kind of ['ordinal','slider','range','options'])for(const initial of [1,4,5])test(`${kind} from ${initial}: target Extra hög, never select Pro`,async()=>{
 const f=fixture({kind,initial,replace:true});try{const r=await f.ensure();assert.equal(r.ok,true,JSON.stringify(r));assert.equal(f.selected(),'Extra hög');assert.equal(r.proof.label,'Extra hög');assert.equal(f.counts.pro,0);assert(!f.counts.keys.includes('End'));assert.equal(f.proof().allowed,true);}finally{f.close();}
});
for(const kind of ['ordinal','slider','range','options'])test(`${kind}: missing Extra hög never falls back to Pro`,async()=>{
 const f=fixture({kind,missing:true,initial:4});try{const r=await f.ensure();assert.equal(r.ok,false);assert.equal(f.counts.pro,0);assert.equal(f.proof().allowed,false);}finally{f.close();}
});
test('disabled Extra hög cannot fall back to Pro',async()=>{const f=fixture({kind:'options',disabledTarget:true});try{assert.equal((await f.ensure()).ok,false);assert.equal(f.counts.pro,0);}finally{f.close();}});
test('legacy verified Pro receipt never authorizes a new send',()=>{
 const f=fixture({initial:5});try{const e=f.w.GreenfieldModelObservation.observe();e.highestEffort={status:'VERIFIED',url,verifiedAtMs:f.w.Date.now(),strategy:'ORDINAL_MAXIMUM',label:'Pro',target:'5'};assert.equal(f.w.GreenfieldSafetyPolicy.evaluateModel(e,undefined,{url,gptRoot:url,requireHighestEffort:true}).allowed,false);}finally{f.close();}
});
test('generic reasoning caption plus stale medium is UNKNOWN, visible Balanced remains low',()=>{
 const f=fixture();try{const b=f.d.getElementById('effort');b.textContent='Resonemangsnivå';b.setAttribute('aria-expanded','true');let e=f.w.GreenfieldModelObservation.observe();assert.equal(f.w.GreenfieldSafetyPolicy.evaluateModel(e,undefined,{url,gptRoot:url}).code,'THINKING_EFFORT_UNKNOWN');b.textContent='Balanserad';b.setAttribute('aria-expanded','false');e=f.w.GreenfieldModelObservation.observe();assert.equal(f.w.GreenfieldSafetyPolicy.evaluateModel(e,undefined,{url,gptRoot:url}).code,'THINKING_EFFORT_TOO_LOW');}finally{f.close();}
});
for(const kind of ['ordinal','slider','range'])test(`${kind}: absent target from a lower level does not explore the unknown top/Pro`,async()=>{
 const f=fixture({kind,missing:true,initial:1});try{assert.equal((await f.ensure()).ok,false);assert.equal(f.counts.pro,0,'do not explore an unknown maximum just to discover whether it is Pro');}finally{f.close();}
});
test('actual 2026-10-20 captured button reads visible Extra hög, ignoring hidden measurement caption',async()=>{
 const captured=await readFile(new URL('fixtures/reasoning-trigger-2026-10-20.html',import.meta.url),'utf8');
 const f=fixture();try{f.d.getElementById('effort').outerHTML=captured;const e=f.w.GreenfieldModelObservation.observe();assert.equal(e.effortLabel,'Extra hög');assert.equal(e.ambiguous,false);assert.equal(e.modelLabel,'');assert.equal(f.w.GreenfieldSafetyPolicy.evaluateModel(e,undefined,{url,gptRoot:url}).allowed,true);}finally{f.close();}
});
test('an explicit Pro model cannot obtain send authority through a separate Extra high control',()=>{
 const f=fixture({initial:4});try{const e=f.w.GreenfieldModelObservation.observe();e.modelLabel='GPT-5.6 Pro';e.highestEffort={status:'VERIFIED',url,verifiedAtMs:f.w.Date.now(),strategy:'ORDINAL_TARGET',label:'Extra hög',target:'4'};assert.equal(f.w.GreenfieldSafetyPolicy.evaluateModel(e,undefined,{url,gptRoot:url,requireHighestEffort:true}).allowed,false);}finally{f.close();}
});
