import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.env.GF_AUDIT_BASELINE?pathToFileURL(resolve(process.env.GF_AUDIT_BASELINE)+'/'):new URL('../',import.meta.url);
const {storageLock,readCheckpoint,writeCheckpoint}=await import(new URL('lib/durable-checkpoint.mjs',root));
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const observe=p=>{const result={state:'PENDING'};p.then(value=>Object.assign(result,{state:'FULFILLED',value}),error=>Object.assign(result,{state:'REJECTED',error}));return result;};

test('stalled checkpoint read rejects within a finite wait and does not poison later reads',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const wait=deferred();let calls=0;
 const storage={get:()=>++calls===1?wait.promise:Promise.resolve({})};
 const r=observe(readCheckpoint('isolated',storage));await flush();t.mock.timers.tick(30001);await flush();
 try{assert.equal(r.state,'REJECTED','caller cannot wait forever for a storage read');
 const second=observe(readCheckpoint('isolated',storage));await flush();assert.equal(second.state,'FULFILLED');assert.equal(second.value.health,'EMPTY');}
 finally{wait.resolve({});await flush();}
});
test('timed-out mutation retains serialization; independent keys run and queued work cannot execute later',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const wait=deferred(),storage={};let effects=0,late=0;
 const first=observe(storageLock(storage,'owned',async()=>{effects++;await wait.promise;effects++;return'completed';}));
 await flush();const queued=observe(storageLock(storage,'owned',async()=>{late++;}));
 const other=await storageLock(storage,'independent',async()=>42);assert.equal(other,42);
 t.mock.timers.tick(30001);await flush();
 try{assert.equal(first.state,'REJECTED','the caller needs an explicit UNKNOWN result within its wait budget');
 assert.equal(queued.state,'REJECTED','queued wait is bounded too');
 const blocked=observe(storageLock(storage,'owned',async()=>{late++;}));await flush();
 assert.equal(blocked.state,'REJECTED','do not accumulate retries behind an unknown active effect');assert.equal(late,0);}
 finally{wait.resolve();await flush();}
 assert.equal(effects,2,'original work may settle late while retaining its fence');assert.equal(late,0,'timed-out queued task must never start');
 assert.equal(await storageLock(storage,'owned',async()=>43),43,'recovery works after original operation settles');
});
test('readback timeout cannot report checkpoint PASS or publish unverified state',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const data={},wait=deferred();let staged=false,hold=true;
 const storage={async set(v){Object.assign(data,structuredClone(v));staged=true;},get(k){
   if(staged&&hold)return wait.promise;
   return Promise.resolve(typeof k==='string'?{[k]:data[k]}:Object.fromEntries(k.map(x=>[x,data[x]])));},async remove(keys){for(const k of keys)delete data[k];}};
 const r=observe(writeCheckpoint('mission',{state:'intended'},storage));
 // crypto digest uses the real event loop; wait until the intended I/O seam.
 for(let i=0;i<100&&!staged;i++)await new Promise(r=>setImmediate(r));
 assert.equal(staged,true);await flush();t.mock.timers.tick(30001);await flush();
 try{assert.equal(r.state,'REJECTED');assert.equal(data.mission,undefined,'no publish before a verified stage readback');
 hold=false;const next=await readCheckpoint('mission',storage);assert.equal(next.health,'RECOVERY_REQUIRED');}
 finally{wait.resolve({});await flush();}
});

test('nested mutation timeout retains the outer ownership fence until the inner effect settles',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const wait=deferred(),storage={};let overlapping=0;
 const outer=observe(storageLock(storage,'registry',()=>storageLock(storage,'queue',()=>wait.promise)));
 await flush();t.mock.timers.tick(30001);await flush();
 const next=observe(storageLock(storage,'registry',async()=>{overlapping++;}));await flush();
 try{assert.equal(outer.state,'REJECTED');assert.equal(next.state,'REJECTED');assert.equal(overlapping,0,'late child may still write the shared registry');}
 finally{wait.resolve();await flush();}
 assert.equal(await storageLock(storage,'registry',async()=>44),44);
});
