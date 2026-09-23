import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {memory,harness} from './helpers/background-harness.mjs';
import {createOperatorBackup,restoreOperatorBackup,validateOperatorBackup} from '../lib/operator-backup.mjs';
import {writeMissionQueueSetVault} from '../lib/mission-queue-set-vault.mjs';
import {loadMissionQueueSets,normalizeMissionQueueSet} from '../lib/mission-queue-sets.mjs';
import {createProcess} from '../lib/state.mjs';
import {ensureWorkerBinding} from '../lib/worker-identity.mjs';
import {saveProcess,loadProcessForWindow,processWorkerKey,removeProcessForWindow} from '../lib/process-store.mjs';
import {addMissionWorkItem,loadMissionWorkQueue} from '../lib/mission-work-queue.mjs';
import {readSafety,reserveUsage,authorizeUsageSend,updateSafetyPolicy,observeProviderQuota,probeProviderRecovery} from '../lib/usage-governor.mjs';
import {checkpointKeys} from '../lib/durable-checkpoint.mjs';
import {reconcileRestart} from '../lib/restart-recovery.mjs';
import {sendFenceDecision} from '../lib/send-fence.mjs';
const root='https://chatgpt.com/g/g-test-eic',url=root+'/c/abc-123',now=1800000000000;
const proof={allowed:true,observedAtMs:now,model:'GPT-5.6 Thinking',effort:'extended'};
async function fixture(){
 const local=memory(),session=memory(),w=await ensureWorkerBinding(7,session);
 const p=createProcess({workerId:w.workerId,windowId:7,tabId:70,gptRoot:root,goal:'Recover the owner record',initialPrompt:'Pending'});
 p.phase='WAITING';p.lastManagedUrl=url;p.lastPrompt={hash:'exact-prior-prompt'};
 await saveProcess(p,local,session);await addMissionWorkItem(7,'Preserve this mission',{workerId:p.workerId,storage:local});
 await reserveUsage({id:'one',processId:p.processId,workerId:p.workerId,prompt:'abc',proof,now},local);
 return {local,session,p};
}
test('v1.6 legacy 1.5.3 update finds a unique EIC tab by the exact persisted prompt hash',async()=>{
 const {local,session,p}=await fixture();delete p.lastManagedUrl;await saveProcess(p,local,session);
 const newSession=memory();const tabs=[{id:91,windowId:9,url},{id:92,windowId:10,url:root+'/c/other'}];
 const report=await reconcileRestart({local,session:newSession,tabs:{query:async()=>tabs,sendMessage:async id=>({ok:true,state:{url:tabs.find(t=>t.id===id).url,lastUserHash:id===91?'exact-prior-prompt':'unrelated'}})},ensureBridge:async()=>{}});
 assert.equal(report.restored.length,1);const restored=await loadProcessForWindow(9,local,newSession);assert.equal(restored.workerId,p.workerId);assert.equal(restored.restartRecovery.legacyHashMigration,true);
});
test('v1.6 legacy migration refuses two conversations containing the same prior prompt',async()=>{
 const {local,session,p}=await fixture();delete p.lastManagedUrl;await saveProcess(p,local,session);
 const tabs=[{id:91,windowId:9,url},{id:92,windowId:10,url:root+'/c/other'}];
 const report=await reconcileRestart({local,session:memory(),tabs:{query:async()=>tabs,sendMessage:async id=>({ok:true,state:{url:tabs.find(t=>t.id===id).url,lastUserHash:'exact-prior-prompt'}})},ensureBridge:async()=>{}});
 assert.equal(report.restored.length,0);assert.equal(report.unresolved.length,1);
});
test('v1.6 backup round trip preserves identity and budgets, disables queues, and quarantines prior effects',async()=>{
 const {local,p}=await fixture();local.state['eic.gf.work-mode.credentials']={secret:'excluded'};
 const backup=await createOperatorBackup(local,{version:'1.6.0',extensionId:'source',now});assert.equal(JSON.stringify(backup).includes('excluded'),false);
 const target=memory();const result=await restoreOperatorBackup(backup,target,{now});assert.equal(result.processes,1);assert.equal(result.queues,1);
 const safety=await readSafety(target);assert.equal(safety.admissionPaused,true);assert.equal(safety.entries[0].id,'one');
 assert.equal(target.state[processWorkerKey(p.workerId)].safety.qualityIncident.code,'IMPORTED_RECOVERY_REQUIRES_OWNER_REVIEW');
 assert.equal((await loadMissionWorkQueue(7,target,{workerId:p.workerId})).enabled,false);
 assert.equal(target.state['eic.gf.mission-queue-sets.v1'].sets[0].items[0].goal,'Preserve this mission');
 assert.equal(Object.keys(target.state).some(k=>k.startsWith('eic.gf.worker-binding.')),false);
});
test('v1.6 backup checksum rejection happens before any target writes',async()=>{
 const {local}=await fixture();const backup=await createOperatorBackup(local);backup.data['eic.gf.safety.v1'].entries=[];
 const target=memory();await assert.rejects(restoreOperatorBackup(backup,target),/CHECKSUM/);assert.deepEqual(target.state,{});
});
test('v1.6 restored templates survive a panel read without replacing existing profile templates',async()=>{
 const rootNode={id:'0',children:[{id:'2',parentId:'0',title:'Other',children:[]}]},nodes=new Map([['0',rootNode],['2',rootNode.children[0]]]);let serial=2;
 const strip=n=>{const c=structuredClone(n);delete c.children;return c;};
 const bookmarks={getTree:async()=>[structuredClone(rootNode)],getChildren:async id=>(nodes.get(id)?.children||[]).map(strip),create:async({parentId,...fields})=>{const n={id:String(++serial),parentId,...fields,...(fields.url?{}:{children:[]})};nodes.set(n.id,n);nodes.get(parentId).children.push(n);return strip(n);},update:async(id,patch)=>Object.assign(nodes.get(id),patch),removeTree:async id=>{const n=nodes.get(id);nodes.get(n.parentId).children=nodes.get(n.parentId).children.filter(c=>c.id!==id);nodes.delete(id);}};
 await writeMissionQueueSetVault({schema:'eic.greenfield.mission-queue-set-store.v1',sets:[normalizeMissionQueueSet({setId:'existing',name:'Existing owner template',items:[{goal:'Existing work'}]})]},{bookmarks});
 const {local}=await fixture();const backup=await createOperatorBackup(local),target=memory();
 await restoreOperatorBackup(backup,target,{now,bookmarks});const visible=await loadMissionQueueSets(target,{bookmarks});
 assert.ok(visible.sets.some(s=>s.setId==='existing'));assert.ok(visible.sets.some(s=>s.items[0]?.goal==='Preserve this mission'));
});
test('v1.6 backup cannot overwrite an existing run or erase prior usage',async()=>{
 const {local}=await fixture();const backup=await createOperatorBackup(local);
 await assert.rejects(restoreOperatorBackup(backup,local),/EMPTY_INSTALLATION/);
 const target=memory();await reserveUsage({id:'prior',prompt:'abc',proof,now},target);
 await assert.rejects(restoreOperatorBackup(backup,target),/OVERWRITE_USAGE/);assert.equal((await readSafety(target)).entries[0].id,'prior');
});
test('v1.6 interrupted import remains durably paused and cannot automatically dispatch',async()=>{
 const {local}=await fixture();const backup=await createOperatorBackup(local);const target=memory(),set=target.set;
 target.set=async rows=>{if(Object.keys(rows).some(k=>k.includes('process.worker.')))throw Error('disk failure');return set(rows);};
 await assert.rejects(restoreOperatorBackup(backup,target),/disk failure/);assert.equal((await readSafety(target)).admissionPaused,true);
});
test('v1.6 damaged checkpoint remains exportable but cannot be imported as healthy',async()=>{
 const {local,p}=await fixture();local.state[processWorkerKey(p.workerId)].goal='corrupted';
 const backup=await createOperatorBackup(local);assert.ok(backup.health.some(h=>h.health==='RECOVERY_REQUIRED'));
 await assert.rejects(validateOperatorBackup(backup),/UNRECONCILED_STORAGE/);
});
test('v1.6 deleting a process removes both durable slots and prevents resurrection',async()=>{
 const {local,session,p}=await fixture();await removeProcessForWindow(7,local,session);
 for(const key of [processWorkerKey(p.workerId),...checkpointKeys(processWorkerKey(p.workerId))])assert.equal(local.state[key],undefined);
});
test('v1.6 final dispatch authorization applies pacing to delayed reservations',async()=>{
 const store=memory();await updateSafetyPolicy({minGapSeconds:10},store);
 await reserveUsage({id:'one',prompt:'abc',proof,now},store);
 await reserveUsage({id:'two',prompt:'abc',proof:{...proof,observedAtMs:now+11000},now:now+11000},store);
 assert.equal((await authorizeUsageSend('one','dispatch-one',store,now+12000)).allowed,true);
 assert.equal((await authorizeUsageSend('two','dispatch-two',store,now+12001)).code,'LOCAL_PACING_WAIT');
 assert.equal((await authorizeUsageSend('one','dispatch-one',store,now+12002)).allowed,true);
 assert.equal((await authorizeUsageSend('two','dispatch-two',store,now+23000)).allowed,true);
});
test('v1.6 final authorization returns the latest saved model requirement',async()=>{
 const store=memory();await reserveUsage({id:'one',prompt:'abc',proof,now},store);await updateSafetyPolicy({minimumEffort:'heavy'},store);
 assert.equal((await authorizeUsageSend('one','dispatch',store,now)).policy.minimumEffort,'heavy');
});
test('v1.6 stale, missing and future proofs cannot reserve usage or clear a provider hold',async()=>{
 for(const stamp of [undefined,now-16000,now+2000]){
  const store=memory();assert.equal((await reserveUsage({id:'one',prompt:'abc',proof:{...proof,observedAtMs:stamp},now},store)).allowed,false);
  await observeProviderQuota({active:true,signature:'limit'},store,now);
  await probeProviderRecovery({...proof,observedAtMs:stamp},store,{operator:true,now});assert.ok((await readSafety(store)).providerHold);
 }
});
test('v1.6 later exact manual materialization wins over an earlier confirmed no-effect receipt',()=>{
 assert.equal(sendFenceDecision({text:'prompt',hash:'match',dispatch:{effectPossible:false}},{lastUserHash:'match'}).action,'WAIT_NO_RESEND');
});
test('v1.7.5 nominal ninety-percent storage pressure no longer blocks dispatch',async()=>{
 const h=await harness();h.chrome.storage.local.getBytesInUse=async()=>9.1*1024*1024;h.chrome.storage.local.QUOTA_BYTES=10*1024*1024;
 await h.mod.startRun({windowId:1,goal:'Check owner evidence'});await h.mod.tickSending(await loadProcessForWindow(1));
 assert.equal(h.sent.length,1);
});
test('v1.6 startup exposes corrupted usage as a blocking runtime fault',async()=>{
 const h=await harness({seed:{'eic.gf.safety.v1':{schema:'bad'}}});const f=await h.mod.fleetStatusSnapshot();assert.match(f.runtimeFault,/SAFETY_JOURNAL_INVALID/);assert.ok(f.safety.error);assert.equal(h.sent.length,0);
});

const observationSource=await readFile(new URL('../lib/model-observation.js',import.meta.url),'utf8');
function element(text,{excluded=false,hidden=false,dialog=false}={}){
 return {innerText:text,textContent:text,closest:()=>excluded?{}:null,getBoundingClientRect:()=>({width:hidden?0:120,height:28}),getAttribute:()=>null,querySelector:()=>null,matches:()=>dialog};
}
function observe({models=[],efforts=[],modes=[],notices=[]}={}){
 const context={Date,Set,globalThis:null,GreenfieldSafetyPolicy:globalThis.GreenfieldSafetyPolicy,getComputedStyle:()=>({display:'block',visibility:'visible'}),document:{querySelector:()=>null,querySelectorAll:s=>s.includes('model-switcher-dropdown-button')?models:s.includes('reasoning-effort-selector')?efforts:s.includes("[role='tab']")?modes:s==="[role='alert']"?notices:[]}};
 context.globalThis=context;vm.runInNewContext(observationSource,context);return context.GreenfieldModelObservation.observe();
}
test('v1.6 observation adapter excludes model-looking text inside conversation content and hidden controls',()=>{
 const o=observe({models:[element('GPT-5.6 Thinking',{excluded:true}),element('GPT-5.6 Thinking',{hidden:true})],efforts:[element('Extended')]});assert.equal(o.modelLabel,'');
});
test('v1.6 observation adapter reports conflicting selected controls as ambiguous',()=>{
 const o=observe({models:[element('GPT-5.6 Thinking'),element('GPT-5.6 Instant')],efforts:[element('Extended')]});assert.equal(o.ambiguous,true);assert.equal(o.modelLabel,'');
});
test('v1.6 observation adapter detects selected Work mode and provider notices',()=>{
 const o=observe({models:[element('GPT-5.6 Thinking')],efforts:[element('Extended')],modes:[element('Work')],notices:[element('Responses will use another model until your limit resets.')]});assert.equal(o.mode,'WORK');assert.equal(o.quota.active,true);
});
