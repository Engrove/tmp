import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const root=process.env.GF_AUDIT_BASELINE?pathToFileURL(resolve(process.env.GF_AUDIT_BASELINE)+'/'):new URL('../',import.meta.url);
const health=await import(new URL('lib/session-health.mjs',root));const {DELIVERY_CONTINUATION}=await import(new URL('lib/session-transport.mjs',root));
const bg=await readFile(new URL('background.js',root),'utf8');
function runtime(name,deps){const start=new RegExp(`^(?:async )?function ${name}\\(`,'m').exec(bg),tail=bg.slice(start.index),end=/^}\s*$/m.exec(tail);return Function(...Object.keys(deps),tail.slice(0,end.index+end[0].length)+`;return ${name}`)(...Object.values(deps));}
function active(){let s=health.createSessionHealthState({now:1000});s=health.markSessionHealthPromptPosted(s,{promptHash:'original',promptChars:4400,postedAtMs:1000});return health.markSessionHealthFirstResponse(s,{promptHash:'original',observedAtMs:2000});}
for(const flag of ['connectionInterrupted','processingNotice','transportRetried'])test(`${flag}: completed usable response is retained but cannot train the clean latency baseline`,()=>{
 const state=active();if(flag!=='transportRetried')state.activeTurn[flag]={firstSeenAtMs:3000,lastSeenAtMs:4000};
 const done=health.completeSessionHealthTurn(state,{promptHash:'original',completedAtMs:1325074,responseAdmissible:true,responseChars:1369,transportRetried:flag==='transportRetried'}),s=done.samples[0];
 assert.equal(s.responseAdmissible,true);assert.equal(s.responseChars,1369);assert.equal(done.capturedResponseChars,1369);
 assert.equal(s.eligibleForBaseline,false);assert.equal(s.clean,false);assert.equal(health.sessionHealthCapsule(done).cleanSampleCount,0);
});
test('normal completion still contributes a clean sample',()=>{
 const done=health.completeSessionHealthTurn(active(),{promptHash:'original',completedAtMs:5000,responseAdmissible:true,responseChars:400});
 assert.equal(done.samples[0].clean,true);assert.equal(health.sessionHealthCapsule(done).cleanSampleCount,1);
});
test('persisted v1.9.25 transport-tainted samples are excluded without deleting their measured values',()=>{
 const state=active();state.activeTurn=null;state.samples=[1,2,3,4].map(turn=>({turn,promptHash:'h'+turn,ttfrMs:1000,completionMs:1323074,firstObserved:true,eligibleForBaseline:true,clean:true,connectionInterrupted:true,responseChars:1369}));
 const old=structuredClone(state);assert.equal(health.sessionHealthCapsule(state).cleanSampleCount,0);
 assert.equal(health.sessionHealthCapsule(state).completionBaselineMs,null);assert.deepEqual(state,old,'reading health must not rewrite archived measurements');
});
for(const mismatched of [false,true])test(`turn telemetry binds prompt size/profile/hash to measured original turn; foreign root=${mismatched}`,async()=>{
 const sample={promptHash:'original',promptChars:4400,clean:false,responseChars:1369,totalMs:1330585};let row;
 const source={text:'x'.repeat(4400),hash:mismatched?'foreign':'original',promptProfile:{profile:'COMPACT'},metrics:{promptChars:4400,objectiveChars:1400},a2a:{control:{workQueue:{interactionInQuantum:2,maxInteractions:5}}}};
 const p={turn:7,sessionSeq:1,lastPrompt:{text:'Fortsätt',hash:'continuation',transportKind:DELIVERY_CONTINUATION},deliveryRetry:{rootPrompt:source,attempts:1},sessionHealth:{samples:[sample]},queueContext:{itemId:'item'}};
 const fn=runtime('recordTurnMetrics',{DELIVERY_CONTINUATION,sessionHealthCapsule:()=>({signals:[]}),recordIncident:async(p,kind,code,detail)=>{row={hash:p.lastPrompt.hash,kind,code,detail};}});
 await fn(p,{});assert.equal(row.hash,'original');assert.equal(row.detail.promptChars,4400);
 assert.equal(row.code,mismatched?'':'COMPACT');assert.equal(row.detail.objectiveChars,mismatched?null:1400);
 assert.equal(row.detail.transportPromptHash,'continuation');
});
