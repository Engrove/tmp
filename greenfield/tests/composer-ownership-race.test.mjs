import {withReasoningDependencies} from './fixtures/reasoning-dependencies.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash, webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {normalizeText} from '../lib/common.mjs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const root=process.env.GREENFIELD_DRAFT_BASELINE ? pathToFileURL(resolve(process.env.GREENFIELD_DRAFT_BASELINE)+'/') : new URL('../',import.meta.url);
const content = await readFile(new URL('content.js', root), 'utf8');
const background = await readFile(new URL('background.js', root), 'utf8');
const hash = s => createHash('sha256').update(s).digest('hex');
const prompt = JSON.stringify({schema:'eic.a2a.message.v1',messageId:'a2a-current',objective:'Keep  two spaces and \"quoted\" text.'});
function source(name) {
  const start = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(background).index;
  const tail = background.slice(start), end = /^}\s*$/m.exec(tail);
  return tail.slice(0, end.index + end[0].length);
}
function fixture({initial='',afterStage,authorize,renderedText}={}) {
  const dom = new JSDOM('<form><div id="prompt-textarea" contenteditable="true"><p></p></div><button type="button" data-testid="send-button">Send</button></form>',
    {url:'https://chatgpt.com/g/g-test/c/conversation-a',runScripts:'outside-only'});
  const w=dom.window,d=w.document;
  Object.defineProperty(w.crypto,'subtle',{value:webcrypto.subtle});w.TextEncoder=TextEncoder;
  w.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:24});
  const composer=()=>d.querySelector('#prompt-textarea');
  composer().textContent=initial;
  if(renderedText)Object.defineProperty(composer(),'innerText',{configurable:true,get(){return renderedText(this.textContent);}});
  let clicks=0,admissions=0,staged=false;
  const editObservers=[];
  const add=d.addEventListener.bind(d);
  d.addEventListener=(name,fn,...rest)=>{if(name==='input')editObservers.push(fn);return add(name,fn,...rest);};
  const human=()=>editObservers.forEach(fn=>fn({isTrusted:true,target:composer()}));
  const replace=(value=prompt)=>{const node=d.createElement('div');node.id='prompt-textarea';node.setAttribute('contenteditable','true');node.textContent=value;composer().replaceWith(node);return node;};
  d.querySelector('button').click=()=>clicks++;
  w.GreenfieldSafetyPolicy={evaluateModel:()=>({allowed:true})};
  w.GreenfieldModelObservation={observe:()=>({})};
  w.GreenfieldThinkingControl={ensureHighest:async({guard})=>guard()};
  w.chrome={runtime:{id:'test-extension',onMessage:{addListener(){},removeListener(){}},sendMessage:async message=>{
    if(message.type==='EIC_GF_AUTHORIZE_DISPATCH') {
      admissions++;
      if(authorize)return authorize({admissions,composer:composer(),replace,human,w});
    }
    return {ok:true,policy:{},gptRoot:'https://chatgpt.com/g/g-test'};
  }}};
  d.addEventListener('input',event=>{
    if(event.target===composer()&&composer().textContent&& !staged){staged=true;queueMicrotask(()=>afterStage?.({composer:composer(),replace,human,w}));}
  });
  const inject=()=>w.eval(content.replace(/\}\)\(\);\s*$/, `
    waitForMaterialization=async()=>({acknowledged:true,evidence:'USER_TURN',state:{}});
    publishDispatchMaterialization=async()=>null;
    window.race={submit:submitPrompt,page:pageState,handle};
  })();`));
  inject();
  return {w,composer,replace,human,get clicks(){return clicks;},get admissions(){return admissions;},
    submit:(text=prompt,id='send-a')=>w.race.submit(text,hash(text),id,{policy:{},gptRoot:'https://chatgpt.com/g/g-test'}),
    inject,page:()=>w.race.page(),close:()=>{w.__EIC_GF_CONTENT_V2__.dispose();w.close();}};
}

test('layout-dependent innerText cannot turn an unchanged Greenfield draft into operator text',async()=>{
  const f=fixture({renderedText:text=>text.replaceAll('  ',' ')});try{
    const r=await f.submit();assert.equal(r.ok,true,JSON.stringify(r));assert.equal(f.clicks,1);
    assert.equal((await f.page()).composerTextHash,hash(prompt));
  }finally{f.close();}
});
test('same text on a remounted composer is sent once, including dispatch replay',async()=>{
  const f=fixture({afterStage:({replace})=>replace()});try{
    assert.equal((await f.submit()).ok,true);assert.equal((await f.submit()).ok,true);assert.equal(f.clicks,1);
  }finally{f.close();}
});
test('remount while admission is pending does not impersonate a human edit',async()=>{
  const f=fixture({authorize:({admissions,replace})=>{if(admissions===1)replace('');return {ok:true};}});try{
    const r=await f.submit();assert.equal(r.ok,true,JSON.stringify(r));assert.equal(f.clicks,1);
  }finally{f.close();}
});
test('rollback clears only the unchanged draft staged by this attempt after remount',async()=>{
  const f=fixture({afterStage:({replace})=>replace(),authorize:({admissions})=>admissions===1?{ok:true}:{ok:false,code:'ADMISSION_PAUSED'}});try{
    const r=await f.submit();assert.equal(r.code,'ADMISSION_PAUSED');assert.equal(f.clicks,0);
    assert.equal(r.draftCleanup,'CLEARED_OWN_UNSENT_DRAFT');assert.equal(f.composer().textContent,'');
  }finally{f.close();}
});
for(const edited of [prompt, 'Operator replacement'])test(`trusted edit on a replacement composer is preserved: ${edited===prompt?'edit and revert':'changed text'}`,async()=>{
  const f=fixture({afterStage:({replace,human})=>{replace(edited);human();}});try{
    assert.equal((await f.submit()).ok,false);assert.equal(f.clicks,0);assert.equal(f.composer().textContent,edited);
  }finally{f.close();}
});
test('different dispatches cannot simultaneously own one composer',async()=>{
  let release,entered;
  const ready=new Promise(resolve=>entered=resolve);
  const f=fixture({authorize:async({admissions})=>{if(admissions===1){entered();await new Promise(resolve=>release=resolve);}return {ok:true};}});
  try{
    const first=f.submit(prompt,'send-a');await ready;
    const second=await f.submit(prompt,'send-b');release();await first;
    assert.equal(second.ok,false);assert.equal(second.code,'TARGET_BUSY');assert.equal(f.clicks,1);
  }finally{release?.();f.close();}
});
test('paragraphs, breaks and literal UI-label lines preserve logical prompt text',async()=>{
  const f=fixture();try{
    f.composer().innerHTML='<p>first<br>second</p><p><br class="ProseMirror-trailingBreak"></p><p>Copy code</p><p>last</p>';
    assert.equal((await f.page()).composerTextHash,hash('first\nsecond\n\nCopy code\nlast'));
  }finally{f.close();}
});
test('restored own draft passes thinking preflight; different text still blocks',async()=>{
  const f=fixture({initial:prompt,renderedText:text=>text.replaceAll('  ',' ')});try{
    const message={type:'EIC_GF_ENSURE_HIGHEST_THINKING',documentId:f.w.__EIC_GF_CONTENT_V2__.documentId,promptHash:hash(prompt),policy:{}};
    assert.equal((await f.w.race.handle(message)).ok,true);
    f.composer().textContent=prompt+' operator edit';assert.equal((await f.w.race.handle(message)).code,'OPERATOR_DRAFT_PRESENT');
  }finally{f.close();}
});
test('background draft admission uses the same normalized text hash as the composer',async()=>{
  const deps={maintainLocalStorage:async()=>{},readSafety:async()=>({policy:{}}),Safety:{evaluateModel:()=>({allowed:true})},
    sha256Hex:async s=>hash(s),normalizeText,budgetDecision:()=>({allowed:true}),usageIdentity:()=>({})};
  const run=Function(...Object.keys(withReasoningDependencies(deps)),source('sendingSafetyDecision')+';return sendingSafetyDecision;')(...Object.values(deps));
  const text='first  \r\nsecond\n';
  assert.equal((await run({}, {composerEmpty:false,composerTextHash:hash(normalizeText(text))}, {text})).allowed,true);
  assert.equal((await run({}, {composerEmpty:false,composerTextHash:hash('foreign')}, {text})).code,'OPERATOR_DRAFT_PRESENT');
});

test('thinking repair receives normalized composer hash without changing durable dispatch identity',async()=>{
  const messages=[],text='first  \r\nsecond\n',pending={text,hash:hash(text)};
  const deps={normalizeText,sha256Hex:async s=>hash(s),readSafety:async()=>({policy:{}}),
    Safety:{evaluateModel:e=>e?.verified?{allowed:true}:{allowed:false,code:'THINKING_EFFORT_UNKNOWN'}},
    providerTransportPending:()=>false,transportTransitionBoundary:async process=>({blocked:false,process}),
    bridgeMessage:async(tab,message)=>{messages.push(message);return {ok:true};},
    tabState:async()=>({modelEvidence:{verified:true}}),audit:async()=>{},holdForSafety:async(p,d)=>({...p,hold:d})};
  const run=Function(...Object.keys(withReasoningDependencies(deps)),source('ensureHighestThinkingBeforeSend')+';return ensureHighestThinkingBeforeSend;')(...Object.values(deps));
  assert.equal((await run({pendingPrompt:pending},{documentId:'document',url:'https://chatgpt.com/c/a'})).handled,false);
  assert.equal(messages[0].promptHash,hash(text));assert.equal(messages[0].composerPromptHash,hash(normalizeText(text)));
  assert.equal(pending.text,text);assert.equal(pending.hash,hash(text));
});
test('reinjecting the bridge cannot overlap an admitted old dispatch or let it send after disposal',async()=>{
  let release,entered;const ready=new Promise(resolve=>entered=resolve);
  const f=fixture({authorize:async({admissions})=>{if(admissions===1){entered();await new Promise(resolve=>release=resolve);}return {ok:true};}});
  try{
    const first=f.submit(prompt,'send-a');await ready;f.inject();
    const second=await f.submit(prompt,'send-b');release();const old=await first;
    assert.equal(second.code,'TARGET_BUSY');assert.equal(old.effectPossible,false);assert.equal(f.clicks,0);
    assert.equal((await f.submit(prompt,'send-c')).ok,true);assert.equal(f.clicks,1);
  }finally{release?.();f.close();}
});
test('long single-line A2A draft survives a deferred paragraph remount and remains exact',async()=>{
  const text=JSON.stringify({schema:'eic.a2a.message.v1',messageId:'a2a-long',objective:'Åäö 🧪 '.repeat(2600)});
  const f=fixture({afterStage:({replace})=>{const node=replace('');const p=f.w.document.createElement('p');p.textContent=text;node.append(p);}});
  try{
    assert.equal((await f.submit(text)).ok,true);assert.equal(f.clicks,1);
    assert.equal((await f.page()).composerTextHash,hash(text));
  }finally{f.close();}
});
