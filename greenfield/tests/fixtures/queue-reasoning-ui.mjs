import {withReasoningDependencies} from './reasoning-dependencies.mjs';
import {APP_VERSION} from '../../lib/contracts.mjs';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const read = name => readFileSync(new URL('../../'+name, import.meta.url), 'utf8');
export const background = read('background.js');
export const content = read('content.js');
export function functionSource(name, source = background, indent = '') {
  const start = new RegExp('^'+indent+'(?:async )?function '+name+'\\(', 'm').exec(source);
  if (!start) throw Error('Missing function '+name);
  const tail = source.slice(start.index), end = new RegExp('^'+indent+'}[ \\t]*$', 'm').exec(tail);
  return tail.slice(0, end.index+end[0].length);
}
export function runtime(name, deps, source = background) {
  withReasoningDependencies(deps);
  return Function(...Object.keys(deps),functionSource(name,source)+';return '+name)(...Object.values(deps));
}
export const gptRoot = 'https://chatgpt.com/g/g-fixture-eic';
export const url = gptRoot+'/c/fixture-thread';
export const levels = ['low','medium','high','xhigh'];
const names = {low:'Låg',medium:'Balanserad',high:'Hög',xhigh:'Extra hög',pro:'Pro'};

export function reasoningUI({initial='high', kind='slider', available=[...levels,'pro']}={}) {
  const dom = new JSDOM('<form><textarea></textarea>'+read('tests/fixtures/reasoning-trigger-2026-11-04.html')+
    '<button type="button" data-testid="send-button">Send</button></form>', {url,runScripts:'outside-only'});
  const w=dom.window,d=w.document, trigger=d.querySelector('[data-composer-navigation-target="reasoning"]');
  let selected=initial,clock=Date.now();
  const counts={opens:0,sends:0,proSelections:0};
  w.Date.now=()=>clock;
  w.setTimeout=(fn,ms=0)=>{queueMicrotask(()=>{clock+=ms;fn();});return 1;};
  w.HTMLElement.prototype.getBoundingClientRect=()=>({width:120,height:30});
  const label=trigger.querySelector('.ModelPickerTriggerLabel-xR9gDc');
  function select(level) {
    selected=level;label.textContent=names[level] || level;
    trigger.setAttribute('data-selected-reasoning-effort',level);
    if(level==='pro') counts.proSelections++;
  }
  select(initial); counts.proSelections=0;
  function close() {d.getElementById('reasoning-menu')?.remove();trigger.setAttribute('aria-expanded','false');}
  function open() {
    if(d.getElementById('reasoning-menu')) return;
    counts.opens++;trigger.setAttribute('aria-controls','reasoning-menu');trigger.setAttribute('aria-expanded','true');
    const menu=d.createElement('div');menu.id='reasoning-menu';menu.setAttribute('role','menu');d.body.append(menu);
    if(kind==='named') {
      for(const level of available) {
        const el=d.createElement('button');el.type='button';el.textContent=names[level] || level;
        el.setAttribute('role','menuitemradio');el.setAttribute('aria-checked',String(level===selected));
        el.addEventListener('click',()=>{select(level);close();});menu.append(el);
      }
    } else {
      const el=d.createElement(kind==='range'?'input':'div');el.tabIndex=0;menu.append(el);
      if(kind==='range') {el.type='range';el.min='0';el.max=String(available.length-1);el.step='1';}
      else if(kind!=='ordinal') el.setAttribute('role','slider');
      const update=()=>{
        const i=available.indexOf(selected);
        if(kind==='ordinal') el.setAttribute('aria-label',`${names[selected]}, ${i+1} av ${available.length}. Använd vänster- och högerpiltangenterna för att justera prestandan`);
        else {el.value=String(i);for(const [attr,v] of Object.entries({'aria-valuemin':0,'aria-valuemax':available.length-1,'aria-valuenow':i,'aria-valuetext':names[selected]}))el.setAttribute(attr,String(v));}
      };
      update();
      el.addEventListener('keydown',e=>{
        if(!['ArrowLeft','ArrowRight'].includes(e.key))return;
        const i=Math.max(0,Math.min(available.length-1,available.indexOf(selected)+(e.key==='ArrowRight'?1:-1)));
        select(available[i]);update();
      });
      el.addEventListener('input',()=>{select(available[Number(el.value)]);update();});
    }
  }
  trigger.addEventListener('keydown',e=>{if(e.key==='ArrowDown')open();});
  trigger.addEventListener('click',()=>trigger.getAttribute('aria-expanded')==='true'?close():open());
  d.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
  d.querySelector('[data-testid="send-button"]').addEventListener('click',()=>counts.sends++);
  for(const name of ['lib/safety-policy.js','lib/model-observation.js','lib/thinking-control.js'])w.eval(read(name));
  const page=()=>({url,documentId:'fixture-document',generating:false,composerReady:true,
    composerEmpty:!d.querySelector('textarea').value,composerTextHash:d.querySelector('textarea').value?'hash':'',
    modelEvidence:w.GreenfieldModelObservation.observe()});
  Object.assign(w,{CONTENT_VERSION:APP_VERSION,DOCUMENT_ID:'fixture-document',assertContentActive:()=>{},pageState:async()=>page(),
    visible:el=>Boolean(el?.isConnected),sendRuntimeMessage:m=>w.chrome.runtime.sendMessage(m)});
  w.eval(functionSource('handle',content,'  ')+';window.handle=handle;');
  const policy=level=>({...w.GreenfieldSafetyPolicy.defaults,reasoningLevel:level});
  const ensure=level=>w.handle({type:'EIC_GF_ENSURE_HIGHEST_THINKING',documentId:'fixture-document',expectedUrl:url,
    promptHash:'hash',policy:policy(level),reasoningLevel:level,gptRoot});
  const proof=level=>w.GreenfieldSafetyPolicy.evaluateModel(page().modelEvidence,policy(level),
    {url,gptRoot,requireHighestEffort:true,now:w.Date.now()});
  function submitWith(authorize) {
    const composer=d.querySelector('textarea');
    Object.assign(w,{dispatchRecords:new Map(),forensic:()=>{},serializeError:e=>({message:e.message}),
      getComposer:()=>composer,normalizeText:s=>String(s||''),sha256Hex:async()=>'hash',setNativeValue:(el,v)=>{el.value=v;},
      getSendButton:()=>d.querySelector('[data-testid="send-button"]'),promptMarkerValue:s=>s,
      materializedUserTurnReceipt:()=>({userTurnId:'fixture-user',userTurnIndex:0}),publishDispatchMaterialization:async()=>({userTurnId:'fixture-user'}),
      waitForMaterialization:async()=>({acknowledged:true,evidence:'USER_TURN',elapsedMs:1,state:{},rateLimitDetected:false}),
      chrome:{runtime:{sendMessage:authorize}}});
    w.eval(['normalizeComposerText','readComposerValue','submitPrompt'].map(n=>functionSource(n,content,'  ')).join('\n')+';window.realSubmit=submitPrompt;');
    return (level, id='dispatch')=>w.realSubmit('bounded work','hash',id,{policy:policy(level),gptRoot});
  }
  return {w,d,trigger,counts,page,ensure,proof,policy,select,submitWith,
    close:()=>{w.GreenfieldThinkingControl.dispose();dom.window.close();}};
}
