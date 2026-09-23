import { readFile } from 'node:fs/promises';
import { APP_VERSION } from '../../lib/contracts.mjs';
import { normalizeText, sha256Hex } from '../../lib/common.mjs';
export function memory(seed={}){
 const state=structuredClone(seed);
 return {state,async get(keys){if(keys==null)return structuredClone(state);const list=typeof keys==='string'?[keys]:Array.isArray(keys)?keys:Object.keys(keys);return Object.fromEntries(list.filter(k=>Object.hasOwn(state,k)).map(k=>[k,structuredClone(state[k])]));},async set(rows){Object.assign(state,structuredClone(rows));},async remove(keys){for(const k of typeof keys==='string'?[keys]:keys)delete state[k];}};
}
let seq=0;
export async function harness({seed={},sessionSeed={},submitMode='success',storageFactory=memory,extraExports=[]}={}){
 const root='https://chatgpt.com/g/g-test-eic',url=root+'/c/abc-123';
 const listeners=()=>({addListener(){}});
 const tab={id:11,windowId:1,url,status:'complete',active:true};
 const page={bridgeVersion:APP_VERSION,documentId:'document-test',url,title:'EIC',userCount:0,assistantCount:0,lastUserId:'',lastUserText:'',lastUserHash:'',lastAssistantId:'',assistantText:'',assistantHash:'',generating:false,signals:{},composerReady:true,composerEmpty:true,composerTextHash:'',rateLimitWarning:{active:false},autonomousTurn:{},modelEvidence:{source:'CHATGPT_UI_CONTROLS_V1',modelLabel:'GPT-5.6 Thinking',effortLabel:'Extended',mode:'CHAT',quota:{active:false}}};
 const sent=[],timers=[],alarms=new Map();
 let mod;
 const chrome={
  storage:{local:storageFactory(seed),session:storageFactory(sessionSeed),onChanged:listeners()},
  runtime:{id:'test-extension',getURL:p=>'chrome-extension://test-extension/'+p,onMessage:listeners(),onStartup:listeners(),onInstalled:listeners(),sendMessage:async()=>({ok:true})},
  alarms:{create:async(n,v)=>alarms.set(n,v),clear:async n=>alarms.delete(n),getAll:async()=>[...alarms].map(([name,v])=>({name,...v})),get:async n=>alarms.get(n),onAlarm:listeners()},
  sidePanel:{setPanelBehavior:async()=>{}},scripting:{executeScript:async()=>[]},
  tabs:{query:async q=>q?.windowId && q.windowId!==tab.windowId?[]:[tab],get:async id=>{if(id!==tab.id)throw Error('TAB_MISSING');return tab;},update:async(id,patch)=>Object.assign(tab,patch),reload:async()=>{},onUpdated:listeners(),onRemoved:listeners(),sendMessage:async(id,msg)=>{
    if(id!==tab.id)throw Error('TAB_MISSING');
    if(msg.type==='EIC_GF_PING')return {ok:true,version:APP_VERSION,url:tab.url};
    if(msg.type==='EIC_GF_GET_PAGE_STATE')return {ok:true,state:structuredClone({...page,modelEvidence:{...page.modelEvidence,observedAtMs:Date.now()}})};
    if(msg.type==='EIC_GF_SUBMIT_PROMPT'){
      sent.push(msg);
      if(submitMode==='transport-loss')throw Error('lost response');
      if(submitMode==='empty-reply')return undefined;
      const permit=await mod.authorizeDispatch(msg,{id:chrome.runtime.id,tab});
      if(!permit.ok)return {ok:false,effectPossible:false,code:permit.code,error:permit.code};
      page.lastUserText=normalizeText(msg.prompt);
      page.lastUserHash=await sha256Hex(page.lastUserText);
      page.lastUserId=`user-${crypto.randomUUID()}`;
      page.userCount+=1;
      page.generating=true;
      const acknowledgementEvidence=page.lastUserHash===msg.promptHash?'PAGE_LAST_USER_HASH':'USER_COUNT_INCREMENTED';
      return {
        ok:true,
        effectPossible:true,
        acknowledged:true,
        acknowledgementEvidence,
        method:'send-button',
        documentId:page.documentId,
        materializedReceipt:{
          userTurnId:page.lastUserId,
          userTurnIndex:page.userCount-1,
          userCount:page.userCount,
          userTextHash:page.lastUserHash
        },
        after:structuredClone(page)
      };
    }
    return {ok:true};
  }},
  windows:{getAll:async()=>[{id:tab.windowId,tabs:[tab]}],get:async()=>({id:tab.windowId}),onRemoved:listeners()},
 };
 globalThis.chrome=chrome;
 globalThis.__gfHarnessTimers=timers;
 let source=await readFile(new URL('../../background.js',import.meta.url),'utf8');
 const project=new URL('../../',import.meta.url);
 source=source.replace(/(["'])\.\/lib\/([^"']+)["']/g,(_m,_q,p)=>JSON.stringify(new URL('lib/'+p,project).href));
 source=`const setTimeout=(fn,ms)=>{globalThis.__gfHarnessTimers.push({fn,ms});return globalThis.__gfHarnessTimers.length;};const clearTimeout=()=>{};\n${source}\nexport {runtimeReady,startRun,tickSending,tickWaiting,tickAnalyzing,authorizeDispatch,holdForSafety,hydrateProcesses,fleetStatusSnapshot,panelSafetyAction,tickProcess${extraExports.length?','+extraExports.join(','):''}};\n// harness ${seq++}`;
 mod=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 await mod.runtimeReady;
 return {mod,chrome,page,tab,sent,timers,alarms};
}
