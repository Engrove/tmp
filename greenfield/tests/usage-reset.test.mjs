import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {JSDOM} from 'jsdom';
const root=process.env.GREENFIELD_RESET_BASELINE ? pathToFileURL(resolve(process.env.GREENFIELD_RESET_BASELINE)+'/') : new URL('../',import.meta.url);
const {resetUsageCounters,readSafety,usageSummary,reserveUsage,authorizeUsageSend,recordUsageOutput,budgetDecision,SAFETY_KEY,usageIdentity}=await import(new URL('lib/usage-governor.mjs',root));
const {PHASES,TERMINAL_PHASES}=await import(new URL('lib/contracts.mjs',root));
const bg=await readFile(new URL('background.js',root),'utf8'),panel=await readFile(new URL('sidepanel.js',root),'utf8'),html=await readFile(new URL('sidepanel.html',root),'utf8');
const now=Date.parse('2026-11-06T12:00:00+02:00');
const policy=patch=>({...globalThis.GreenfieldSafetyPolicy.defaults,messages3h:1000,messages24h:5000,messages7d:10000,tokens24h:50000000,minGapSeconds:10,outputReserveTokens:1024,...patch});
const row=(id,patch={})=>({id,processId:id,workerId:id,atMs:now-60000,inputTokens:100,reserveTokens:1024,outputTokens:200,completedAtMs:now-59000,...patch});
const state=(entries=[row('old')],patch={})=>({schema:SAFETY_KEY,policy:policy(),admissionPaused:false,providerHold:null,entries,events:[],createdAtMs:1,lastClockMs:now-60000,...patch});
function storage(seed={}) {const data=structuredClone(seed);return {data,
 async get(keys){return structuredClone(keys==null?data:Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,data[k]])));},
 async set(rows){Object.assign(data,structuredClone(rows));},async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete data[k];}};}
const reserve=(local,id,at=now)=>reserveUsage({id,processId:id,workerId:id,prompt:'work',proof:{allowed:true,observedAtMs:at},now:at},local);
function zero(s){for(const key of ['messages3h','messages24h','messages7d','inputTokens24h','outputTokens24h','chargedTokens24h'])assert.equal(s[key],0,key);}
function fn(name,source,deps) {
 const match=new RegExp(`^(?:async )?function ${name}\\(`,'m').exec(source);assert.ok(match,name);
 const tail=source.slice(match.index),end=/^}\s*$/m.exec(tail);
 return Function(...Object.keys(deps),tail.slice(0,end.index+end[0].length)+`;return ${name};`)(...Object.values(deps));
}

test('manual reset: all usage counters zero, every receipt and configured limit retained',async()=>{
 const old=state([row('completed'),row('pending',{completedAtMs:null,authorizedAtMs:now-60000})],{lastAuthorizedAtMs:now-60000,lastAuthorizedDispatchId:'receipt'});
 const local=storage({[SAFETY_KEY]:old,'unrelated':{queue:['a','b'],turn:76,session:13}}),result=await resetUsageCounters(local,now),v=await readSafety(local);
 zero(result);zero(usageSummary(v,now));assert.deepEqual(v.entries,old.entries);assert.deepEqual(v.policy,old.policy);
 for(const key of ['lastAuthorizedAtMs','lastAuthorizedDispatchId','lastClockMs','createdAtMs'])assert.equal(v[key],old[key],key);
 assert.equal(result.pendingCount,1);assert.equal(result.usageResetAtMs,now);assert.equal(result.usageEpoch,1);
 assert.equal(v.events.at(-1).code,'USAGE_COUNTERS_RESET');assert.deepEqual(local.data.unrelated,{queue:['a','b'],turn:76,session:13});
});
test('manual reset: fresh journal and repeated empty resets remain valid',async()=>{
 const local=storage();zero(await resetUsageCounters(local,now));zero(await resetUsageCounters(local,now));
 const v=await readSafety(local);assert.equal(v.usageEpoch,2);assert.equal(v.entries.length,0);assert.equal(v.events.length,2);
});
test('manual reset: late answers and duplicate reservations never resurrect old consumption',async()=>{
 const local=storage({[SAFETY_KEY]:state([row('pending',{completedAtMs:null,authorizedAtMs:now-60000})])});
 await resetUsageCounters(local,now);await recordUsageOutput('pending','large answer '.repeat(5000),local,now+1);
 assert.equal((await reserve(local,'pending',now+2)).code,'USAGE_ALREADY_RESERVED');
 const v=await readSafety(local);assert.equal(v.entries.length,1);assert.ok(v.entries[0].outputTokens>1000);zero(usageSummary(v,now+2));
});
test('manual reset: same millisecond new reservations are counted, pre-reset ones excluded',async()=>{
 const local=storage({[SAFETY_KEY]:state([row('old',{atMs:now})])});
 await resetUsageCounters(local,now);
 // Pacing remains active even though usage was reset.
 assert.equal((await reserve(local,'new',now)).code,'LOCAL_PACING_WAIT');
 assert.equal((await reserve(local,'new',now+10000)).allowed,true);const v=await readSafety(local),s=usageSummary(v,now+10000);
 assert.equal(s.messages3h,1);assert.equal(s.messages24h,1);assert.equal(s.messages7d,1);assert.ok(s.chargedTokens24h>0);
 assert.equal(v.entries.find(e=>e.id==='new').usageEpoch,1);
});
test('manual reset: atomic generation orders a same-millisecond reserve/reset race',async()=>{
 for(const resetFirst of [true,false]){
  const local=storage({[SAFETY_KEY]:state([])});
  await Promise.all(resetFirst ? [resetUsageCounters(local,now),reserve(local,'new',now)] : [reserve(local,'new',now),resetUsageCounters(local,now)]);
  const v=await readSafety(local);assert.equal(v.entries.length,1);assert.equal(usageSummary(v,now).messages24h,resetFirst?1:0);
 }
});
test('manual reset: first send of an old unsent reservation charges the new epoch once',async()=>{
 const local=storage({[SAFETY_KEY]:state([row('unsent',{completedAtMs:null,outputTokens:0})])});
 await resetUsageCounters(local,now);zero(usageSummary(await readSafety(local),now));
 assert.equal((await authorizeUsageSend('unsent','send',local,now)).allowed,true);
 assert.equal((await authorizeUsageSend('unsent','send',local,now+1)).allowed,true);
 const v=await readSafety(local);assert.equal(v.entries.length,1);assert.equal(v.entries[0].usageEpoch,1);assert.equal(usageSummary(v,now+1).messages24h,1);
});
test('manual reset: authorize/reset race has an exact boundary and no duplicate charge',async()=>{
 for(const resetFirst of [true,false]){
  const local=storage({[SAFETY_KEY]:state([row('unsent',{completedAtMs:null})])});
  const results=await Promise.all(resetFirst ? [resetUsageCounters(local,now),authorizeUsageSend('unsent','send',local,now)] : [authorizeUsageSend('unsent','send',local,now),resetUsageCounters(local,now)]);
  assert.equal(results[resetFirst?1:0].allowed,true);const v=await readSafety(local);assert.equal(v.entries.length,1);assert.equal(usageSummary(v,now).messages24h,resetFirst?1:0);
 }
});
test('manual reset: old authorized retries retain their receipt and excluded charge',async()=>{
 const local=storage({[SAFETY_KEY]:state([row('sent',{authorizedAtMs:now-60000,completedAtMs:null})],{lastAuthorizedAtMs:now-60000,lastAuthorizedDispatchId:'send'})});
 await resetUsageCounters(local,now);
 assert.equal((await authorizeUsageSend('sent','send',local,now)).allowed,true);
 assert.equal((await authorizeUsageSend('sent','retry',local,now)).allowed,true);
 const v=await readSafety(local);zero(usageSummary(v,now));assert.equal(v.entries[0].authorizedAtMs,now-60000);assert.equal(v.entries.length,1);
});
test('manual reset: parallel old reservations cannot exceed a newly filled budget',async()=>{
 const local=storage({[SAFETY_KEY]:state([row('a',{completedAtMs:null}),row('b',{completedAtMs:null})],{policy:policy({messages24h:1})})});
 await resetUsageCounters(local,now);
 const results=await Promise.all([authorizeUsageSend('a','a-send',local,now),authorizeUsageSend('b','b-send',local,now+10000)]);
 assert.equal(results.filter(r=>r.allowed).length,1);assert.equal(results[1].code,'LOCAL_MESSAGES24H_BUDGET');
 assert.equal(usageSummary(await readSafety(local),now+10000).messages24h,1);
});
test('manual reset: three-hour deadline ignores receipts from earlier epochs',async()=>{
 const local=storage({[SAFETY_KEY]:state([row('old',{atMs:now-3600000})],{policy:policy({messages3h:1})})});
 await resetUsageCounters(local,now);await reserve(local,'new',now);
 const d=budgetDecision(await readSafety(local),'next','work',now+10000);
 assert.equal(d.code,'LOCAL_MESSAGES3H_BUDGET');assert.equal(d.retryAtMs,now+3*3600000+1);
});
test('manual reset: fresh usage still follows day and Monday calendar resets',async()=>{
 const local=storage({[SAFETY_KEY]:state()});await resetUsageCounters(local,now);await reserve(local,'new',now);
 const v=await readSafety(local),tomorrow=Date.parse('2026-11-07T00:00:00+02:00'),monday=Date.parse('2026-11-09T00:00:00+02:00');
 assert.equal(usageSummary(v,tomorrow).messages24h,0);assert.equal(usageSummary(v,tomorrow).messages7d,1);zero(usageSummary(v,monday));
});
test('manual reset: operator pause, provider quota and clock rollback guards survive',async()=>{
 for(const [patch,code] of [[{admissionPaused:true},'OPERATOR_ADMISSION_PAUSED'],[{providerHold:{signature:'q',resetAtMs:now+3600000}},'PROVIDER_QUOTA_HOLD'],[{lastClockMs:now+120000},'SYSTEM_CLOCK_ROLLBACK']]){
  const old=state(undefined,patch),local=storage({[SAFETY_KEY]:old});await resetUsageCounters(local,now);const v=await readSafety(local);
  for(const key of Object.keys(patch))assert.deepEqual(v[key],old[key]);assert.equal(budgetDecision(v,'new','work',now).code,code);
 }
});
test('manual reset: both reservation and final authorization pacing survive',async()=>{
 const local=storage({[SAFETY_KEY]:state([row('unsent',{completedAtMs:null,atMs:now-1})],{lastAuthorizedAtMs:now-1,lastAuthorizedDispatchId:'prior'})});
 await resetUsageCounters(local,now);assert.equal(budgetDecision(await readSafety(local),'new','work',now).code,'LOCAL_PACING_WAIT');
 assert.equal((await authorizeUsageSend('unsent','next',local,now)).code,'LOCAL_PACING_WAIT');
});
test('manual reset: durable readback after restart preserves reset and receipts',async()=>{
 const local=storage({[SAFETY_KEY]:state()});await resetUsageCounters(local,now);const restarted=storage(local.data),v=await readSafety(restarted);
 zero(usageSummary(v,now));assert.equal(v.usageEpoch,1);assert.equal(v.entries.length,1);assert.equal((await reserve(restarted,'old',now)).code,'USAGE_ALREADY_RESERVED');
});
test('manual reset: compressed storage retains the full journal across reset',async()=>{
 const {packStorageValue,isPackedStorageValue}=await import('../lib/storage-codec.mjs');
 const entries=Array.from({length:300},(_,i)=>row('receipt-'+i)),old=state(entries);
 const packed=await packStorageValue(SAFETY_KEY,old);assert.equal(isPackedStorageValue(packed),true);
 const local=storage({[SAFETY_KEY]:packed});await resetUsageCounters(local,now);
 assert.equal(isPackedStorageValue(local.data[SAFETY_KEY]),true);
 const v=await readSafety(local);assert.deepEqual(v.entries,entries);zero(usageSummary(v,now));
});
test('manual reset: backup restore preserves accounting epoch, history and reset time',async()=>{
 const {createOperatorBackup,restoreOperatorBackup}=await import('../lib/operator-backup.mjs');
 const local=storage({[SAFETY_KEY]:state()});await resetUsageCounters(local,now);
 const backup=await createOperatorBackup(local,{version:'1.9.49',extensionId:'test',now}),destination=storage();
 await restoreOperatorBackup(backup,destination,{now:now+1});const v=await readSafety(destination);
 zero(usageSummary(v,now));assert.equal(v.usageEpoch,1);assert.equal(v.usageResetAtMs,now);assert.equal(v.entries[0].id,'old');assert.equal(v.admissionPaused,true);
});
test('manual reset: failure to persist is reported and existing accounting remains',async()=>{
 const local=storage({[SAFETY_KEY]:state()});local.set=async()=>{throw Error('DISK_WRITE_FAILED');};
 await assert.rejects(resetUsageCounters(local,now));assert.equal(usageSummary(await readSafety(local),now).messages24h,1);
});
test('manual reset: invalid epochs and overflow fail closed',async()=>{
 for(const patch of [{usageEpoch:-1},{usageEpoch:null},{usageEpoch:1.2},{usageEpoch:0,entries:[row('bad',{usageEpoch:1})]},{usageEpoch:Number.MAX_SAFE_INTEGER}]){
  const local=storage({[SAFETY_KEY]:state(undefined,patch)});await assert.rejects(resetUsageCounters(local,now),/SAFETY_USAGE_EPOCH_INVALID/);
 }
});

function actionFixture(local,workers=[]) {
 const wakes=[],deps={chrome:{runtime:{id:'ext',getURL:p=>'chrome-extension://ext/'+p}},runtimeReady:Promise.resolve(),
  resetUsageCounters:()=>resetUsageCounters(local,now),loadAllProcesses:async()=>structuredClone(workers),TERMINAL_PHASES,
  scheduleFast:(id,ms)=>wakes.push({id,ms}),fleetStatusSnapshot:async()=>({safety:usageSummary(await readSafety(local),now)})};
 return {wakes,run:sender=>fn('panelSafetyAction',bg,deps)({type:'EIC_GF_SAFETY_RESET_COUNTERS',windowId:1},sender)};
}
const sender={id:'ext',url:'chrome-extension://ext/sidepanel.html'};
test('manual reset: authenticated panel resets globally and wakes all active workers without altering work',async()=>{
 const workers=[{processId:'a',phase:PHASES.SENDING,turn:76},{processId:'b',phase:PHASES.ANALYZING,turn:33},{processId:'c',phase:PHASES.DONE}],copy=structuredClone(workers);
 const local=storage({[SAFETY_KEY]:state()}),f=actionFixture(local,workers),r=await f.run(sender);
 assert.equal(r.ok,true);zero(r.fleetStatus.safety);assert.deepEqual(f.wakes.map(w=>w.id),['a','b']);assert.deepEqual(workers,copy);
});
test('manual reset: page scripts, content scripts and other extension pages cannot reset',async()=>{
 for(const bad of [undefined,{id:'wrong',url:sender.url},{...sender,tab:{id:1}},{id:'ext',url:'https://chatgpt.com/'},{id:'ext',url:sender.url+'?x=1'}]){
  const local=storage({[SAFETY_KEY]:state()}),f=actionFixture(local);await assert.rejects(f.run(bad),/SAFETY_PANEL_SENDER_REQUIRED/);
  assert.equal(usageSummary(await readSafety(local),now).messages24h,1);assert.equal(f.wakes.length,0);
 }
});
test('manual reset: failed persistence does not wake workers or claim success',async()=>{
 const local=storage({[SAFETY_KEY]:state()});local.set=async()=>{throw Error('DISK_WRITE_FAILED');};const f=actionFixture(local,[{processId:'a',phase:PHASES.SENDING}]);
 await assert.rejects(f.run(sender));assert.equal(f.wakes.length,0);
});
function tickFixture(v,code,patch={}) {
 const p={processId:'p',runId:'r',sessionSeq:1,turn:76,tabId:1,phase:PHASES.SENDING,queueContext:{itemId:'keep'},pendingPrompt:{hash:'h',text:'work'},safety:{hold:{code,retryAtMs:now+86400000}},...patch};
 const calls={sending:0,waits:[]},deps={Date:class extends Date{static now(){return now;}},runtimeReady:Promise.resolve(),runtimeFault:'',findProcessById:async()=>structuredClone(p),PHASES,TERMINAL_PHASES,
  missionOwnershipKey:()=>'',chrome:{tabs:{get:async()=>null}},readSafety:async()=>v,budgetDecision:(s,id,text)=>budgetDecision(s,id,text,now),usageIdentity,
  syncSafetyRetryAlarm:async()=>{},scheduleFast:(id,ms)=>calls.waits.push(ms),syncWorkModeForWorker:async()=>{},acceptPendingMissionDelegationForWorker:async p=>p,
  isCurrentToken:()=>true,ownerToken:p=>p,audit:async()=>{},tickSending:async p=>{calls.sending++;return p;},saveProcess:async p=>{calls.saved=structuredClone(p);},
  recordIncident:async()=>{},broadcast:async()=>{},releaseSchedulerTurn:async()=>{},releaseGlobalPromptLease:async()=>{},INCIDENT_QUIET_HOLD_CODES:new Set()};
 deps.holdForSafety=fn('holdForSafety',bg,deps);return {p,calls,run:()=>fn('tickProcess',bg,deps)('p')};
}
for(const code of ['LOCAL_MESSAGES3H_BUDGET','LOCAL_MESSAGES24H_BUDGET','LOCAL_MESSAGES7D_BUDGET','LOCAL_TOKENS24H_BUDGET'])test(`manual reset: ${code} resumes the normal sending pipeline`,async()=>{
 const local=storage({[SAFETY_KEY]:state()});await resetUsageCounters(local,now);const f=tickFixture(await readSafety(local),code),out=await f.run();
 assert.equal(f.calls.sending,1);assert.equal(f.calls.waits.length,0);assert.deepEqual(out,f.p);
});
test('manual reset: unrelated waits, uncertain sends and quarantines stay fenced',async()=>{
 for(const patch of [{safety:{hold:{code:'OPERATOR_DRAFT_PRESENT',retryAtMs:now+86400000}}},{pendingPrompt:{hash:'h',text:'work',dispatch:{effectPossible:true}}},{safety:{hold:{code:'LOCAL_MESSAGES3H_BUDGET',retryAtMs:now+86400000},qualityIncident:{code:'QUARANTINE'}}}]){
  const local=storage({[SAFETY_KEY]:state()});await resetUsageCounters(local,now);const f=tickFixture(await readSafety(local),'LOCAL_MESSAGES3H_BUDGET',patch),out=await f.run();
  assert.equal(f.calls.sending,0);assert.ok(f.calls.waits[0]>0);assert.deepEqual(out,f.p);
 }
});
test('manual reset: new quota or operator pause still prevents dispatch on wake',async()=>{
 for(const patch of [{admissionPaused:true},{providerHold:{signature:'q'}},{policy:policy({messages24h:1})}]){
  const local=storage({[SAFETY_KEY]:state(undefined,patch)});await resetUsageCounters(local,now);
  if(patch.policy)await reserve(local,'new',now-10000);
  const f=tickFixture(await readSafety(local),'LOCAL_MESSAGES3H_BUDGET');await f.run();assert.equal(f.calls.sending,0);assert.ok(f.calls.waits[0]>0);
 }
});

test('manual reset UI: labelled button in usage overview sends once and reports success',async()=>{
 const dom=new JSDOM(html),$=id=>dom.window.document.getElementById(id),button=$('resetUsageCounters');assert.ok(button);assert.equal(button.textContent,'Nollställ alla räknare');assert.ok(button.closest('.usage-strip'));
 assert.equal(button.getAttribute('aria-describedby'),'usageResetScope');assert.equal($('usageResetResult').getAttribute('aria-live'),'polite');
 const start=panel.indexOf('$("resetUsageCounters").addEventListener'),end=panel.indexOf('\n});',start);assert.ok(start>=0&&end>start);
 let resolveSend;const messages=[],state={windowId:42},pending=new Promise(resolve=>{resolveSend=resolve;});
 const deps={$,state,chrome:{runtime:{sendMessage:async msg=>{messages.push(msg);return pending;}}},reasonLabel:x=>x,renderFleetStatus:()=>{}};
 deps.safetyAction=fn('safetyAction',panel,deps);Function(...Object.keys(deps),panel.slice(start,end+4))(...Object.values(deps));
 button.click();button.click();assert.equal(messages.length,1);assert.deepEqual(messages[0],{type:'EIC_GF_SAFETY_RESET_COUNTERS',windowId:42});assert.equal(button.disabled,true);
 resolveSend({ok:true,fleetStatus:{safety:{messages24h:0}}});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(button.disabled,false);assert.match($('usageResetResult').textContent,/nollställda/);assert.equal(state.fleetStatus.safety.messages24h,0);dom.window.close();
});
test('manual reset UI: failed request is visible and the button becomes usable again',async()=>{
 const dom=new JSDOM(html),$=id=>dom.window.document.getElementById(id),start=panel.indexOf('$("resetUsageCounters").addEventListener'),end=panel.indexOf('\n});',start);
 const deps={$,state:{windowId:1},chrome:{runtime:{sendMessage:async()=>({ok:false,error:'DISK_WRITE_FAILED'})}},reasonLabel:x=>x,renderFleetStatus:()=>{}};
 deps.safetyAction=fn('safetyAction',panel,deps);Function(...Object.keys(deps),panel.slice(start,end+4))(...Object.values(deps));
 $('resetUsageCounters').click();await new Promise(resolve=>setImmediate(resolve));assert.equal($('resetUsageCounters').disabled,false);assert.match($('usageResetResult').textContent,/kunde inte bekräftas.*DISK_WRITE_FAILED/);dom.window.close();
});
