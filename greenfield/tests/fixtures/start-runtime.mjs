import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import assert from 'node:assert/strict';
import {createProcess,ownerToken,isCurrentToken,transitionProcess} from '../../lib/state.mjs';
import {readCheckpoint,writeCheckpoint} from '../../lib/durable-checkpoint.mjs';
import {saveProcess as persistProcess,loadProcessForWindow} from '../../lib/process-store.mjs';
import {restoreWorkerBinding} from '../../lib/worker-identity.mjs';
import {saveMissionWorkQueue,loadMissionWorkQueue} from '../../lib/mission-work-queue.mjs';
import {sha256Hex,randomId,nowIso} from '../../lib/common.mjs';
import {jsonEqual} from '../../lib/canonical-json.mjs';
import {prepareSessionInitialization} from '../../lib/session-transport.mjs';
import {archiveUnsentDraft,DRAFT_ARCHIVE_PREFIX} from '../../lib/stale-draft-recovery.mjs';
import {needsSessionStart,resetSessionStart,sessionStartDraftTarget,SESSION_START_ARCHIVE_PREFIX} from '../../lib/session-start.mjs';
import {PHASES} from '../../lib/contracts.mjs';
import {SESSION_ROTATION_STATES} from '../../lib/session-rotation.mjs';
const background=await readFile(new URL('../../background.js',import.meta.url),'utf8');
const content=await readFile(new URL('../../content.js',import.meta.url),'utf8');
export function extract(name,code=background,indent=''){
 const start=new RegExp('^'+indent+'(?:async )?function '+name+'\\(','m').exec(code)?.index;
 assert.notEqual(start,undefined,name);const tail=code.slice(start),end=new RegExp('^'+indent+'}[ \\t]*$','m').exec(tail);
 return tail.slice(0,end.index+end[0].length);
}
export const runtime=(name,deps)=>Function(...Object.keys(deps),extract(name)+`;return ${name}`)(...Object.values(deps));
export function storage(seed={}){const data=structuredClone(seed);return {data,get:async keys=>structuredClone(keys==null?data:Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,data[k]]))),set:async v=>Object.assign(data,structuredClone(v)),remove:async keys=>{for(const k of Array.isArray(keys)?keys:[keys])delete data[k];}};}
export async function startHarness({text='  Ett eget oskickat utkast.\n',source=null,local=storage(),session=storage(),failures=0,late='',archiveFailure=false}={}){
 const root='https://chatgpt.com/g/g-start';
 let current=source || {...createProcess({workerId:'worker-start',windowId:1,tabId:2,gptRoot:root,
  goal:'Projekt: 71 - Test - GFW: GF-1.71.1021.',initialPrompt:'Continue from current owner state.'}),phase:'ROTATING',
  queueContext:{queueId:'queue-start',itemId:'slot-start',workerId:'worker-start'},
  pendingPrompt:{text:'Continue from current owner state.',hash:await sha256Hex('Continue from current owner state.'),sendAttempts:0,dispatch:null},
  sessionRotation:{rotationId:'start-1',state:'NAVIGATING',queueSwitch:true,targetTabId:2,hardReloadState:'DISABLED',
   navigationStartedAt:new Date(Date.now()-600000).toISOString(),readinessWait:{code:'SESSION_ROTATION_COMPOSER_DRAFT_PRESENT',reviewRequired:true,reason:'DRAFT_OWNERSHIP_UNPROVEN'}},
  safety:{qualityIncident:{code:'OLD_QUALITY'},hold:{code:'OLD_HOLD',retryAtMs:Date.now()+86400000}},
  greenfieldControl:{hardStop:true},ownerWait:{state:'WAIT'},missionPause:{state:'ARMED'},lastError:{code:'OLD_ERROR'}};
 await restoreWorkerBinding(current.windowId,current.workerId,session);
 await writeCheckpoint('eic.gf.process.worker.'+current.workerId,current,local);
 if(!source)await saveMissionWorkQueue({workerId:current.workerId,windowId:current.windowId,queueId:current.queueContext.queueId,
  enabled:true,activeItemId:current.queueContext.itemId,items:[{itemId:current.queueContext.itemId,goal:current.goal,status:'ACTIVE'}]},local);
 const dom=new JSDOM('<form><div contenteditable="true"></div><button type="button">Send</button></form>',{url:current.gptRoot,runScripts:'outside-only'}),w=dom.window;
 const composer=w.document.querySelector('[contenteditable]');composer.textContent=text;
 let clicks=0,requests=0;const wakeups=[];
 w.document.querySelector('button').addEventListener('click',()=>clicks++);
 const page=async()=>({url:w.location.href,documentId:'start-document',userCount:0,generating:false,
  composerReady:true,composerEmpty:!composer.textContent.trim(),composerTextHash:composer.textContent.trim()?await sha256Hex(composer.textContent.trim()):''});
 const deps={needsSessionStart,resetSessionStart,sessionStartDraftTarget,SESSION_START_ARCHIVE_PREFIX,
  readCheckpoint,writeCheckpoint,sha256Hex,randomId,nowIso,jsonEqual,ownerToken,isCurrentToken,
  archiveUnsentDraft,DRAFT_ARCHIVE_PREFIX,loadMissionWorkQueue,prepareSessionInitialization,PHASES,SESSION_ROTATION_STATES,
  runtimeFault:'',loadProcessForWindow:id=>loadProcessForWindow(id,local,session),
  saveProcess:async(p,l=local,s=session,options={})=>{await persistProcess(p,l,s,options);current=p;return p;},
  chrome:{runtime:{id:'extension'},storage:{local,session},tabs:{get:async()=>({id:current.tabId,windowId:current.windowId,url:w.location.href,status:'complete'}),reload:async()=>{throw new Error('unexpected reload');}}},
  audit:async()=>{},broadcast:async()=>{},recordIncident:async()=>{},scheduleFast:(id,ms)=>wakeups.push(ms),
  invalidCapturedResponse:()=>false,warmResumeTarget:()=>'',readEicSurfaceState:async()=>({entryUrl:current.gptRoot}),
  resolveManagedGptRoot:()=>current.gptRoot,supportedUrl:()=>true,EIC_LANDING_TIMEOUT_MS:120000,
  tabState:async()=>page(),
  ensureContentBridgeVersion:async()=>{},providerTransportPending:()=>false,Safety:{eicSurfaceProof:()=>({ok:true,kind:'EIC'})},
  commitTransition:async(p,phase,patch,options)=>{if(options?.beforeSave){const b=await options.beforeSave();if(b.blocked)return b.process;}
   return deps.saveProcess(transitionProcess(p,phase,patch));}};
 for(const name of ['transportTransitionBoundary','saveRotationState','establishSessionStart','authorizeStartDraft'])deps[name]=runtime(name,deps);
 Object.assign(w,{DOCUMENT_ID:'start-document',getComposer:()=>composer,sha256Hex,assertContentActive:()=>{},pageState:page,
  canonicalEntries:()=>[],generationSignals:()=>({generating:false}),setNativeValue:(el,value)=>{el.textContent=value;},
  sendRuntimeMessage:async message=>{
   if(late==='edit')composer.textContent='Ny text under rensningen';
   if(late==='stop')await deps.saveProcess({...current,phase:'STOPPED'});
   return deps.authorizeStartDraft(message,{id:'extension',tab:{id:current.tabId,windowId:current.windowId}});
  }});
 w.eval(extract('readComposerValue',content,'  ')+'\n'+extract('recoverUnsentDraft',content,'  ')+'\nwindow.clearStart=recoverUnsentDraft;');
 deps.bridgeMessage=async(id,message)=>{
  if(message.type==='EIC_GF_GET_PAGE_STATE')return {ok:true,state:await page()};
  if(message.type==='EIC_GF_CAPTURE_START_DRAFT')return {ok:true,text:composer.textContent,hash:await sha256Hex(composer.textContent),page:await page()};
  assert.equal(message.type,'EIC_GF_RECOVER_UNSENT_DRAFT');requests++;
  if(requests<=failures)throw new Error('BRIDGE_RETRY');
  return w.clearStart(message);
 };
 for(const name of ['prepareStartComposer','observeRotationComposerWait','commitFreshRotationReady','tickRotating','tickSending'])deps[name]=runtime(name,deps);
 if(archiveFailure){const set=local.set;local.set=async rows=>{
  if(Object.keys(rows).some(k=>k.includes(DRAFT_ARCHIVE_PREFIX)))throw new Error('ARCHIVE_WRITE_FAILED');return set(rows);
 };}
 return {local,session,w,composer,wakeups,deps,get current(){return current;},get clicks(){return clicks;},get requests(){return requests;},
  page,async establish(){current=await deps.establishSessionStart(current);return current;},
  async tick(){current=await deps.tickRotating(current);return current;},
  async cleanup(){return deps.prepareStartComposer(current,await page());},
  async sendTick(){current=await deps.tickSending(current);return current;},
  async expireRetry(){await deps.saveProcess({...current,sessionRotation:{...current.sessionRotation,
   startDraft:{...current.sessionRotation.startDraft,retryAtMs:0}}});},close:()=>w.close()};
}
