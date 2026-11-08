import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {packStorageValue,unpackStorageValue,isPackedStorageValue,packableStorageKey} from '../lib/storage-codec.mjs';
import {readStorage} from '../lib/storage-read.mjs';
import {readCheckpoint,writeCheckpoint,checkpointKeys,packCheckpointStorage,expandStorageForRollback} from '../lib/durable-checkpoint.mjs';
import {canonicalJson} from '../lib/canonical-json.mjs';
import {sha256Hex} from '../lib/common.mjs';
import {maintainStorageHeadroom,STORAGE_RETENTION_KEY} from '../lib/storage-retention.mjs';
import {createOperatorBackup} from '../lib/operator-backup.mjs';
import {createStartupDiagnostics} from '../lib/startup-diagnostics.mjs';
import {storageRetentionView} from '../lib/operations-view.mjs';
const key='eic.gf.process.worker.test',queueKey='eic.gf.mission-work-queue.worker.test';
const value={workerId:'test',phase:'ANALYZING',goal:'Bevara allt',lastResponse:{text:'åäö 🟢 漢字 \n'.repeat(12000)},pendingPrompt:{dispatch:{effectPossible:true}},empty:null,zero:0,disabled:false};
const copy=v=>structuredClone(v);
function storage(seed={}) {const data=copy(seed);return {data,QUOTA_BYTES:10485760,
 async getBytesInUse(){return Object.entries(data).reduce((n,[k,v])=>n+new TextEncoder().encode(k+JSON.stringify(v)).length,0);},
 async get(keys){return copy(keys==null?data:Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,data[k]])));},
 async set(rows){Object.assign(data,copy(rows));},async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete data[k];}};}
async function seedVerified(local,k=key,v=value) {
 const payload={schema:'eic.gf.checkpoint.v2',codec:'EIC_SORTED_JSON_V1',revision:3,savedAt:'2026-11-01T12:00:00Z',value:copy(v)};
 await local.set({[k]:v,[checkpointKeys(k)[1]]:{...payload,sha256:await sha256Hex(canonicalJson(payload))}});
 assert.equal((await readCheckpoint(k,local)).health,'VERIFIED');
}
test('codec preserves full Unicode JSON including dispatch uncertainty and object fields',async()=>{
 const packed=await packStorageValue(key,value);assert.ok(isPackedStorageValue(packed));
 assert.ok(JSON.stringify(packed).length<JSON.stringify(value).length/3);
 assert.deepEqual(await unpackStorageValue(key,packed),value);
 assert.deepEqual(await readStorage(storage({[key]:packed}),key),{[key]:value});
 assert.deepEqual((await readStorage(storage({[key]:packed}),key,{decode:false}))[key],packed);
});
test('codec leaves tiny, excluded and incompressible records in the compatible JSON format',async()=>{
 for(const [k,v] of [[key,{a:1}],['unrelated.key',value],[key,{text:randomBytes(80000).toString('base64')}],[key,null]])
   assert.deepEqual(await packStorageValue(k,v),v);
 assert.equal(packableStorageKey(checkpointKeys(queueKey)[0]),true);
 assert.equal(packableStorageKey('eic.gf.session-start-archive.v1.rotation-123'),true);
 assert.equal(packableStorageKey('eic.gf.checkpoint.eic.gf.session-start-archive.v1.rotation-123.1'),true);
 assert.equal(packableStorageKey('eic.gf.rc1-checkpoint-repair.archive'),false);
});
test('session-start archives use reversible packing instead of consuming raw local-storage quota',async()=>{
 const archiveKey='eic.gf.session-start-archive.v1.rotation-test';
 const archive={schema:'eic.greenfield.session-start-archive.v1',automaticReplay:false,
   process:{goal:'GFW test',lastResponse:{text:'full response and prompt history '.repeat(3000)}}};
 const packed=await packStorageValue(archiveKey,archive);
 assert.ok(isPackedStorageValue(packed));
 assert.deepEqual(await unpackStorageValue(archiveKey,packed),archive);
});
test('automatic retention compresses large session-start archives without deleting their content',async()=>{
 const archiveKey='eic.gf.session-start-archive.v1.retention-test';
 const archive={schema:'eic.greenfield.session-start-archive.v1',automaticReplay:false,
   process:{goal:'GFW retention test',lastPrompt:{text:'prompt '.repeat(5000)},
     lastResponse:{text:'response '.repeat(9000)}}};
 const local=storage();local.QUOTA_BYTES=50000;
 await seedVerified(local,archiveKey,archive);
 const before=await local.getBytesInUse();
 const status=await maintainStorageHeadroom(local,storage(),{force:true});
 const after=await local.getBytesInUse();
 assert.ok(status.packedRecords>0);
 assert.ok(after<before);
 assert.deepEqual((await readCheckpoint(archiveKey,local)).value,archive);
});
test('optional packing is skipped when the native codec is unavailable',async()=>{
 const original=globalThis.CompressionStream;try{globalThis.CompressionStream=undefined;assert.deepEqual(await packStorageValue(key,value),value);}finally{globalThis.CompressionStream=original;}
});
for(const [name,alter,pattern] of [
 ['wrong key',p=>({...p,key:'other'}),/HEADER_INVALID/],
 ['unknown codec',p=>({...p,codec:'other'}),/HEADER_INVALID/],
 ['oversized claim',p=>({...p,originalBytes:1e10}),/HEADER_INVALID/],
 ['truncated gzip',p=>({...p,data:p.data.slice(0,-8)}),/DATA_INVALID/],
 ['wrong hash',p=>({...p,sha256:'0'.repeat(64)}),/CHECKSUM_MISMATCH/],
 ['short claim (bounded expansion)',p=>({...p,originalBytes:30}),/DATA_INVALID/],
 ['long claim',p=>({...p,originalBytes:p.originalBytes+1}),/LENGTH_MISMATCH/]
]) test(`codec rejects ${name}`,async()=>{
 const packed=await packStorageValue(key,value);await assert.rejects(unpackStorageValue(key,alter(packed)),pattern);
});
test('new checkpoint writes keep independently decodable primary and checksummed WAL',async()=>{
 const local=storage();const result=await writeCheckpoint(key,value,local);
 assert.equal(result.health,'VERIFIED');assert.ok(isPackedStorageValue(local.data[key]));
 const wal=checkpointKeys(key).find(k=>local.data[k]);assert.ok(isPackedStorageValue(local.data[wal]));
 assert.deepEqual((await unpackStorageValue(wal,local.data[wal])).value,value);
 assert.deepEqual((await readCheckpoint(key,local)).value,value);
 await writeCheckpoint(key,{...value,turn:2},local);assert.equal((await readCheckpoint(key,local)).revision,2);
 assert.equal(checkpointKeys(key).filter(k=>local.data[k]).length,1);
});
test('physical compaction of existing primary and WAL keeps revision, checksum and every logical byte',async()=>{
 const local=storage();await seedVerified(local);const before=await readStorage(local,null);
 const result=await packCheckpointStorage(key,local);assert.equal(result.keys.length,2);
 assert.deepEqual(await readStorage(local,null),before);assert.equal((await readCheckpoint(key,local)).revision,3);
});
for(const defect of ['missing primary','corrupt primary','corrupt WAL'])test(`packed checkpoint handles ${defect} without authorizing replay`,async()=>{
 const local=storage();await writeCheckpoint(key,value,local);
 if(defect==='missing primary')delete local.data[key];
 else if(defect==='corrupt primary')local.data[key].sha256='0'.repeat(64);
 else local.data[checkpointKeys(key)[1]].sha256='0'.repeat(64);
 if(defect==='corrupt WAL')await assert.rejects(readCheckpoint(key,local),/CHECKPOINT_UNRECOVERABLE/);
 else {const r=await readCheckpoint(key,local);assert.equal(r.health,'RECOVERY_REQUIRED');assert.deepEqual(r.value,value);}
 await assert.rejects(writeCheckpoint(key,{...value,turn:999},local),/CHECKPOINT_/);
});
for(const when of ['before','after'])test(`interruption ${when} packing publication leaves a verifiable original checkpoint`,async()=>{
 const local=storage();await seedVerified(local);const set=local.set.bind(local);
 local.set=async updates=>{if(when==='after')await set(updates);throw Error('CRASH');};
 await assert.rejects(packCheckpointStorage(key,local),/CRASH/);
 const restarted=storage(local.data);const r=await readCheckpoint(key,restarted);
 assert.equal(r.health,'VERIFIED');assert.deepEqual(r.value,value);assert.equal(r.revision,3);
});
test('partial physical publication leaves mixed formats with identical logical content',async()=>{
 const local=storage();await seedVerified(local);const set=local.set.bind(local);
 local.set=async updates=>{await set({[key]:updates[key]});throw Error('CRASH_MID_BATCH');};
 await assert.rejects(packCheckpointStorage(key,local),/CRASH_MID_BATCH/);
 const r=await readCheckpoint(key,storage(local.data));assert.equal(r.health,'VERIFIED');assert.deepEqual(r.value,value);
});
test('packing readback refuses a storage write that silently loses the data',async()=>{
 const local=storage();await seedVerified(local);local.set=async()=>{};
 await assert.rejects(packCheckpointStorage(key,local),/PHYSICAL_READBACK_FAILED/);
 assert.deepEqual((await readCheckpoint(key,local)).value,value);
});
test('queue writer waits for physical compaction and publishes its newer revision',async()=>{
 const local=storage();await seedVerified(local);let release,reached;
 const gate=new Promise(r=>release=r),atWrite=new Promise(r=>reached=r),set=local.set.bind(local);let once=true;
 local.set=async rows=>{if(once){once=false;reached();await gate;}await set(rows);};
 const packing=packCheckpointStorage(key,local);await atWrite;
 const newer={...value,turn:4};const writing=writeCheckpoint(key,newer,local);release();
 await Promise.all([packing,writing]);const result=await readCheckpoint(key,local);
 assert.deepEqual(result.value,newer);assert.equal(result.revision,4);
});
test('maintenance preserves corrupt evidence while compacting a healthy sibling',async()=>{
 const local=storage();await seedVerified(local);local.data[key].goal='MISMATCH';const corrupt=copy(local.data);
 await seedVerified(local,queueKey,{items:[{status:'READY',processSnapshot:value}],enabled:true});
 const result=await maintainStorageHeadroom(local,storage(),{force:true,targetRatio:0});
 assert.deepEqual(local.data[key],corrupt[key]);assert.deepEqual(local.data[checkpointKeys(key)[1]],corrupt[checkpointKeys(key)[1]]);
 assert.ok(result.retainedRecords.some(r=>r.key===key));assert.ok(isPackedStorageValue(local.data[queueKey]));
});
test('maintenance errors are visible and never report successful cleanup',async()=>{
 const local=storage();await seedVerified(local);const set=local.set.bind(local);
 local.set=async rows=>{if(Object.keys(rows).some(k=>k!==STORAGE_RETENTION_KEY))throw Error('DISK_WRITE_FAILED');await set(rows);};
 const result=await maintainStorageHeadroom(local,storage(),{force:true});assert.equal(result.action,'ERROR');assert.ok(result.errors.some(r=>r.code==='DISK_WRITE_FAILED'));
 assert.deepEqual((await readCheckpoint(key,local)).value,value);
});
test('maintenance uses separate per-storage work and skips repeated dispatch scans within one minute',async()=>{
 const a=storage({[key]:value}),b=storage({[key]:{...value,workerId:'second'}});let gets=0;const get=a.get.bind(a);a.get=async k=>{gets++;return get(k);};
 const [ra,rb]=await Promise.all([maintainStorageHeadroom(a,storage(),{force:true,now:1000}),maintainStorageHeadroom(b,storage(),{force:true,now:1000})]);
 assert.ok(ra.packedRecords>0);assert.ok(rb.packedRecords>0);const count=gets;
 const repeated=await maintainStorageHeadroom(a,storage(),{now:2000});assert.deepEqual(repeated,ra);assert.equal(gets,count);
});
test('operator backup exports original JSON and uncertainty from packed storage',async()=>{
 const local=storage();await writeCheckpoint(key,value,local);
 const backup=await createOperatorBackup(local,{version:'test'});assert.deepEqual(backup.data[key],value);assert.equal(backup.health[0].health,'VERIFIED');
});
test('diagnostics preserves exact damaged physical bytes and indexes healthy packed records',async()=>{
 const local=storage();await writeCheckpoint(key,value,local);await writeCheckpoint(queueKey,{workerId:'test',items:[],history:[],text:value.lastResponse.text},local);
 local.data[key].sha256='0'.repeat(64);const raw=copy(local.data[key]);
 const d=await createStartupDiagnostics(local,{version:'test'});assert.deepEqual(d.storage[key],raw);
 assert.ok(d.storageCodecErrors.some(e=>e.key===key));assert.equal(d.queueProgress.length,1);assert.equal(d.startupProgress.length,0);
});
test('UI distinguishes unverified, stale, successful, protected and failed maintenance',()=>{
 const s={known:true,bytes:21810380,limitBytes:10485760,ratio:2.08},now=1000000;
 assert.match(storageRetentionView(s,null,now).text,/städstatus inaktuell/);
 const status={known:true,at:new Date(now).toISOString(),freedBytes:1048576};
 for(const [action,label] of [['COMPACTED','kompakterad'],['PARTIAL','delvis kompakterad'],['RETAINED_PROTECTED','bevarade data'],['ERROR','städfel']])assert.match(storageRetentionView(s,{...status,action},now).text,new RegExp(label));
 assert.match(storageRetentionView(s,{...status,action:'COMPACTED'},now).detail,/frigjorde 1.0 MiB/);
 assert.match(storageRetentionView(s,status,now+180001).text,/inaktuell/);
});
// Last: this operator-only rollback deliberately disables new packing in this worker.
test('rollback expands primary and WAL exactly, preserving checksums and disabling re-packing',async()=>{
 const local=storage();await seedVerified(local);const original=copy(local.data);await packCheckpointStorage(key,local);
 const result=await expandStorageForRollback(local);assert.equal(result.remaining,0);assert.deepEqual(local.data,original);
 await writeCheckpoint(key,{...value,turn:9},local);assert.equal(isPackedStorageValue(local.data[key]),false);assert.equal((await readCheckpoint(key,local)).health,'VERIFIED');
});
