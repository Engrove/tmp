import {test} from 'node:test';
import assert from 'node:assert/strict';
import {usagePeriods,USAGE_TIME_ZONE} from '../lib/usage-periods.mjs';
import {usageSummary,budgetDecision,reserveUsage,authorizeUsageSend,readSafety,recordUsageOutput,SAFETY_KEY,pauseAdmission,observeProviderQuota} from '../lib/usage-governor.mjs';
const t=s=>Date.parse(s),hour=3600000;
const policy=patch=>({...globalThis.GreenfieldSafetyPolicy.defaults,messages3h:1000,messages24h:5000,messages7d:10000,tokens24h:50000000,minGapSeconds:10,outputReserveTokens:1024,...patch});
const row=(at,id='a',patch={})=>({id,processId:id,workerId:id,atMs:t(at),inputTokens:100,reserveTokens:1024,outputTokens:200,completedAtMs:t(at)+1000,...patch});
const state=(entries=[],patch={})=>({schema:SAFETY_KEY,policy:policy(),admissionPaused:false,providerHold:null,entries,events:[],createdAtMs:1,lastClockMs:0,...patch});
function storage(seed={}){const data=structuredClone(seed);return {data,get:async keys=>structuredClone(keys==null?data:Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,data[k]]))),set:async v=>Object.assign(data,structuredClone(v)),remove:async keys=>{for(const k of Array.isArray(keys)?keys:[keys])delete data[k];}};}
for(const [date,start,next,hours,weekStart,weekEnd,weekHours] of [
 ['2026-03-29T12:00:00+03:00','2026-03-29T00:00:00+02:00','2026-03-30T00:00:00+03:00',23,'2026-03-23T00:00:00+02:00','2026-03-30T00:00:00+03:00',167],
 ['2026-10-25T12:00:00+02:00','2026-10-25T00:00:00+03:00','2026-10-26T00:00:00+02:00',25,'2026-10-19T00:00:00+03:00','2026-10-26T00:00:00+02:00',169],
 ['2026-11-06T12:00:00+02:00','2026-11-06T00:00:00+02:00','2026-11-07T00:00:00+02:00',24,'2026-11-02T00:00:00+02:00','2026-11-09T00:00:00+02:00',168]
])test(`calendar boundaries: ${hours}-hour day and ${weekHours}-hour week`,()=>{
 const p=usagePeriods(t(date));assert.equal(p.timeZone,'Europe/Helsinki');assert.equal(p.dayStartAtMs,t(start));assert.equal(p.nextDayAtMs,t(next));
 assert.equal((p.nextDayAtMs-p.dayStartAtMs)/hour,hours);assert.equal(p.weekStartAtMs,t(weekStart));assert.equal(p.nextWeekAtMs,t(weekEnd));assert.equal((p.nextWeekAtMs-p.weekStartAtMs)/hour,weekHours);
});
test('calendar day and week keys handle year, month and leap-day boundaries',()=>{
 for(const [at,key,week,next] of [['2027-01-01T00:00:00+02:00','2027-01-01','2026-12-28','2027-01-04T00:00:00+02:00'],['2028-02-29T23:59:00+02:00','2028-02-29','2028-02-28','2028-03-06T00:00:00+02:00']]){
  const p=usagePeriods(t(at));assert.equal(p.dayKey,key);assert.equal(p.weekKey,week);assert.equal(p.nextWeekAtMs,t(next));
 }
});
test('calendar uses Helsinki even when the host changes time zone',()=>{
 const old=process.env.TZ;try{for(const zone of ['UTC','America/Los_Angeles','Asia/Tokyo']){process.env.TZ=zone;const p=usagePeriods(t('2026-11-06T22:00:00Z'));assert.equal(p.dayKey,'2026-11-07');assert.equal(p.dayStartAtMs,t('2026-11-06T22:00:00Z'));}}finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}
 assert.equal(USAGE_TIME_ZONE,'Europe/Helsinki');
});
test('both repeated autumn hours belong to the same day and week',()=>{
 assert.deepEqual(usagePeriods(t('2026-10-25T03:30:00+03:00')),usagePeriods(t('2026-10-25T03:30:00+02:00')));
});
test('period metadata is immutable and invalid clock input is explicit',()=>{
 assert.throws(()=>{usagePeriods(t('2026-11-06T12:00:00+02:00')).nextDayAtMs=0;},TypeError);
 assert.throws(()=>usagePeriods(NaN),/USAGE_TIME_INVALID/);
});
test('exact midnight includes new entries and excludes old ones from daily and Monday totals',()=>{
 const now=t('2026-11-09T00:00:00+02:00'),v=state([row('2026-11-08T23:59:59.999+02:00','old'),row('2026-11-09T00:00:00+02:00','new')]);
 const s=usageSummary(v,now);assert.equal(s.messages24h,1);assert.equal(s.messages7d,1);assert.equal(s.messages3h,2);assert.equal(s.chargedTokens24h,1124);
});
test('cross-midnight output stays with its original send and does not consume the new day',async()=>{
 const sent=t('2026-11-08T23:58:00+02:00'),now=t('2026-11-09T00:02:00+02:00');
 const local=storage({[SAFETY_KEY]:state([row('2026-11-08T23:58:00+02:00','late',{authorizedAtMs:sent,completedAtMs:null,outputTokens:0})])});
 await recordUsageOutput('late','A long answer '.repeat(1000),local,now);const v=await readSafety(local),s=usageSummary(v,now);
 assert.equal(v.entries.length,1);assert.ok(v.entries[0].outputTokens>0);assert.equal(v.entries[0].completedAtMs,now);assert.equal(s.chargedTokens24h,0);assert.equal(s.messages7d,0);assert.equal(s.pendingCount,0);
});
test('unfinished receipts and same-id reservation survive a week change without duplication',async()=>{
 const now=t('2026-11-09T00:05:00+02:00'),local=storage({[SAFETY_KEY]:state([row('2026-10-25T10:00:00+02:00','unfinished',{completedAtMs:null})])});
 const options={id:'new',prompt:'work',processId:'new',workerId:'w',proof:{allowed:true,observedAtMs:now},now};
 await reserveUsage(options,local);const v=await readSafety(local);assert.ok(v.entries.some(e=>e.id==='unfinished'));
 assert.equal((await reserveUsage({...options,id:'unfinished'},local)).code,'USAGE_ALREADY_RESERVED');assert.equal((await readSafety(local)).entries.length,2);
});
test('daily and weekly reset never remove an operator pause or provider hold',()=>{
 const now=t('2026-11-09T00:00:00+02:00'),entries=[row('2026-11-08T18:00:00+02:00')];
 for(const [patch,code] of [[{admissionPaused:true},'OPERATOR_ADMISSION_PAUSED'],[{providerHold:{signature:'provider',resetAtMs:now+hour}},'PROVIDER_QUOTA_HOLD']]){
  const v=state(entries,patch);assert.equal(usageSummary(v,now).messages7d,0);assert.equal(budgetDecision(v,'new','work',now).code,code);
 }
});
test('rolling three-hour cap still spans midnight and releases at its own deadline',()=>{
 const prior=row('2026-11-08T23:00:00+02:00'),now=t('2026-11-09T00:00:00+02:00'),v=state([prior],{policy:policy({messages3h:1})});
 const d=budgetDecision(v,'new','work',now);assert.equal(d.code,'LOCAL_MESSAGES3H_BUDGET');assert.equal(d.retryAtMs,prior.atMs+3*hour+1);
 assert.equal(budgetDecision(v,'new','work',prior.atMs+3*hour).allowed,true);
});
test('minimum dispatch gap continues across midnight',()=>{
 const prior=row('2026-11-08T23:59:59+02:00'),now=t('2026-11-09T00:00:00+02:00'),v=state([prior]);
 assert.equal(budgetDecision(v,'new','work',now).code,'LOCAL_PACING_WAIT');assert.equal(budgetDecision(v,'new','work',prior.atMs+10000).allowed,true);
});
test('clock rollback and future usage cannot be used to manufacture fresh quota',()=>{
 const now=t('2026-11-08T23:59:00+02:00'),future=row('2026-11-09T00:03:00+02:00'),v=state([future],{lastClockMs:future.atMs});
 assert.equal(budgetDecision(v,'new','work',now).code,'SYSTEM_CLOCK_ROLLBACK');assert.equal(usageSummary(v,now).messages24h,1);
});
test('an individually oversized request has no false midnight retry promise',()=>{
 const v=state([],{policy:policy({tokens24h:10000,outputReserveTokens:20000})}),d=budgetDecision(v,'new','work',t('2026-11-06T12:00:00+02:00'));
 assert.equal(d.code,'LOCAL_TOKENS24H_BUDGET');assert.equal(d.retryAtMs,null);
});
test('a same-id authorized retry after midnight keeps its original charge period',async()=>{
 const first=t('2026-11-06T23:58:00+02:00'),now=t('2026-11-07T00:02:00+02:00');
 const local=storage({[SAFETY_KEY]:state([row('2026-11-06T23:58:00+02:00','same',{authorizedAtMs:first,completedAtMs:null})],{lastAuthorizedDispatchId:'other',lastAuthorizedAtMs:first})});
 assert.equal((await authorizeUsageSend('same','original',local,now)).allowed,true);
 assert.equal((await readSafety(local)).entries[0].authorizedAtMs,first);assert.equal(usageSummary(await readSafety(local),now).messages24h,0);
});
test('parallel old reservations cannot oversubscribe the new day at authorization',async()=>{
 const now=t('2026-11-07T00:01:00+02:00'),local=storage({[SAFETY_KEY]:state([row('2026-11-06T22:00:00+02:00','a',{completedAtMs:null}),row('2026-11-06T23:00:00+02:00','b',{completedAtMs:null})],{policy:policy({messages24h:1})})});
 const results=await Promise.all([authorizeUsageSend('a','a-send',local,now),authorizeUsageSend('b','b-send',local,now+10000)]);
 assert.equal(results.filter(r=>r.allowed).length,1);assert.equal(results[1].code,'LOCAL_MESSAGES24H_BUDGET');
 assert.equal(usageSummary(await readSafety(local),now+10000).messages24h,1);
});
test('journal restart evaluates the current calendar without a midnight mutation or startup reset',async()=>{
 const old=state([row('2026-11-06T18:00:00+02:00')]);const local=storage({[SAFETY_KEY]:old});const before=structuredClone(local.data);
 const s=usageSummary(await readSafety(local),t('2026-11-07T10:00:00+02:00'));assert.equal(s.messages24h,0);assert.equal(s.messages7d,1);assert.deepEqual(local.data,before);
});
test('calendar token reset works on both DST transition days',()=>{
 for(const [at,end] of [['2026-03-29T12:00:00+03:00','2026-03-30T00:00:00+03:00'],['2026-10-25T12:00:00+02:00','2026-10-26T00:00:00+02:00']]){
  const v=state([row(at,'a',{reserveTokens:9800})],{policy:policy({tokens24h:10000})});const d=budgetDecision(v,'b','work',t(at)+60000);
  assert.equal(d.retryAtMs,t(end));assert.equal(budgetDecision(v,'b','work',t(end)).allowed,true);
 }
});

test('authorization rechecks weekly and token quotas when an older reservation crosses the boundary',async()=>{
 const now=t('2026-11-09T00:10:00+02:00');
 for(const [patch,code,currentPatch] of [[{messages7d:1},'LOCAL_MESSAGES7D_BUDGET',{}],[{tokens24h:10000},'LOCAL_TOKENS24H_BUDGET',{reserveTokens:9800}]]){
  const local=storage({[SAFETY_KEY]:state([row('2026-11-08T23:59:00+02:00','cross',{completedAtMs:null}),row('2026-11-09T00:01:00+02:00','current',currentPatch)],{policy:policy(patch)})});
  const before=await readSafety(local),d=await authorizeUsageSend('cross','operation',local,now);assert.equal(d.allowed,false);assert.equal(d.code,code);assert.deepEqual(await readSafety(local),before);
 }
});
test('new-day reservations remain serialized and budget denial leaves stored receipts intact',async()=>{
 const now=t('2026-11-09T00:01:00+02:00'),local=storage({[SAFETY_KEY]:state([row('2026-11-08T20:00:00+02:00','old')],{policy:policy({messages24h:1})})});
 const reserve=(id,at)=>reserveUsage({id,prompt:'work',processId:id,workerId:id,proof:{allowed:true,observedAtMs:at},now:at},local);
 const r=await Promise.all([reserve('one',now),reserve('two',now+10000)]);assert.equal(r.filter(d=>d.allowed).length,1);assert.equal(r[1].code,'LOCAL_MESSAGES24H_BUDGET');
 const s=await readSafety(local);assert.equal(s.entries.length,2);assert.equal(usageSummary(s,now+10000).messages24h,1);
});
