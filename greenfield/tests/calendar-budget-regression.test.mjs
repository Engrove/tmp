import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const root=process.env.GREENFIELD_CALENDAR_BASELINE ? pathToFileURL(resolve(process.env.GREENFIELD_CALENDAR_BASELINE)+'/') : new URL('../',import.meta.url);
const load=name=>import(new URL(`lib/${name}.mjs`,root));
const {usageSummary,budgetDecision,reserveUsage,authorizeUsageSend,readSafety,recordUsageOutput,SAFETY_KEY,usageIdentity}=await load('usage-governor');
const {PHASES,TERMINAL_PHASES}=await load('contracts');
const bg=await readFile(new URL('background.js',root),'utf8');
const time=s=>Date.parse(s);
const policy=patch=>({...globalThis.GreenfieldSafetyPolicy.defaults,messages3h:1000,messages24h:5000,messages7d:10000,tokens24h:50000000,minGapSeconds:10,outputReserveTokens:1024,...patch});
const entry=(at,id='prior',patch={})=>({id,processId:id,workerId:id,atMs:time(at),inputTokens:100,reserveTokens:1024,outputTokens:200,completedAtMs:time(at)+1000,...patch});
const state=(entries,patch={})=>({schema:SAFETY_KEY,policy:policy(),admissionPaused:false,providerHold:null,entries,events:[],createdAtMs:1,lastClockMs:0,...patch});
function storage(seed={}) {const data=structuredClone(seed);return {data,
 async get(keys){return structuredClone(keys==null?data:Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,data[k]])));},
 async set(rows){Object.assign(data,structuredClone(rows));},async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete data[k];}};}
function tickFixture(v,now,patch={}) {
 const p={processId:'p',runId:'run',sessionSeq:1,turn:1,tabId:1,phase:PHASES.SENDING,
  queueContext:{queueId:'q',itemId:'i'},pendingPrompt:{hash:'h',text:'work'},
  safety:{hold:{code:'LOCAL_MESSAGES24H_BUDGET',retryAtMs:now+86400000}},...patch};
 const calls={sending:0,alarms:[],waits:[]};class Clock extends Date {static now(){return now;}}
 const deps={runtimeReady:Promise.resolve(),runtimeFault:'',findProcessById:async()=>structuredClone(p),PHASES,TERMINAL_PHASES,
  missionOwnershipKey:()=>'',chrome:{tabs:{get:async()=>null}},readSafety:async()=>v,
  budgetDecision:(s,id,text)=>budgetDecision(s,id,text,now),usageIdentity,Date:Clock,
  syncSafetyRetryAlarm:async p=>calls.alarms.push(p.safety.hold.retryAtMs),scheduleFast:(id,ms)=>calls.waits.push(ms),
  syncWorkModeForWorker:async()=>{},acceptPendingMissionDelegationForWorker:async p=>p,
  isCurrentToken:()=>true,ownerToken:p=>p,audit:async()=>{},tickSending:async p=>{calls.sending++;return p;},
  saveProcess:async p=>{calls.saved=structuredClone(p);},recordIncident:async()=>{},broadcast:async()=>{},
  releaseSchedulerTurn:async()=>{},releaseGlobalPromptLease:async()=>{},INCIDENT_QUIET_HOLD_CODES:new Set(['LOCAL_PACING_WAIT'])};
 const holdTail=bg.slice(bg.indexOf('async function holdForSafety(')),holdEnd=/^}\s*$/m.exec(holdTail);
 deps.holdForSafety=Function(...Object.keys(deps),holdTail.slice(0,holdEnd.index+holdEnd[0].length)+';return holdForSafety;')(...Object.values(deps));
 const start=bg.indexOf('async function tickProcess('),tail=bg.slice(start),end=/^}\s*$/m.exec(tail);
 const run=Function(...Object.keys(deps),tail.slice(0,end.index+end[0].length)+';return tickProcess;')(...Object.values(deps));
 return {p,calls,run:()=>run(p.processId)};
}

test('calendar regression: daily tokens and prompt counts reset exactly at Helsinki midnight',()=>{
 const v=state([entry('2026-11-06T23:59:59.999+02:00')]),before=usageSummary(v,time('2026-11-06T23:59:59.999+02:00'));
 assert.equal(before.messages24h,1);const after=usageSummary(v,time('2026-11-07T00:00:00+02:00'));
 for(const key of ['messages24h','inputTokens24h','outputTokens24h','chargedTokens24h'])assert.equal(after[key],0,key);
 assert.equal(after.messages7d,1);assert.equal(after.messages3h,1);assert.equal(v.entries.length,1);
});
test('calendar regression: week resets Monday midnight, not seven days after each prompt',()=>{
 const v=state([entry('2026-11-08T23:59:59.999+02:00')]);assert.equal(usageSummary(v,time('2026-11-08T23:59:59.999+02:00')).messages7d,1);
 const after=usageSummary(v,time('2026-11-09T00:00:00+02:00'));assert.equal(after.messages7d,0);assert.equal(after.messages24h,0);assert.equal(after.messages3h,1);
});
for(const [name,patch,rows,now,code,next] of [
 ['day',{messages24h:1},[entry('2026-11-06T16:00:00+02:00')],'2026-11-06T23:30:00+02:00','LOCAL_MESSAGES24H_BUDGET','2026-11-07T00:00:00+02:00'],
 ['week',{messages7d:1},[entry('2026-11-05T16:00:00+02:00')],'2026-11-06T23:30:00+02:00','LOCAL_MESSAGES7D_BUDGET','2026-11-09T00:00:00+02:00'],
 ['tokens',{tokens24h:10000},[entry('2026-11-06T16:00:00+02:00','prior',{reserveTokens:9800})],'2026-11-06T23:30:00+02:00','LOCAL_TOKENS24H_BUDGET','2026-11-07T00:00:00+02:00']
])test(`calendar regression: ${name} wait ends at the exact calendar boundary`,()=>{
 const v=state(rows,{policy:policy(patch)}),d=budgetDecision(v,'new','work',time(now));
 assert.equal(d.allowed,false);assert.equal(d.code,code);assert.equal(d.retryAtMs,time(next));
 assert.equal(budgetDecision(v,'new','work',time(next)).allowed,true);
});
test('calendar regression: send after midnight is charged once to its actual authorization day',async()=>{
 const local=storage({[SAFETY_KEY]:state([])}),reserved=time('2026-11-06T23:59:00+02:00'),sent=time('2026-11-07T00:00:01+02:00');
 assert.equal((await reserveUsage({id:'cross',processId:'p',workerId:'w',prompt:'work',proof:{allowed:true,observedAtMs:reserved},now:reserved},local)).allowed,true);
 assert.equal((await authorizeUsageSend('cross','dispatch',local,sent)).allowed,true);
 assert.equal(usageSummary(await readSafety(local),sent).messages24h,1);
 assert.equal((await authorizeUsageSend('cross','dispatch',local,sent+100)).allowed,true);assert.equal((await readSafety(local)).entries.length,1);
});
test('calendar regression: an old reservation cannot bypass the destination day quota',async()=>{
 const reserved=time('2026-11-06T23:59:00+02:00'),sent=time('2026-11-07T00:10:00+02:00');
 const local=storage({[SAFETY_KEY]:state([entry('2026-11-06T23:59:00+02:00','cross',{completedAtMs:null}),entry('2026-11-07T00:01:00+02:00','new')],{policy:policy({messages24h:1})})});
 const d=await authorizeUsageSend('cross','dispatch',local,sent);assert.equal(d.allowed,false);assert.equal(d.code,'LOCAL_MESSAGES24H_BUDGET');
 assert.equal((await readSafety(local)).entries.find(e=>e.id==='cross').authorizedAtMs,undefined);
});
test('calendar regression: the 25-hour Sunday retains all current-week receipts',async()=>{
 const monday=entry('2026-10-19T00:00:00+03:00'),now=time('2026-10-25T23:30:00+02:00');
 const local=storage({[SAFETY_KEY]:state([monday])});assert.ok(now-monday.atMs>7*86400000);
 assert.equal((await reserveUsage({id:'new',prompt:'work',processId:'p',workerId:'w',proof:{allowed:true,observedAtMs:now},now},local)).allowed,true);
 const v=await readSafety(local);assert.ok(v.entries.some(e=>e.id==='prior'));assert.equal(usageSummary(v,now).messages7d,2);
});
test('calendar regression: existing rolling deadline cannot keep an eligible worker waiting after midnight',async()=>{
 const now=time('2026-11-07T00:00:00+02:00'),v=state([entry('2026-11-06T16:00:00+02:00')],{policy:policy({messages24h:1})});
 const f=tickFixture(v,now);const out=await f.run();assert.equal(f.calls.sending,1);assert.equal(f.calls.waits.length,0);
 assert.deepEqual(out.pendingPrompt,f.p.pendingPrompt);assert.deepEqual(out.queueContext,f.p.queueContext);assert.equal(out.phase,PHASES.SENDING);
});

test('calendar continuity: pre-midnight hold arms the new boundary without modifying the pending turn',async()=>{
 const now=time('2026-11-06T23:30:00+02:00'),v=state([entry('2026-11-06T16:00:00+02:00')],{policy:policy({messages24h:1})}),f=tickFixture(v,now);
 const out=await f.run();assert.equal(f.calls.sending,0);assert.deepEqual(f.calls.alarms,[time('2026-11-07T00:00:00+02:00')]);
 assert.deepEqual(out.pendingPrompt,f.p.pendingPrompt);assert.deepEqual(out.queueContext,f.p.queueContext);
 assert.equal(f.calls.saved.safety.hold.retryAtMs,time('2026-11-07T00:00:00+02:00'));
});
test('calendar continuity: remaining weekly quota hold still waits after a daily reset',async()=>{
 const now=time('2026-11-07T00:00:00+02:00'),v=state([entry('2026-11-06T16:00:00+02:00')],{policy:policy({messages24h:1,messages7d:1})}),f=tickFixture(v,now);
 await f.run();assert.equal(f.calls.sending,0);assert.deepEqual(f.calls.alarms,[time('2026-11-09T00:00:00+02:00')]);
 assert.equal(f.calls.saved.safety.hold.code,'LOCAL_MESSAGES7D_BUDGET');
});
test('calendar continuity: operator pause and provider hold never become dispatch authority',async()=>{
 const now=time('2026-11-09T00:00:00+02:00');
 for(const patch of [{admissionPaused:true},{providerHold:{resetAtMs:now+3600000,signature:'quota'}}]){
  const v=state([],patch),f=tickFixture(v,now);await f.run();assert.equal(f.calls.sending,0);assert.ok(f.calls.waits[0]>0);assert.deepEqual(v,state([],patch));
 }
});
test('calendar continuity: unrelated holds, uncertain sends and quality quarantines keep their fences',async()=>{
 const now=time('2026-11-09T00:00:00+02:00'),retryAtMs=now+3600000;
 for(const patch of [
  {safety:{hold:{code:'OPERATOR_DRAFT_PRESENT',retryAtMs}}},
  {pendingPrompt:{hash:'h',text:'work',dispatch:{effectPossible:true}}},
  {safety:{hold:{code:'LOCAL_MESSAGES24H_BUDGET',retryAtMs},qualityIncident:{code:'IN_FLIGHT_QUALITY_QUARANTINE'}}}
 ]){
  const f=tickFixture(state([]),now,patch),out=await f.run();assert.equal(f.calls.sending,0);assert.deepEqual(out,f.p);assert.ok(f.calls.waits[0]>0);
 }
});
