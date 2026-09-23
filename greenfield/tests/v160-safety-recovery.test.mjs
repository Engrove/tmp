import test from 'node:test';
import assert from 'node:assert/strict';
import '../lib/safety-policy.js';
import { readCheckpoint,writeCheckpoint,checkpointKeys } from '../lib/durable-checkpoint.mjs';
import { readSafety,reserveUsage,usageSummary,recordUsageOutput,updateSafetyPolicy,pauseAdmission,observeProviderQuota,probeProviderRecovery,budgetDecision } from '../lib/usage-governor.mjs';
import { conversationKey,recoveryProof,reconcileRestart } from '../lib/restart-recovery.mjs';
import { ensureWorkerBinding,getWorkerBinding } from '../lib/worker-identity.mjs';
import { createProcess,withRecovery } from '../lib/state.mjs';
import { saveProcess,loadProcessForWindow } from '../lib/process-store.mjs';
import { addMissionWorkItem,loadMissionWorkQueue } from '../lib/mission-work-queue.mjs';
import { fleetHealth,workerReason } from '../lib/operations-view.mjs';
const S=globalThis.GreenfieldSafetyPolicy;
const root='https://chatgpt.com/g/g-test-eic';
const url=root+'/c/abc-123';
const NOW=1800000000000;
const evidence=patch=>({source:'CHATGPT_UI_CONTROLS_V1',observedAtMs:NOW,modelLabel:'GPT-5.6 Thinking',effortLabel:'Extended',mode:'CHAT',quota:{active:false},...patch});
const check=(patch={},policy=S.defaults)=>S.evaluateModel(evidence(patch),policy,{now:NOW,url,gptRoot:root});
function memory(seed={}) {
 const state=structuredClone(seed);
 return {state,async get(keys){if(keys==null)return structuredClone(state);const list=typeof keys==='string'?[keys]:Array.isArray(keys)?keys:Object.keys(keys);return Object.fromEntries(list.filter(k=>Object.hasOwn(state,k)).map(k=>[k,structuredClone(state[k])]));},async set(rows){Object.assign(state,structuredClone(rows));},async remove(keys){for(const k of typeof keys==='string'?[keys]:keys)delete state[k];}};
}
const reserve=(storage,id,now=NOW)=>reserveUsage({id,processId:id,workerId:'worker-a',prompt:'Research the evidence.',proof:S.evaluateModel(evidence({observedAtMs:now}),S.defaults,{now,url,gptRoot:root}),now},storage);

test('v1.6 explicit GPT-5.6 Thinking and Extended passes the visible UI gate',()=>assert.equal(check().allowed,true));
for(const [name,patch,code] of [
 ['instant',{modelLabel:'GPT-5.6 Instant'},'MODEL_DEGRADED'],
 ['auto',{modelLabel:'GPT-5.6 Auto'},'MODEL_DEGRADED'],
 ['mini',{modelLabel:'GPT-5.6 mini Thinking'},'MODEL_DEGRADED'],
 ['different version',{modelLabel:'GPT-5.5 Thinking'},'MODEL_VERSION_MISMATCH'],
 ['malformed explicit model token',{modelLabel:'GPT-5.6x',effortLabel:'Extended'},'MODEL_IDENTITY_UNKNOWN'],
 ['ambiguous controls',{ambiguous:true},'MODEL_IDENTITY_UNKNOWN'],
 ['standard effort',{effortLabel:'Standard'},'THINKING_EFFORT_TOO_LOW'],
 ['light effort',{effortLabel:'Light'},'THINKING_EFFORT_TOO_LOW'],
 ['missing effort',{effortLabel:''},'THINKING_EFFORT_UNKNOWN'],
 ['Work mode',{mode:'WORK'},'CHAT_MODE_REQUIRED'],
 ['Codex mode',{mode:'CODEX'},'CHAT_MODE_REQUIRED'],
 ['stale evidence',{observedAtMs:NOW-15001},'MODEL_EVIDENCE_STALE'],
 ['future evidence',{observedAtMs:NOW+2000},'MODEL_EVIDENCE_STALE'],
 ['Nano self report',{source:'NANO_SAYS_SAFE'},'MODEL_EVIDENCE_MISSING'],
 ['blocking dialog',{blockingUi:true},'BLOCKING_CHATGPT_UI'],
 ['provider quota',{quota:{active:true}},'PROVIDER_QUOTA_OR_FALLBACK']
]) test(`v1.6 rejects ${name}`,()=>{const r=check(patch);assert.equal(r.allowed,false);assert.equal(r.code,code);});

test('v1.6 stronger effort is allowed; lower effort is not silently substituted',()=>{
 assert.equal(check({effortLabel:'Heavy'}).allowed,true);
 assert.equal(check({}, {...S.defaults,minimumEffort:'heavy'}).allowed,false);
});
test('v1.6 model and effort defaults cannot be disabled with malformed configuration',()=>{
 for(const p of [{requiredModel:'Auto'},{minimumEffort:'light'},{messages3h:0},{minGapSeconds:0},{tokens24h:NaN}])assert.throws(()=>S.normalizePolicy(p));
});
test('v1.6 wrong custom GPT, generic ChatGPT and lookalike hosts are denied',()=>{
 for(const bad of ['https://chatgpt.com/','https://chatgpt.com/g/g-other/c/abc','https://chatgpt.com.evil.test/g/g-test-eic/c/abc'])assert.equal(S.evaluateModel(evidence(),S.defaults,{now:NOW,url:bad,gptRoot:root}).allowed,false);
});
for(const notice of ["You've reached the GPT-5.6 Thinking limit. Try again later.",'Du har nått gränsen för GPT-5.6 Thinking. Återställs 16:22.','Responses will use another model until your limit resets.'])test('v1.6 recognizes quota/fallback notice: '+notice,()=>assert.equal(S.quotaSignal(notice),true));
test('v1.6 a bare clock time never fabricates a quota reset date',()=>assert.equal(S.resetTime('Du kan fortsätta 16:22',NOW).atMs,null));
test('v1.6 explicit reset timestamps include a one-minute margin',()=>{
 const iso=new Date(NOW+3600000).toISOString();assert.equal(S.resetTime('',NOW,iso).atMs,NOW+3660000);
 assert.equal(S.resetTime('try again in 30 minutes',NOW).atMs,NOW+1860000);
});
test('v1.6 visible token measurement is explicitly an estimate and includes UTF-8 bytes',()=>{
 assert.deepEqual(S.estimateTokens('abc'),{estimate:1,bytes:3,method:'UTF8_BYTES_DIV_3_ESTIMATE',exact:false});
 assert.equal(S.estimateTokens('😀').bytes,4);
});

test('v1.6 concurrent workers cannot race through the last global usage slot',async()=>{
 const store=memory();await updateSafetyPolicy({messages3h:1,minGapSeconds:10},store);
 const results=await Promise.all(Array.from({length:20},(_,i)=>reserve(store,'id-'+i)));
 assert.equal(results.filter(r=>r.allowed).length,1);assert.equal((await readSafety(store)).entries.length,1);
});
test('v1.6 a lost acknowledgement and repeated same dispatch reserve once',async()=>{
 const store=memory();await reserve(store,'id');await reserve(store,'id');assert.equal(usageSummary(await readSafety(store),NOW).messages24h,1);
});
test('v1.6 budget survives a service-worker-style recreation of the storage wrapper',async()=>{
 const store=memory();await reserve(store,'id');const reboot=memory(store.state);const result=await reserve(reboot,'next',NOW+1000);assert.equal(result.allowed,false);assert.equal(result.code,'LOCAL_PACING_WAIT');
});
test('v1.6 user pause and provider hold still block a previously reserved prompt',async()=>{
 const store=memory();await reserve(store,'id');await pauseAdmission(true,store);assert.equal((await reserve(store,'id')).allowed,false);
 await pauseAdmission(false,store);await observeProviderQuota({active:true,signature:'limit'},store,NOW);assert.equal((await reserve(store,'id')).allowed,false);
});
test('v1.6 output accounting is idempotent and cannot refund reserved uncertainty',async()=>{
 const store=memory();await reserve(store,'id');await recordUsageOutput('id','abc',store,NOW+1000);await recordUsageOutput('id','abc',store,NOW+2000);
 const sum=usageSummary(await readSafety(store),NOW+2000);assert.equal(sum.outputTokens24h,1);assert.equal(sum.chargedTokens24h,sum.inputTokens24h+8192);
});
test('v1.6 rolling windows do not reset at a calendar boundary',async()=>{
 const store=memory();await updateSafetyPolicy({messages3h:1},store);await reserve(store,'id');
 assert.equal((await reserve(store,'next',NOW+3*3600000-1)).allowed,false);assert.equal((await reserve(store,'next',NOW+3*3600000+1)).allowed,true);
});
test('v1.6 the weekly limit remains binding when the daily window expires',async()=>{
 const store=memory();await updateSafetyPolicy({messages7d:1},store);await reserve(store,'id');const r=await reserve(store,'next',NOW+2*86400000);assert.equal(r.code,'LOCAL_MESSAGES7D_BUDGET');
});
test('v1.6 a clock rollback never replenishes usage',async()=>{
 const store=memory();await reserve(store,'id');const r=await reserve(store,'next',NOW-120000);assert.equal(r.code,'SYSTEM_CLOCK_ROLLBACK');
});
test('v1.6 oversize prompt and response reserve are checked before any send',async()=>{
 const v=await readSafety(memory());v.policy={...v.policy,maxPromptTokens:1000};assert.equal(budgetDecision(v,'x','x'.repeat(3001),NOW).code,'PROMPT_LOCAL_TOKEN_BUDGET');
 v.policy={...v.policy,tokens24h:10000,outputReserveTokens:12000};assert.equal(budgetDecision(v,'x','abc',NOW).code,'LOCAL_TOKENS24H_BUDGET');
});
test('v1.6 a quota hold without an explicit date cannot expire automatically',async()=>{
 const store=memory();await observeProviderQuota({active:true,signature:'16:22'},store,NOW);await probeProviderRecovery(check(),store,{now:NOW+WEEK_MS});assert.ok((await readSafety(store)).providerHold);
});
const WEEK_MS=7*86400000;
test('v1.6 quota recovery requires two good probes after the advertised reset',async()=>{
 const store=memory();await observeProviderQuota({active:true,signature:'one',resetAtMs:NOW+1000},store,NOW);
 await probeProviderRecovery(check(),store,{now:NOW+999});assert.ok((await readSafety(store)).providerHold);
 await probeProviderRecovery(check(),store,{now:NOW+1000});assert.ok((await readSafety(store)).providerHold);
 await probeProviderRecovery({...check(),observedAtMs:NOW+7000},store,{now:NOW+7000});assert.equal((await readSafety(store)).providerHold,null);
});
test('v1.6 repeated quota observation does not perpetually postpone the same relative deadline',async()=>{
 const store=memory();await observeProviderQuota({active:true,signature:'wait',resetAtMs:NOW+10000},store,NOW);
 await observeProviderQuota({active:true,signature:'wait',resetAtMs:NOW+20000},store,NOW+10000);
 assert.equal((await readSafety(store)).providerHold.resetAtMs,NOW+10000);
});

test('v1.7.5 checksummed data round-trips and compacts to one recovery slot',async()=>{
 const store=memory();await writeCheckpoint('queue',{items:['one']},store);await writeCheckpoint('queue',{items:['one','two']},store);
 assert.deepEqual((await readCheckpoint('queue',store)).value.items,['one','two']);assert.equal(checkpointKeys('queue').filter(k=>store.state[k]).length,1);
});
test('v1.6 a concurrent reader waits for publication instead of misdiagnosing a crash',async()=>{
 const store=memory();await writeCheckpoint('queue',{n:1},store);
 let release;const barrier=new Promise(r=>release=r);const rawSet=store.set;let stagedResolve;const staged=new Promise(r=>stagedResolve=r);
 store.set=async rows=>{await rawSet(rows);if(Object.keys(rows)[0].startsWith('eic.gf.checkpoint.')){stagedResolve();await barrier;}};
 const writing=writeCheckpoint('queue',{n:2},store);await staged;const reading=readCheckpoint('queue',store);release();await writing;assert.equal((await reading).health,'VERIFIED');
});
test('v1.6 interrupted publish recovers data but never authorizes a rolled-back dispatch',async()=>{
 const store=memory();await writeCheckpoint('process',{dispatch:'old'},store);const rawSet=store.set;
 store.set=async rows=>{if(rows.process?.dispatch==='PREPARED')throw new Error('power loss');await rawSet(rows);};
 await assert.rejects(writeCheckpoint('process',{dispatch:'PREPARED'},store));
 const recovered=await readCheckpoint('process',memory(store.state));assert.equal(recovered.value.dispatch,'PREPARED');assert.equal(recovered.health,'RECOVERY_REQUIRED');
 await assert.rejects(writeCheckpoint('process',{dispatch:'retry'},memory(store.state)),/RECONCILIATION_REQUIRED/);
});
test('v1.6 corrupt primary is visible, not an empty or healthy state',async()=>{
 const store=memory();await writeCheckpoint('queue',{items:['a']},store);store.state.queue={items:[]};const r=await readCheckpoint('queue',store);assert.equal(r.health,'RECOVERY_REQUIRED');assert.deepEqual(r.value.items,['a']);
});
test('v1.7.5 corrupt sole recovery slot fails closed instead of rolling back',async()=>{
 const store=memory();await writeCheckpoint('process',{turn:1},store);await writeCheckpoint('process',{turn:2},store);store.state[checkpointKeys('process')[0]].value.turn=999;
 await assert.rejects(readCheckpoint('process',store),/CHECKPOINT_UNRECOVERABLE/);
});
test('v1.6 exhausted storage is a hard failure before compatibility publication',async()=>{
 const store=memory();store.set=async()=>{throw new Error('QUOTA_BYTES');};await assert.rejects(writeCheckpoint('queue',{items:['a']},store),/QUOTA_BYTES/);assert.equal(store.state.queue,undefined);
});
test('v1.6 all invalid copies fail explicitly rather than normalizing to an empty queue',async()=>{
 const store=memory({[checkpointKeys('queue')[0]]:{bad:true},queue:{items:[]}});await assert.rejects(readCheckpoint('queue',store),/UNRECOVERABLE/);
});

async function savedWorker(){
 const local=memory(),session=memory();const binding=await ensureWorkerBinding(7,session);
 const process=createProcess({workerId:binding.workerId,windowId:7,tabId:70,goal:'Verify owner evidence',initialPrompt:'pending',gptRoot:root});
 process.phase='WAITING';process.lastManagedUrl=url;process.lastPrompt={hash:'exact-prompt-hash',dispatchedUserTurnId:'user-turn',modelProof:{allowed:true}};
 await saveProcess(process,local,session);await addMissionWorkItem(7,'Mission preserved',{workerId:binding.workerId,storage:local});
 return {local,session,process,binding};
}
test('v1.6 cold Chrome restart rebinds only by exact conversation and persisted user-turn identity',async()=>{
 const {local,process}=await savedWorker();const session=memory();const tab={id:990,windowId:99,url};
 const report=await reconcileRestart({local,session,tabs:{query:async()=>[tab],sendMessage:async()=>({ok:true,state:{url,lastUserHash:'rendered-different',autonomousTurn:{expectedUserTurnId:'user-turn',expectedUserIndex:null,resolvedUserTurnId:'user-turn',resolvedBy:'USER_TURN_ID'}}})},ensureBridge:async()=>{}});
 assert.equal(report.restored.length,1);const p=await loadProcessForWindow(99,local,session);assert.equal(p.processId,process.processId);assert.equal(p.generation,process.generation+1);
 assert.equal((await loadMissionWorkQueue(99,local,{workerId:process.workerId})).items[0].goal,'Mission preserved');
});
test('v1.6 reused window IDs cannot steal another conversation',async()=>{
 const {local}=await savedWorker();const session=memory();const report=await reconcileRestart({local,session,tabs:{query:async()=>[{id:70,windowId:7,url:root+'/c/other'}]},ensureBridge:async()=>{throw Error('should not run');}});
 assert.equal(report.unresolved[0].code,'CONVERSATION_TAB_NOT_RESTORED');assert.equal(await getWorkerBinding(7,session),null);
});
test('v1.6 duplicate restored tabs are quarantined without guessing',async()=>{
 const {local}=await savedWorker();const report=await reconcileRestart({local,session:memory(),tabs:{query:async()=>[{id:1,windowId:1,url},{id:2,windowId:2,url}]},ensureBridge:async()=>{throw Error('should not run');}});assert.equal(report.unresolved[0].code,'AMBIGUOUS_CONVERSATION');
});
test('v1.6 a matching URL alone does not prove the prior prompt',()=>assert.equal(recoveryProof({lastManagedUrl:url,lastPrompt:{hash:'prior'}},{url,lastUserHash:'different'},{url}).ok,false));
test('v1.6 observation of the exact earlier user turn permits recovery after manual interleave',()=>assert.equal(recoveryProof({lastManagedUrl:url,lastPrompt:{hash:'prior'}},{url,lastUserHash:'manual',autonomousTurn:{userTextHash:'prior'}},{url}).ok,true));
test('v1.6 generic roots, query strings and window numbers cannot stand in for a conversation ID',()=>{
 assert.equal(conversationKey(root),'');assert.equal(conversationKey(url+'?foo=bar'),conversationKey(url));assert.equal(conversationKey('https://evil.test/c/abc'),'');
});
test('v1.6 repeated technical failures back off instead of retrying every thirty seconds forever',()=>{
 let p=createProcess({windowId:1,tabId:1,goal:'x',initialPrompt:'x'});for(let i=0;i<5;i++)p=withRecovery(p,{reason:'network',recoverTo:'SENDING',now:NOW});assert.ok(Date.parse(p.recovery.nextAttemptAt)-NOW>=15*60000);
});
test('v1.6 UI stale data, quota holds and no workers cannot masquerade as healthy live work',()=>{
 assert.equal(fleetHealth(null,NOW).tone,'warn');assert.equal(fleetHealth({generatedAt:new Date(NOW-16000).toISOString()},NOW).tone,'danger');
 assert.equal(fleetHealth({generatedAt:new Date(NOW).toISOString(),activeCount:0},NOW).tone,'neutral');
 assert.equal(fleetHealth({generatedAt:new Date(NOW).toISOString(),safety:{providerHold:{}}},NOW).tone,'danger');
 assert.match(workerReason({phase:'SENDING',safety:{hold:{code:'DISPATCH_EFFECT_UNRESOLVED'}}}),/inget omskick/);
});
