import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const root=process.env.GF_QUALITY_BASELINE?pathToFileURL(resolve(process.env.GF_QUALITY_BASELINE)+'/'):new URL('../',import.meta.url);
const {conditionFromBridgeError}=await import(new URL('lib/tab-health.mjs',root));
const bg=await readFile(new URL('background.js',root),'utf8');
const {PHASES,TERMINAL_PHASES}=await import(new URL('lib/contracts.mjs',root));
const {managedOverlayOverview}=await import(new URL('lib/overlay-summary.mjs',root));
const {reconcileSafetyHoldWithFreshProof}=await import(new URL('lib/safety-hold-reconciliation.mjs',root));
function load(name,deps){const start=bg.indexOf(`async function ${name}(`),tail=bg.slice(start),end=/^}\s*$/m.exec(tail);assert(start>=0&&end);return Function(...Object.keys(deps),tail.slice(0,end.index+end[0].length)+`;return ${name}`)(...Object.values(deps));}
function seed(){return {processId:'p',workerId:'w',runId:'r',sessionSeq:1,generation:1,windowId:1,tabId:2,turn:1,phase:'WAITING',queueContext:{queueId:'q',itemId:'i',savedMissionId:'m'},lastPrompt:{hash:'original',dispatchedUserTurnId:'original-user',acknowledged:true},safety:{qualityIncident:{code:'IN_FLIGHT_QUALITY_QUARANTINE',reason:'THINKING_EFFORT_TOO_LOW',turn:1,atMs:10},proof:{effort:'Balanserad'},hold:{code:'IN_FLIGHT_QUALITY_QUARANTINE',retryAtMs:Date.now()-1}}};}
function fixture(p,{failure=false}={}){const calls=[];const deps={conditionFromBridgeError,maybeRecoverPageHealth:async p=>({handled:false,process:p}),runtimeReady:Promise.resolve(),runtimeFault:'',PHASES,TERMINAL_PHASES,findProcessById:async()=>p,missionOwnershipKey:()=>'',chrome:{tabs:{get:async()=>({})}},enforceManagedEicSurface:async()=>null,readSafety:async()=>({}),syncSafetyRetryAlarm:async()=>calls.push('alarm'),scheduleFast:()=>calls.push('schedule'),
 tabState:async(process,source)=>{calls.push('observe');if(failure)throw Object.assign(new Error('missing'),{code:'MANAGED_TAB_MISSING'});process.safety.proof={allowed:true,effort:'Extra hög'};return {url:'same-thread',generating:false,assistantHash:'response'};},
 recordResponseObservation:async(process)=>{calls.push('record');return process;},audit:async()=>calls.push('audit'),
 holdForSafety:async(process)=>{calls.push('hold');return process;}};
 return {tick:load('tickProcess',deps),calls};}
test('quarantine refreshes observation after its due time but preserves original effect and incident',async()=>{const p=seed(),before=structuredClone(p),f=fixture(p);await f.tick(p.processId);assert(f.calls.includes('observe'));assert(f.calls.includes('record'));assert.equal(p.safety.proof.effort,'Extra hög');assert.deepEqual(p.safety.qualityIncident,before.safety.qualityIncident);assert.deepEqual(p.lastPrompt,before.lastPrompt);assert.deepEqual(p.queueContext,before.queueContext);assert.equal(p.phase,'WAITING');});
test('quarantine observation obeys retry deadline and does not renew it on an early wake',async()=>{const p=seed();p.safety.hold.retryAtMs=Date.now()+30000;const f=fixture(p);await f.tick(p.processId);assert.deepEqual(f.calls,['alarm','schedule']);});
test('unavailable quarantine page retains the original incident and cannot dispatch or rotate',async()=>{const p=seed(),before=structuredClone(p),f=fixture(p,{failure:true});await f.tick(p.processId);assert(f.calls.includes('observe'));assert(f.calls.includes('hold'));assert.deepEqual(p,before);});
test('fresh current Extra high proof is not retroactive proof of a quarantined turn',()=>{const p=seed();const r=reconcileSafetyHoldWithFreshProof(p.safety,{allowed:true,code:'UI_MODEL_COMPATIBLE'},p.safety.qualityIncident,{process:p});assert.equal(r.cleared,false);assert.deepEqual(r.hold,p.safety.hold);});
test('quarantined overlay never presents old generation grace as current generation',()=>{const p=seed();p.waitingRefresh={promptHash:'original',turn:1,generationHoldUntilMs:Date.now()+3600000};const overlay=managedOverlayOverview(p);assert(!overlay.countdown.some(c=>/Generering observerad|TTL/.test(c.template)));assert.match(overlay.phaseText,/karantän/i);});
