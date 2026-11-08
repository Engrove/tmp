import {test} from 'node:test';import assert from 'node:assert/strict';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const root=process.env.GF_AUDIT_BASELINE?pathToFileURL(resolve(process.env.GF_AUDIT_BASELINE)+'/'):new URL('../',import.meta.url);
const cases=[['global-capacity-scheduler','readGlobalCapacityScheduler'],['global-prompt-gate','readGlobalPromptGate'],['work-mode','loadWorkModePrequeue'],['incident-log','readIncidentLog'],['storage-retention','readStorageRetentionStatus'],['process-store','loadPersistedProcessInventory'],['managed-eic-surface','readEicSurfaceState'],['operator-backup','createOperatorBackup']];
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
for(const [module,name] of cases){const fn=(await import(new URL(`lib/${module}.mjs`,root)))[name];test(`${name}: inaccessible storage is a bounded error, never an empty/available state`,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let settle;const stalled=new Promise(r=>settle=r);let state='PENDING',error;
 const storage={get:()=>stalled,set:async()=>{},remove:async()=>{}};const p=fn(storage).then(()=>state='FULFILLED',e=>{state='REJECTED';error=e;});
 await flush();t.mock.timers.tick(30001);await flush();
 try{assert.equal(state,'REJECTED','lack of a storage reply must not block indefinitely');assert.match(error?.code||error?.message,/TIMEOUT/);}
 finally{settle({});await p.catch(()=>{});}
});}
const {storageHealth}=await import(new URL('lib/storage-health.mjs',root));
test('quota inspection is bounded and never labels an unanswered measurement as healthy',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let settle,state='PENDING';
 const result=storageHealth({getBytesInUse:()=>new Promise(r=>settle=r)}).then(()=>state='FULFILLED',()=>state='REJECTED');
 await flush();t.mock.timers.tick(30001);await flush();
 try{assert.equal(state,'REJECTED');}finally{settle(0);await result;}
});
