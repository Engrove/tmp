import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM, VirtualConsole} from 'jsdom';
import {reasonLabel} from '../lib/operations-view.mjs';

const source = await readFile(new URL('../content.js',import.meta.url),'utf8');
const settle = async()=>{for(let n=0;n<4;n++)await new Promise(resolve=>setImmediate(resolve));};
function fixture({ready}={}) {
  const errors=[], calls=[], listeners=new Set(), timeouts=new Map(), intervals=new Map();
  const vc=new VirtualConsole();vc.on('jsdomError',error=>errors.push(error));
  const dom=new JSDOM('<main></main>',{url:'https://chatgpt.com/g/g-test/c/test',runScripts:'outside-only',virtualConsole:vc});
  const w=dom.window;let timerId=0, mode='ok', adapterDisposals=0;
  w.setTimeout=(fn,ms)=>{const id=++timerId;timeouts.set(id,{fn,ms});return id;};
  w.clearTimeout=id=>timeouts.delete(id);
  w.setInterval=(fn,ms)=>{const id=++timerId;intervals.set(id,{fn,ms});return id;};
  w.clearInterval=id=>intervals.delete(id);
  w.GreenfieldThinkingControl={dispose:()=>adapterDisposals++};
  w.chrome={runtime:{id:'test-extension',onMessage:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)},
    sendMessage:message=>{
      calls.push(message);
      if(message.type==='EIC_GF_CONTENT_READY'&&ready)return ready();
      if(mode==='sync-invalid')throw new Error('Extension context invalidated.');
      if(mode==='async-invalid')return Promise.reject(new Error('Extension context invalidated.'));
      if(mode==='receiver-missing')return Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'));
      return Promise.resolve({ok:true});
    }
  }};
  const inject=()=>w.eval(source);
  const tick=async(ms=350)=>{
    for(const [id,timer] of [...timeouts])if(timer.ms===ms){timeouts.delete(id);timer.fn();}
    await settle();
  };
  const request=message=>new Promise(resolve=>{
    const listener=[...listeners][0];assert.ok(listener,'live listener');listener(message,null,resolve);
  });
  inject();
  return {w,calls,errors,listeners,timeouts,intervals,inject,tick,request,
    mode:value=>{mode=value;},get adapterDisposals(){return adapterDisposals;},
    close:()=>{w.__EIC_GF_CONTENT_V2__?.dispose();dom.window.close();}};
}

for(const mode of ['sync-invalid','async-invalid'])test(`${mode}: dirty notification stops the old bridge without an uncaught error`,async()=>{
  const f=fixture();try{
    await settle();
    await f.request({type:'EIC_GF_OVERLAY_UPDATE',overlay:{linked:true,processId:'p',overview:{countdown:[{atMs:Date.now()+10000,template:'{t}'}]}}});
    assert.ok(f.w.document.getElementById('eic-gf-linked-overlay'));
    f.mode(mode);await f.tick();
    assert.equal(f.listeners.size,0);assert.equal(f.intervals.size,0);assert.equal(f.timeouts.size,0);
    assert.equal(f.adapterDisposals,1);assert.equal(f.w.document.getElementById('eic-gf-linked-overlay'),null);
    const count=f.calls.length;
    f.w.document.querySelector('main').append(f.w.document.createElement('div'));
    f.w.dispatchEvent(new f.w.ErrorEvent('error',{message:'later page error'}));
    await settle();await f.tick();
    assert.equal(f.calls.length,count);assert.equal(f.errors.length,0);
  }finally{f.close();}
});

test('synchronous CONTENT_READY invalidation disposes startup timers',async()=>{
  const f=fixture({ready:()=>{throw new Error('Extension context invalidated.');}});try{
    await settle();assert.equal(f.listeners.size,0);assert.equal(f.timeouts.size,0);assert.equal(f.intervals.size,0);
    assert.equal(f.adapterDisposals,1);assert.equal(f.errors.length,0);
  }finally{f.close();}
});

test('missing runtime id stops notifications without calling the invalid API',async()=>{
  const f=fixture();try{
    await settle();const count=f.calls.length;f.w.chrome.runtime.id=undefined;
    await f.tick();assert.equal(f.calls.length,count);assert.equal(f.listeners.size,0);assert.equal(f.intervals.size,0);
  }finally{f.close();}
});

test('ordinary receiver failure retains a bridge that can notify again',async()=>{
  const f=fixture();try{
    await settle();f.mode('receiver-missing');await f.tick();
    assert.equal(f.listeners.size,1);assert.equal(f.adapterDisposals,0);
    f.mode('ok');f.w.document.querySelector('main').append(f.w.document.createElement('div'));
    await settle();await f.tick();
    assert.equal(f.calls.filter(m=>m.type==='EIC_GF_OBSERVATION_DIRTY').length,2);
    assert.equal((await f.request({type:'EIC_GF_PING'})).ok,true);
  }finally{f.close();}
});

test('reinjection preserves dispatch records, cancels old work and ignores a delayed old ready response',async()=>{
  let resolveReady;
  const f=fixture({ready:()=>new Promise(resolve=>{resolveReady=resolve;})});try{
    const old=f.w.__EIC_GF_CONTENT_V2__,oldReady=resolveReady;
    old.dispatchRecords.set('sent',{effectIssued:true,result:{ok:true}});
    let newAdapterDisposals=0;
    f.w.GreenfieldThinkingControl={dispose:()=>newAdapterDisposals++};
    f.inject();
    const current=f.w.__EIC_GF_CONTENT_V2__;
    assert.equal(current.documentId,old.documentId);assert.equal(current.dispatchRecords,old.dispatchRecords);
    assert.equal(f.listeners.size,1);assert.equal(f.intervals.size,1);assert.equal(f.timeouts.size,1);
    assert.equal(f.adapterDisposals,1);assert.equal(newAdapterDisposals,0);
    oldReady({overlay:{linked:true,processId:'old'}});await settle();
    assert.equal(f.w.document.getElementById('eic-gf-linked-overlay'),null);
    resolveReady({ok:true});await settle();
    current.dispose();current.dispose();
    assert.equal(newAdapterDisposals,1);assert.equal(f.intervals.size,0);
  }finally{f.close();}
});

test('an invalidated response channel never attempts a second response',async()=>{
  const f=fixture();try{
    await settle();let replies=0;
    [...f.listeners][0]({type:'EIC_GF_PING'},null,()=>{replies++;throw new Error('Extension context invalidated.');});
    await settle();assert.equal(replies,1);assert.equal(f.listeners.size,0);assert.equal(f.errors.length,0);
  }finally{f.close();}
});

// Exercise the actual submitPrompt and communication code together, while
// replacing only page/transport boundaries. Real timers cover its async gaps.
function dispatchFixture() {
  const dom=new JSDOM('<form><textarea></textarea><button>Send</button></form>',{url:'https://chatgpt.com/g/g-test/c/test',runScripts:'outside-only'});
  const w=dom.window;let sends=0;
  w.document.querySelector('button').addEventListener('click',e=>{e.preventDefault();sends++;});
  w.chrome={runtime:{id:'extension',onMessage:{addListener(){},removeListener(){}},sendMessage:async()=>({ok:true})}};
  w.GreenfieldSafetyPolicy={evaluateModel:()=>({allowed:true})};
  w.GreenfieldModelObservation={observe:()=>({})};
  w.eval(source.replace(/\}\)\(\);\s*$/,`
    pageState=async()=>({composerEmpty:true,modelEvidence:{}});
    getComposer=()=>document.querySelector('textarea');
    getSendButton=()=>document.querySelector('button');
    sha256Hex=async()=> 'hash';
    window.testSubmit=submitPrompt;
    window.testSetPage=fn=>{pageState=fn;};
  })();`));
  return {w,get sends(){return sends;},submit:()=>w.testSubmit('work','hash','dispatch-test',{policy:{},gptRoot:'https://chatgpt.com/g/g-test'}),close:()=>{w.__EIC_GF_CONTENT_V2__.dispose();dom.window.close();}};
}

for(const asynchronous of [false,true])test(`${asynchronous?'asynchronous':'synchronous'} invalidation during authorization prevents a send`,async()=>{
  const f=dispatchFixture();try{
    await settle();f.w.chrome.runtime.sendMessage=()=>{
      const error=new Error('Extension context invalidated.');
      if(asynchronous)return Promise.reject(error);
      throw error;
    };
    const result=await f.submit();assert.equal(result.ok,false);assert.equal(result.effectPossible,false);
    assert.equal(result.code,'EXTENSION_CONTEXT_INVALIDATED');assert.equal(f.sends,0);
  }finally{f.close();}
});

test('disposal while the final page read is pending prevents a stale send',async()=>{
  const f=dispatchFixture();try{
    await settle();let reads=0;
    f.w.testSetPage(async()=>{if(++reads===2)f.w.__EIC_GF_CONTENT_V2__.dispose();return {composerEmpty:true,modelEvidence:{}};});
    const result=await f.submit();assert.equal(result.ok,false);assert.equal(result.effectPossible,false);
    assert.equal(result.code,'CONTENT_BRIDGE_DISPOSED');assert.equal(f.sends,0);
  }finally{f.close();}
});

test('loss after the click retains possible effect and prevents idempotent replay',async()=>{
  const f=dispatchFixture();try{
    await settle();f.w.document.querySelector('button').addEventListener('click',()=>{
      f.w.chrome.runtime.id=undefined;
    });
    const first=await f.submit();assert.equal(first.ok,false);assert.equal(first.effectPossible,true);assert.equal(f.sends,1);
    const second=await f.submit();assert.equal(second.effectPossible,true);assert.equal(f.sends,1);
  }finally{f.close();}
});

test('queue start error explains which tab and window to activate',()=>{
  assert.match(reasonLabel('ACTIVE_CHATGPT_TAB_REQUIRED'),/Välj ChatGPT-fliken i detta Chrome-fönster/);
});
