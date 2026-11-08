import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {advanceResponseCandidate, responseContentAdmission, initializationAcknowledged} from '../lib/response-stability.mjs';
import {responseStructuralCompleteness, appendResponseTrace, responseTraceDetail} from '../lib/response-observation.mjs';
import {hasNewCompletedAssistantResponse, evaluateWaitingRefresh} from '../lib/waiting-refresh.mjs';
import {evaluateContinuationAdmission} from '../lib/continuation-guard.mjs';
import {analysisSource, bindAdvisoryEvidence, retainedObjectiveContext, withoutStaleQueueLabel} from '../lib/continuation-integrity.mjs';
import {responseRepairCandidate, invalidCapturedResponse} from '../lib/response-repair.mjs';
import {buildA2AEnvelope, validateA2AEnvelope} from '../lib/a2a.mjs';
import {buildHjalmarPrompt} from '../lib/hjalmar-d2.mjs';
import {createSessionHealthState, markSessionHealthPromptPosted, markSessionHealthFirstResponse, markSessionHealthFirstContent, completeSessionHealthTurn, resumeSessionHealth, sessionHealthCapsule} from '../lib/session-health.mjs';
import {warmResumePageVerdict, warmResumeDecision} from '../lib/warm-resume.mjs';
import {conversationKey} from '../lib/restart-recovery.mjs';
import {responseObservationIndex} from '../lib/startup-diagnostics.mjs';

const contentSource=await readFile(new URL('../content.js',import.meta.url),'utf8');
const shellHash='cd208d569a0292a2fbf07d4d68a27f909965c07b63e4289f11cbf44ca5cf5e9d';
const url='https://chatgpt.com/g/g-test/c/conversation-a';
const observation=(text='ChatGPT sa:',patch={})=>({documentId:'doc',lastAssistantId:'fallback-turn-5',assistantHash:shellHash,assistantCount:18,
  lastAssistantOwnerKind:'CONVERSATION_TURN',lastAssistantOwnerTrusted:true,expectedUserTurnId:'u10',pairedUserTurnId:'u10',pairedUserResolvedBy:'USER_TURN_ID',
  assistantText:text,assistantTextLength:text.length,generating:false,signals:{visibilityState:'visible'},...patch});
function stable(obs) {let result;for(const now of [0,1200,3200,5000,9000])result=advanceResponseCandidate(result?.candidate,obs,{now});return result;}
const fullObjective='QUEUE INTERACTION 5/5 — FINAL QUANTUM CHECKPOINT: '+('Perform one bounded admission assessment. '.repeat(25))+' Keep the mission OPEN and NO_EOL. Do not recreate revision676 or revision677. P-ITEM LEGACY_UNUSED.';
function damagedProcess() {return {processId:'p',runId:'r',workerId:'w',generation:2,turn:10,sessionSeq:2,phase:'ANALYZING',goal:'GF-4.38.1002\nRead the owner before effects.',lastManagedUrl:url,
  queueContext:{schema:'eic.greenfield.queue-context.v1',itemId:'i',queueId:'q',savedMissionId:'m',interactionCount:4,maxInteractions:5},
  lastPrompt:{text:'original full envelope',hash:'ph',acknowledged:true,sentAt:'2026-10-14T11:27:15.887Z',dispatchedUserTurnId:'u10',a2a:{objective:fullObjective,process:{turn:10,sessionSeq:2},control:{workQueue:{completedInteractions:4}}}},
  lastResponse:{text:'ChatGPT sa:',hash:shellHash,observation:{pairedUserTurnId:'u10',conversationKey:url},contract:{ok:false}},
  lastDecision:{nextPrompt:fullObjective.slice(0,260),progressEvidence:'old checkpoint'},lastNano:{confidence:'HIGH'},objectiveState:{objective:fullObjective.slice(0,260)},
  sessionHealth:{...createSessionHealthState({sessionSeq:2,now:1000}),samples:[{turn:9,clean:true,responseChars:4000},{turn:10,clean:true,responseChars:11}]}};}

for(const label of ['ChatGPT sa:','ChatGPT sade:','ChatGPT said:','EIC sanoi:','ChatGPT sa:\nArbetade i 51 sekunder >','\u200B ChatGPT sa:']) {
  test(`UI-only response never stabilizes: ${JSON.stringify(label)}`,()=>{
    const result=stable(observation(label));assert.equal(result.complete,false);assert.equal(result.candidate,null);
    assert.equal(hasNewCompletedAssistantResponse({page:observation(label),marker:{assistantCount:17,lastAssistantId:'older',assistantHash:shellHash}}),false);
  });
}
test('actual DOM sanitizer does not restore a removed role heading, and preserves body content',()=>{
  const dom=new JSDOM('<main><article><h6 data-conversation-role="assistant">ChatGPT sa:</h6><span data-assistant-message-sent-time>12:00</span></article></main>',{url,runScripts:'outside-only'});
  const w=dom.window;Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;
  w.chrome={runtime:{id:'test',onMessage:{addListener(){},removeListener(){}},sendMessage:async()=>({ok:true})}};
  w.eval(contentSource.replace(/\}\)\(\);\s*$/, 'window.testMessageText=messageText; window.testPageState=pageState;})();'));
  try {
    const entry={owner:w.document.querySelector('article'),role:'assistant'};
    assert.equal(w.testMessageText(entry),'');
    const body=w.document.createElement('div');body.textContent='OK';entry.owner.append(body);
    assert.equal(w.testMessageText(entry),'OK');
    body.textContent='ChatGPT sa:\nREADY';assert.equal(w.testMessageText(entry),'READY');
  }finally{w.__EIC_GF_CONTENT_V2__.dispose();w.close();}
});
test('short substantive replies and fallback IDs remain admissible; causality and identity still apply',()=>{
  assert.equal(stable(observation('OK')).complete,true);
  assert.equal(stable(observation('READY',{lastAssistantOwnerTrusted:false,lastAssistantOwnerKind:'ROLE_NODE_FALLBACK'})).complete,true);
  assert.equal(stable(observation('READY',{lastAssistantOwnerTrusted:false,lastAssistantOwnerKind:'ROLE_NODE_FALLBACK',signals:{visibilityState:'hidden'}})).complete,false);
  for(const patch of [{pairedUserTurnId:'other'},{documentId:''},{generating:true},{assistantTextLength:999}])assert.equal(stable(observation('OK',patch)).complete,false);
  const a=advanceResponseCandidate(null,observation('OK'),{now:0});
  const changed=advanceResponseCandidate(a.candidate,observation('New body',{assistantHash:'new'}),{now:10000});
  assert.equal(changed.complete,false);assert.equal(changed.reads,1);
});
test('open JSON and generation flicker cannot complete a response',()=>{
  const text='{"schema":"eic.a2a.response.v1", "summary":"unfinished';
  assert.equal(responseStructuralCompleteness(text).complete,false);
  let result=advanceResponseCandidate(null,observation('OK'),{now:0});
  result=advanceResponseCandidate(result.candidate,observation('OK',{generating:true}),{now:3000});
  result=advanceResponseCandidate(result.candidate,observation('OK'),{now:6000});
  assert.equal(result.complete,false);assert.equal(result.reads,1);
});
test('initialization requires its unique hash, independent of surrounding presentation',()=>{
  const hash='a1'.repeat(32);
  for(const text of [hash,`**${hash}**`,`ChatGPT sa:\n${hash}\nStatus: klar`])assert.equal(initializationAcknowledged(text,hash),true);
  for(const text of ['ChatGPT sa:','OK','READY','READY but still processing'])assert.equal(initializationAcknowledged(text,hash),false);
  assert.equal(initializationAcknowledged(hash),false);
});
test('clipped objective cannot become a work prompt; complete constraints survive A2A serialization',()=>{
  const p=damagedProcess();
  const admission=evaluateContinuationAdmission({currentObjective:fullObjective,decision:{disposition:'CONTINUE',nextPrompt:fullObjective.slice(0,260)}});
  assert.equal(admission.code,'REPLANNED_LOSSY_OBJECTIVE_PREFIX');assert.notEqual(admission.effectiveNextPrompt,fullObjective.slice(0,260));
  p.continuationContext=retainedObjectiveContext(p);
  const a=buildA2AEnvelope({process:p,objective:admission.effectiveNextPrompt});
  assert.equal(validateA2AEnvelope(a).ok,true);
  assert.equal(a.continuity.retainedObjective.objective,fullObjective);
  assert.equal(a.control.workQueue.interactionInQuantum,5);
  const q=buildA2AEnvelope({process:{...p,queueContext:{...p.queueContext,interactionCount:0}},objective:withoutStaleQueueLabel(fullObjective)});
  assert.equal(q.control.workQueue.interactionInQuantum,1);assert.doesNotMatch(q.objective,/QUEUE INTERACTION 5\/5/);
});
test('canonical target handoff remains complete and drops obsolete retained fallback frame',()=>{
  const target='Read fresh owner state. '+('Preserve the existing boundary. '.repeat(20));
  const result=evaluateContinuationAdmission({decision:{disposition:'CONTINUE',nextPrompt:target.slice(0,260)},targetNextSuggestedAction:target});
  assert.equal(result.effectiveNextPrompt,target.trim());
  const p=damagedProcess();p.lastResponse.contract={ok:true,value:{nextSuggestedAction:target}};
  assert.equal(retainedObjectiveContext(p),null);
});
test('historical progress is not echoed; unsupported success becomes unknown',()=>{
  const p=damagedProcess(),source=analysisSource(p);
  const result=bindAdvisoryEvidence({disposition:'CONTINUE',progressEvidence:'old checkpoint',ownerEvidence:'old owner',objectiveStatus:'SATISFIED',confidence:'HIGH'},
    {evidence:'Current checkpoint verified; no new work was admitted.',source});
  assert.equal(result.decision.progressEvidence,'UNKNOWN');assert.equal(result.decision.objectiveStatus,'PENDING');assert.equal(result.decision.confidence,'LOW');
  const quote=bindAdvisoryEvidence({...result.decision,progressEvidence:'Current checkpoint verified'}, {evidence:'Current checkpoint verified; no new work.',source});
  assert.equal(quote.decision.progressEvidenceStatus,'CURRENT_RESPONSE_QUOTE');assert.deepEqual(quote.decision.evidenceSource,source);
  const prompt=buildHjalmarPrompt({currentObjective:fullObjective,responseExcerpt:'Current checkpoint verified.',previousDecision:{progressEvidence:'STALE_UNIQUE_PROGRESS',nextPrompt:'read'}});
  assert.doesNotMatch(prompt,/STALE_UNIQUE_PROGRESS/);assert.match(prompt,/Current checkpoint verified/);assert.match(prompt,/complete.*false/);
  const a=buildA2AEnvelope({process:p,objective:'Read current owner',analysisEvidence:{responseHash:'new',hjalmar:{progressEvidence:'stale',evidenceSource:{responseHash:'old'}},nano:{summary:'stale',evidenceSource:{responseHash:'old'}}}});
  assert.equal(a.analysisEvidence.hjalmar,null);assert.equal(a.analysisEvidence.nano,null);
  const bound=buildA2AEnvelope({process:p,objective:'Read current owner',analysisEvidence:{source,responseHash:source.responseHash,hjalmar:quote.decision}});
  assert.equal(bound.analysisEvidence.hjalmar.progressEvidence,'Current checkpoint verified');
  const staleTurn=buildA2AEnvelope({process:p,objective:'Read current owner',analysisEvidence:{source:{...source,turn:11},responseHash:source.responseHash,hjalmar:quote.decision}});
  assert.equal(staleTurn.analysisEvidence.hjalmar,null,'an identical hash cannot authorize evidence from an earlier turn');
});
test('repair restores the original pending turn and quantum, archives damage and never prepares a resend',()=>{
  const p=damagedProcess(),original=structuredClone(p),r=responseRepairCandidate(p,{queueContext:{...p.queueContext,interactionCount:0},now:10000});
  assert.equal(r.recoverable,true);assert.equal(r.patch.phase,'ROTATING');assert.equal(r.patch.turn,10);assert.equal(r.patch.queueContext.interactionCount,4);
  assert.equal(r.patch.objectiveState.objective,fullObjective);assert.equal(r.patch.pendingPrompt,null);assert.equal(r.patch.lastResponse,null);
  assert.equal(r.patch.responseRepair.automaticResend,false);assert.equal(r.patch.responseRepair.sourcePromptHash,'ph');assert.deepEqual(r.patch.responseRepair.original.response,p.lastResponse);
  assert.equal(r.patch.sessionHealth.samples[1].eligibleForBaseline,false);assert.equal(r.patch.sessionHealth.samples[0].clean,true);
  assert.deepEqual(p,original);assert.equal(responseRepairCandidate({...p,...r.patch}).needed,false);
});
for(const scenario of ['unacknowledged','different user','uncertain dispatch','prior send attempt','unknown quantum','wrong URL'])test(`repair refuses an unproven source: ${scenario}`,()=>{
  const p=damagedProcess();
  if(scenario==='unacknowledged')p.lastPrompt.acknowledged=false;
  if(scenario==='different user')p.lastResponse.observation.pairedUserTurnId='other';
  if(scenario==='uncertain dispatch')p.pendingPrompt={dispatch:{effectPossible:true}};
  if(scenario==='prior send attempt')p.pendingPrompt={sendAttempts:1};
  if(scenario==='unknown quantum')delete p.lastPrompt.a2a.control.workQueue.completedInteractions;
  if(scenario==='wrong URL')p.lastManagedUrl='https://example.com/c/other';
  assert.equal(responseRepairCandidate(p).recoverable,false);
});
test('real short responses are not repair candidates',()=>{
  const p=damagedProcess();p.lastResponse.text='OK';assert.equal(invalidCapturedResponse(p),false);assert.equal(responseRepairCandidate(p).needed,false);
});
function measured({admissible=true,turn=1}={}) {
  let h=markSessionHealthPromptPosted(null,{postedAtMs:1000,promptHash:'ph',turn,promptChars:100});
  h=markSessionHealthFirstResponse(h,{promptHash:'ph',observedAtMs:2000});
  h=markSessionHealthFirstContent(h,{promptHash:'ph',observedAtMs:3000});
  return completeSessionHealthTurn(h,{promptHash:'ph',completedAtMs:5000,responseChars:admissible?1000:11,responseAdmissible:admissible,responseHash:'rh'});
}
test('timing cleanliness is distinct from response validity and first content',()=>{
  const bad=measured({admissible:false}).samples[0];assert.equal(bad.timingClean,true);assert.equal(bad.clean,false);assert.equal(bad.eligibleForBaseline,false);
  const good=measured().samples[0];assert.equal(good.eligibleForBaseline,true);assert.equal(good.ttfrMs,1000);assert.equal(good.firstContentMs,2000);assert.equal(good.promptHash,'ph');
});
test('warm resumes retain session samples; cold resumes reset timing and retain provider history',()=>{
  const h=measured();h.samples[0].processingNotice=true;
  assert.deepEqual(resumeSessionHealth(h,{warm:true}),h);
  const cold=resumeSessionHealth(h,{warm:false,sessionSeq:2,sessionStartTurn:2,now:9000});assert.equal(cold.samples.length,0);assert.equal(cold.carriedTransport[0].processingNotice,true);
  const legacy={...h,samples:[1,2,3].map(turn=>({turn,clean:true,ttfrMs:100,completionMs:1000}))};
  const capsule=sessionHealthCapsule(legacy);assert.equal(capsule.completionBaselineMs,null);assert.equal(capsule.cleanSampleCount,0);assert.equal(capsule.legacyUnverifiedSampleCount,3);
});
const warm={conversationKey:conversationKey(url),expectedLastUserTurnId:'u10'};
const ready={url,lastUserId:'u10',userCount:1,assistantCount:1,generating:false,composerReady:true,composerEmpty:true};
for(const age of [89999,90000,300001])test(`observed warm readiness wins over elapsed deadline: ${age}`,()=>{
  assert.equal(warmResumePageVerdict({warm,page:ready,navigationAgeMs:age}).action,'READY');
});
test('unresolved generation survives warm deadline without fresh-chat replay; draft and identity remain protected',()=>{
  for(const patch of [{generating:true},{providerNotices:{processingNotice:true}},{providerNotices:{connectionInterrupted:true}}])assert.equal(warmResumePageVerdict({warm,page:{...ready,...patch},navigationAgeMs:600000}).action,'WAIT');
  assert.equal(warmResumePageVerdict({warm,page:{...ready,generating:true},navigationAgeMs:4*3600000}).action,'BLOCK');
  assert.equal(warmResumePageVerdict({warm,page:{...ready,composerEmpty:false},navigationAgeMs:10}).action,'WAIT');
  assert.equal(warmResumePageVerdict({warm,page:{...ready,lastUserId:'someone-else'},navigationAgeMs:10}).action,'ABANDON');
  assert.equal(warmResumeDecision({parked:damagedProcess(),interactionInQuantum:2}).warm,false);
});
test('ten minutes of hidden generation does not prove deadlock or justify a duplicate prompt',()=>{
  const now=Date.parse('2026-10-14T11:34:22Z');
  const decision=evaluateWaitingRefresh({now,waitingSince:'2026-10-14T11:24:16Z',acknowledged:true,generating:true});
  assert.equal(decision.action,'WAIT');assert.equal(decision.code,'WAITING_ACTIVE_GENERATION');
});
test('diagnostics distinguish active checkpoints and records without altering persisted phase',()=>{
  const p={...damagedProcess(),responseObservationTrace:[]};
  const state={'eic.gf.process.worker.w':{...p,turn:11,phase:'WAITING'},'eic.gf.mission-work-queue.worker.w':{activeItemId:'i',items:[{itemId:'i',status:'ACTIVE',processSnapshot:p},{itemId:'park',status:'READY',processSnapshot:{...p,processId:'other'}}]}};
  const rows=responseObservationIndex(state);
  assert.equal(rows.filter(r=>r.source==='PARKED_QUEUE_SLOT').length,1);
  assert.equal(rows.find(r=>r.source==='ACTIVE_QUEUE_CHECKPOINT').checkpointPhase,'ANALYZING');
  assert.equal(rows.find(r=>r.source==='PROCESS_RECORD').turn,11);assert.equal(p.phase,'ANALYZING');
});
test('trace count means persisted samples; independent document observation sequence remains visible',()=>{
  let trace=[];for(let i=0;i<=60;i++)trace=appendResponseTrace(trace,{reason:'GENERATING',detail:responseTraceDetail({documentId:'d',observationSequence:i+1})},{now:1000+i*1000}).trace;
  assert.equal(trace.length,1);assert.equal(trace[0].count,2);assert.equal(trace[0].detail.observationSequence,61);assert.match(trace[0].countMeaning,/NOT_POLL_COUNT/);
});
