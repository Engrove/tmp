import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const root=process.env.GREENFIELD_STORAGE_BASELINE ? pathToFileURL(resolve(process.env.GREENFIELD_STORAGE_BASELINE)+'/') : new URL('../',import.meta.url);
const load=name=>import(new URL(`lib/${name}.mjs`,root));
const {maintainStorageHeadroom,STORAGE_RETENTION_KEY}=await load('storage-retention');
const {readStorage}=await load('storage-read');
const {createStartupDiagnostics}=await load('startup-diagnostics');
const {fleetHealth}=await load('operations-view');
const NOW=Date.parse('2026-11-01T12:00:00Z');
const key='eic.gf.process.worker.protected';
function storage(seed={}) {const data=structuredClone(seed);return {data,QUOTA_BYTES:10*1048576,
 async getBytesInUse(){return Object.entries(data).reduce((n,[k,v])=>n+new TextEncoder().encode(k+JSON.stringify(v)).length,0);},
 async get(keys){return structuredClone(keys==null?data:Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,data[k]])));},
 async set(rows){Object.assign(data,structuredClone(rows));},async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete data[k];}};}

test('storage regression: automatic upkeep shrinks large protected records without losing mission data',async()=>{
 const record={workerId:'protected',phase:'ANALYZING',pendingPrompt:{dispatch:{effectPossible:true}},goal:'Keep all instructions',lastResponse:{text:'Återställning och kvitto 🟢 '.repeat(400000)}};
 const local=storage({[key]:record}),before=await local.getBytesInUse();assert.ok(before>local.QUOTA_BYTES);
 const result=await maintainStorageHeadroom(local,storage(),{now:NOW});
 assert.ok(await local.getBytesInUse()<before/2,'physical usage must drop');
 assert.deepEqual((await readStorage(local,key))[key],record,'logical payload must remain identical');
 assert.equal(result.removedWorkers.length,0);assert.equal(result.targetReached,true);
});
test('storage regression: a no-op above target must not claim CLEANED',async()=>{
 const local=storage({[key]:{workerId:'protected',pendingPrompt:{dispatch:{effectPossible:true}}}});local.QUOTA_BYTES=20;
 const result=await maintainStorageHeadroom(local,storage(),{force:true,now:NOW});
 assert.equal(result.action,'RETAINED_PROTECTED');assert.equal(result.targetReached,false);assert.equal(result.freedBytes,0);
 assert.equal(result.retainedWorkers[0].workerId,'protected');
});
test('storage regression: diagnostic export preserves the actual upkeep result',async()=>{
 const status={at:new Date(NOW).toISOString(),action:'RETAINED_PROTECTED',beforeBytes:21810380,afterBytes:21810380};
 const d=await createStartupDiagnostics(storage({[STORAGE_RETENTION_KEY]:status}),{version:'test',now:NOW});
 assert.deepEqual(d.storageRetention,status);assert.deepEqual(d.storage[STORAGE_RETENTION_KEY],status);
});
test('storage regression: fleet warning explains protected data when cleanup cannot reach target',()=>{
 const view=fleetHealth({generatedAt:new Date(NOW).toISOString(),storage:{known:true,bytes:21810380,limitBytes:10485760,ratio:2.08},storageRetention:{at:new Date(NOW).toISOString(),known:true,action:'RETAINED_PROTECTED',targetReached:false,freedBytes:0}},NOW);
 assert.match(view.detail,/Städmålet nåddes inte/);assert.match(view.detail,/bevaras/);assert.doesNotMatch(view.detail,/tar äldsta obundna workerdata/);
});
test('storage regression: recovery failure still schedules and runs independent upkeep',async()=>{
 const source=await readFile(new URL('background.js',root),'utf8'),start=source.indexOf('async function hydrateProcesses(reason)');
 const tail=source.slice(start),end=/^}\s*$/m.exec(tail),calls=[],alarms=[];
 const body=tail.slice(0,end.index+end[0].length);
 const run=Function('chrome','probeStorageContract','maintainLocalStorage',`let hydrationInFlight=null,storageContractProof=null,runtimeFault='',restartReport={errors:[]};const RECOVERY_SCAN_ALARM='recovery',STORAGE_MAINTENANCE_ALARM='storage';${body};return hydrateProcesses;`)(
   {storage:{local:{}},alarms:{create:async(name,options)=>alarms.push({name,options})}},async()=>{throw Error('RECOVERY_FAILED');},async reason=>calls.push(reason));
 await run('test');assert.equal(calls.length,1);assert.ok(alarms.some(a=>a.name==='storage'&&a.options.periodInMinutes===1));
});
