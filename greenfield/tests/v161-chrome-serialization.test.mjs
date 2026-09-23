import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {chromeJsonCopy,chromeJsonStorage} from './helpers/chrome-json-storage.mjs';
import {harness} from './helpers/background-harness.mjs';
import {canonicalJson,jsonEqual} from '../lib/canonical-json.mjs';
import {sha256Hex} from '../lib/common.mjs';
import {checkpointKeys,readCheckpoint,writeCheckpoint,REPAIR_PREFIX} from '../lib/durable-checkpoint.mjs';
import {recoverRc1Checkpoints} from '../lib/rc1-checkpoint-migration.mjs';
import {normalizeMissionWorkQueue,loadMissionWorkQueue,saveMissionWorkQueue,addMissionWorkItem} from '../lib/mission-work-queue.mjs';
import {readSafety,reserveUsage,usageSummary,updateSafetyPolicy,SAFETY_KEY} from '../lib/usage-governor.mjs';
import {createOperatorBackup,restoreOperatorBackup,validateOperatorBackup} from '../lib/operator-backup.mjs';
import {createStartupDiagnostics} from '../lib/startup-diagnostics.mjs';
import {probeStorageContract} from '../lib/storage-contract-probe.mjs';
import {loadProcessForWindow} from '../lib/process-store.mjs';
const key='eic.gf.mission-work-queue.worker.rc1-worker';
const fixed='2026-09-08T11:30:00.000Z';
const queue=patch=>normalizeMissionWorkQueue({workerId:'rc1-worker',windowId:1,queueId:'queue-original',revision:1,createdAt:fixed,updatedAt:fixed,...patch});
async function legacySeed(value,{recordKey=key,primary,revision=1}={}) {
 const envelope={schema:'eic.gf.checkpoint.v1',revision,savedAt:fixed,value,sha256:await sha256Hex(JSON.stringify(value))};
 return chromeJsonCopy({[checkpointKeys(recordKey)[revision%2]]:envelope,...(primary===undefined?{}:{[recordKey]:primary})});
}
test('v1.6.1 reproduces RC1 false corruption when Chrome changes dictionary field order',async()=>{
 const original=queue(),seed=await legacySeed(original),stored=seed[checkpointKeys(key)[1]];
 assert.notEqual(JSON.stringify(stored.value),JSON.stringify(original));
 assert.notEqual(await sha256Hex(JSON.stringify(stored.value)),stored.sha256);
 assert.equal(canonicalJson(stored.value),canonicalJson(original));
});
test('v1.6.1 canonical encoding ignores nested object order but preserves array order and values',()=>{
 const value={z:'Åäö😀',a:{z:false,a:null},rows:[{z:1,a:2},3]};assert.equal(canonicalJson(value),canonicalJson(chromeJsonCopy(value)));
 assert.notEqual(canonicalJson([1,2]),canonicalJson([2,1]));assert.notEqual(canonicalJson({x:1}),canonicalJson({x:'1'}));
 assert.equal(canonicalJson(JSON.parse('{"__proto__":{"z":2,"a":1},"10":1,"2":2}')),'{"10":1,"2":2,"__proto__":{"a":1,"z":2}}');
});
test('v1.6.1 v2 checkpoints survive serialization and a recreated storage owner',async()=>{
 const store=chromeJsonStorage();await writeCheckpoint(key,queue(),store);await writeCheckpoint(key,queue({revision:2,items:[{goal:'First'}, {goal:'Second'}]}),store);
 const r=await readCheckpoint(key,chromeJsonStorage(store.state));assert.equal(r.health,'VERIFIED');assert.deepEqual(r.value.items.map(i=>i.goal),['First','Second']);
});
test('v1.6.1 v2 checksum covers revision metadata as well as content',async()=>{
 const store=chromeJsonStorage();await writeCheckpoint(key,queue(),store);store.state[checkpointKeys(key)[1]].revision=999;
 await assert.rejects(readCheckpoint(key,store),/UNRECOVERABLE/);
});
test('v1.6.1 startup repairs the stranded empty RC1 queue while archiving the original',async()=>{
 const seed=await legacySeed(queue()),store=chromeJsonStorage({...seed,'unrelated.key':{keep:true}});
 const repaired=await recoverRc1Checkpoints(store);assert.equal(repaired.length,1);assert.equal(repaired[0].requiresReview,false);
 const r=await readCheckpoint(key,store);assert.equal(r.health,'VERIFIED');assert.equal(r.value.queueId,'queue-original');
 assert.deepEqual(store.state[repaired[0].archiveKey].originals,seed);assert.deepEqual(store.state['unrelated.key'],{keep:true});
 assert.equal((await recoverRc1Checkpoints(store)).length,0);
});
test('v1.6.1 recovery preserves queued missions, parks the queue and pauses admission',async()=>{
 const q=queue({enabled:true,items:[{goal:'Never lose this mission',priority:'HIGH'}]}),store=chromeJsonStorage(await legacySeed(q));
 const repaired=await recoverRc1Checkpoints(store);assert.equal(repaired[0].requiresReview,true);
 const loaded=await loadMissionWorkQueue(1,store,{workerId:'rc1-worker'});assert.equal(loaded.enabled,false);assert.equal(loaded.items[0].goal,q.items[0].goal);
 assert.equal((await readSafety(store)).admissionPaused,true);
});
test('v1.6.1 a committed RC1 record can migrate without inventing lost data or changing queue enablement',async()=>{
 const q=queue({enabled:true,items:[{goal:'Already committed'}]}),store=chromeJsonStorage(await legacySeed(q,{primary:q}));
 const result=await recoverRc1Checkpoints(store);assert.equal(result[0].requiresReview,false);assert.equal((await readCheckpoint(key,store)).value.enabled,true);
});
test('v1.6.1 actual damage cannot be reclassified as field-order corruption',async()=>{
 const seed=await legacySeed(queue());seed[checkpointKeys(key)[1]].value.queueId='tampered';const store=chromeJsonStorage(seed);
 assert.equal((await recoverRc1Checkpoints(store)).length,0);await assert.rejects(readCheckpoint(key,store),/UNRECOVERABLE/);assert.equal(Object.keys(store.state).some(k=>k.startsWith(REPAIR_PREFIX)),false);
});
test('v1.6.1 unknown nested RC1 ordering is not guessed past the old checksum',async()=>{
 const q=queue({items:[{goal:'Runtime snapshot',processSnapshot:{z:{z:2,a:1},a:1}}]});
 const store=chromeJsonStorage(await legacySeed(q));assert.equal((await recoverRc1Checkpoints(store)).length,0);await assert.rejects(readCheckpoint(key,store),/UNRECOVERABLE/);
});
test('v1.6.1 failed evidence archiving leaves all original RC1 records untouched',async()=>{
 const seed=await legacySeed(queue()),store=chromeJsonStorage(seed);store.set=async()=>{throw Error('QUOTA_BYTES');};
 await assert.rejects(recoverRc1Checkpoints(store),/QUOTA_BYTES/);assert.deepEqual(store.state,seed);
});
test('v1.6.1 interrupted migration publication resumes from verified archived evidence',async()=>{
 const store=chromeJsonStorage(await legacySeed(queue())),set=store.set;
 store.set=async rows=>{if(Object.hasOwn(rows,key)){await set({[checkpointKeys(key)[0]]:rows[checkpointKeys(key)[0]]});throw Error('interrupted publish');}await set(rows);};
 await assert.rejects(recoverRc1Checkpoints(store),/interrupted publish/);
 const reboot=chromeJsonStorage(store.state);assert.equal((await recoverRc1Checkpoints(reboot)).length,1);assert.equal((await readCheckpoint(key,reboot)).health,'VERIFIED');
});
test('v1.6.1 RC1 safety-journal recovery retains usage and provider hold instead of resetting quota',async()=>{
 const v=await readSafety(chromeJsonStorage());v.entries.push({id:'reserved',processId:'p',workerId:'w',atMs:Date.now(),inputTokens:10,reserveTokens:8192,outputTokens:0,completedAtMs:null,model:'GPT-5.6 Thinking',effort:'Extended'});
 v.providerHold={sourceWorkerId:'w',multipleSources:false,signature:'limit',reason:'CHATGPT_QUOTA_OR_FALLBACK_UI',text:'Limit reached',observedAtMs:Date.now(),resetAtMs:null,resetConfidence:'UNKNOWN',goodProbeAtMs:null};
 const store=chromeJsonStorage(await legacySeed(v,{recordKey:SAFETY_KEY}));await recoverRc1Checkpoints(store);
 const restored=await readSafety(store);assert.equal(restored.entries[0].id,'reserved');assert.equal(restored.providerHold.signature,'limit');assert.equal(restored.admissionPaused,true);
});
test('v1.6.1 queue updates and usage reservation survive realistic storage serialization',async()=>{
 const store=chromeJsonStorage();await addMissionWorkItem(1,'Original goal',{workerId:'w',storage:store});
 let q=await loadMissionWorkQueue(1,store,{workerId:'w'});q.items[0].priority='HIGH';q=await saveMissionWorkQueue(q,store);assert.equal(q.items[0].goal,'Original goal');
 const now=Date.now();const r=await reserveUsage({id:'one',workerId:'w',processId:'p',prompt:'test',proof:{allowed:true,observedAtMs:now},now},store);assert.equal(r.allowed,true);assert.equal(usageSummary(await readSafety(store)).messages24h,1);
});
test('v1.6.1 backup survives Chrome message reordering and import into serialized storage',async()=>{
 const store=chromeJsonStorage();await addMissionWorkItem(1,'Backup goal',{workerId:'w',storage:store});await updateSafetyPolicy({minGapSeconds:300},store);
 await store.set({'eic.gf.operator.settings.v1':{savedMissions:[{id:'mission',goal:'Saved goal',label:'Saved',createdAt:fixed}],maxActiveSessions:1}});
 const backup=chromeJsonCopy(await createOperatorBackup(store,{version:'1.6.1'}));await validateOperatorBackup(backup);
 const target=chromeJsonStorage();await restoreOperatorBackup(backup,target);assert.equal((await readSafety(target)).admissionPaused,true);assert.equal((await loadMissionWorkQueue(1,target,{workerId:'w'})).items[0].goal,'Backup goal');
});
test('v1.6.1 raw diagnostics preserve unreadable checkpoint evidence and exclude service credentials',async()=>{
 const broken={schema:'bad',value:{goal:'Retain evidence'}};const store=chromeJsonStorage({[checkpointKeys(key)[0]]:broken,'eic.gf.work-mode.credentials':{secret:'must not export'}});
 const d=await createStartupDiagnostics(store,{version:'1.6.1',runtimeFault:'CHECKPOINT_UNRECOVERABLE'});assert.deepEqual(d.storage[checkpointKeys(key)[0]],broken);assert.equal(JSON.stringify(d).includes('must not export'),false);
});
test('v1.6.1 installed-storage contract probe reports reordered keys and removes only its own test data',async()=>{
 const store=chromeJsonStorage({unrelated:{keep:true}});const proof=await probeStorageContract(store);assert.equal(proof.verified,true);assert.equal(proof.keyOrderChanged,true);assert.deepEqual(store.state,{unrelated:{keep:true}});
});
test('v1.6.1 an interrupted disposable startup probe cannot permanently block the next start',async()=>{
 const probeKey='eic.gf.storage-contract-probe.v1';const store=chromeJsonStorage({[checkpointKeys(probeKey)[0]]:{broken:true},[key]:queue()});
 assert.equal((await probeStorageContract(store)).verified,true);assert.deepEqual(store.state,{[key]:chromeJsonCopy(queue())});
});
test('v1.6.1 real background can start and send with serialized Chrome storage',async()=>{
 const h=await harness({storageFactory:chromeJsonStorage});assert.equal((await h.mod.fleetStatusSnapshot()).runtimeFault,'');
 await h.mod.startRun({windowId:1,goal:'A bounded owner read'});await h.mod.tickSending(await loadProcessForWindow(1));assert.equal(h.sent.length,1);assert.equal((await readSafety()).entries.length,1);
});
test('v1.6.1 real startup recovers the reproduced RC1 state before accepting a new run',async()=>{
 const h=await harness({seed:await legacySeed(queue()),storageFactory:chromeJsonStorage});const f=await h.mod.fleetStatusSnapshot();assert.equal(f.runtimeFault,'');assert.equal(f.recovery.checkpointRepairs.length,1);assert.equal(f.storageContract.verified,true);
 await h.mod.startRun({windowId:1,goal:'Read after RC1 recovery'});await h.mod.tickSending(await loadProcessForWindow(1));assert.equal(h.sent.length,1);
});
test('v1.6.1 operator can inspect the active model before creating any worker process',async()=>{
 const h=await harness({storageFactory:chromeJsonStorage});const r=await h.mod.panelSafetyAction({type:'EIC_GF_SAFETY_RECHECK',windowId:1},{id:h.chrome.runtime.id,url:h.chrome.runtime.getURL('sidepanel.html')});assert.equal(r.inspection.allowed,true);assert.equal(h.sent.length,0);
});
test('v1.6.1 diagnostic export still works when startup is blocked by an unreadable record',async()=>{
 const h=await harness({seed:{[checkpointKeys(key)[0]]:{schema:'bad'}},storageFactory:chromeJsonStorage});assert.match((await h.mod.fleetStatusSnapshot()).runtimeFault,/CHECKPOINT_UNRECOVERABLE/);
 const r=await h.mod.panelSafetyAction({type:'EIC_GF_EXPORT_DIAGNOSTICS',windowId:1},{id:h.chrome.runtime.id,url:h.chrome.runtime.getURL('sidepanel.html')});assert.ok(r.diagnostics.storage[checkpointKeys(key)[0]]);assert.equal(h.sent.length,0);
});
const adapterSource=await readFile(new URL('../lib/model-observation.js',import.meta.url),'utf8');
function adapter(){const context={Date,Set,GreenfieldSafetyPolicy:globalThis.GreenfieldSafetyPolicy,document:{querySelector:()=>null,querySelectorAll:()=>[]},getComputedStyle:()=>({display:'block',visibility:'visible'})};vm.runInNewContext(adapterSource,context);return context.GreenfieldModelObservation;}
test('v1.6.1 current-use notice identifies Luna and never substitutes the recommended Sol',()=>{
 const a=adapter();assert.equal(a.parseCurrentModelNotice('Obs! Skaparen rekommenderar GPT-5.6 Sol. Du använder GPT-5.6 Luna.'),'GPT-5.6 Luna');
 assert.equal(a.parseCurrentModelNotice('Växla till GPT-5.6 Sol (modellen som skaparen rekommenderar)'), '');
 assert.equal(a.parseCurrentModelNotice('You are currently using GPT-5.6 Luna.'),'GPT-5.6 Luna');
});
