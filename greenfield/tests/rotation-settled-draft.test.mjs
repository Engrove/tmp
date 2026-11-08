import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.env.GREENFIELD_BEHAVIOR_ROOT ? pathToFileURL(resolve(process.env.GREENFIELD_BEHAVIOR_ROOT)+'/') : new URL('../',import.meta.url);
const {staleDraftSource,draftRecoveryTarget,archiveUnsentDraft}=await import(new URL('lib/stale-draft-recovery.mjs',root));
const {sha256Hex}=await import(new URL('lib/common.mjs',root));
const background=await readFile(new URL('background.js',root),'utf8');
function fn(name,deps){const start=new RegExp('^(?:async )?function '+name+'\\(','m').exec(background)?.index;assert.notEqual(start,undefined,name);const tail=background.slice(start),end=/^}[ \t]*$/m.exec(tail);return Function(...Object.keys(deps),tail.slice(0,end.index+end[0].length)+';return '+name)(...Object.values(deps));}
import {settledRotationFixture as fixture} from './fixtures/settled-rotation.mjs';
test('settled initialization can be recovered from its own resumed process',async()=>{
 const f=await fixture();assert.equal(draftRecoveryTarget(f.target,f.page),true);
 const c=await staleDraftSource(f.target,f.target,f.hash);assert.equal(c?.kind,'SETTLED_INITIALIZATION');assert.equal(c.text,f.text);
});
test('settled initialization can be recovered from a live sibling',async()=>{
 const f=await fixture();f.target.processId='sibling';f.target.workerId='sibling-worker';
 const c=await staleDraftSource(f.source,f.target,f.hash);assert.equal(c?.kind,'SETTLED_INITIALIZATION');
});
test('restored acknowledgement binding is insensitive to object key order',async()=>{
 const f=await fixture(),ack=f.source.sessionInitialization.acknowledgement;
 ack.binding=Object.fromEntries(Object.entries(ack.binding).reverse());
 assert.equal((await staleDraftSource(f.source,f.target,f.hash))?.kind,'SETTLED_INITIALIZATION');
});
for(const mutation of ['pending','unacknowledged','missing-user-id','wrong-conversation','changed-by-human','wrong-binding','wrong-binding-hash','missing-response','missing-completion','newer-session','unknown-storage'])test('settled source rejects '+mutation,async()=>{
 const f=await fixture(),s=f.source,i=s.sessionInitialization,r=i.receipt;
 if(mutation==='pending')i.status='PENDING';if(mutation==='unacknowledged')r.acknowledged=false;
 if(mutation==='missing-user-id')r.dispatchedUserTurnId='';if(mutation==='wrong-conversation')r.conversationKey+='2';
 if(mutation==='changed-by-human')r.text+=' note';if(mutation==='wrong-binding')i.acknowledgement.binding.workerId='other';
 if(mutation==='wrong-binding-hash')i.acknowledgement.hash='c'.repeat(64);
 if(mutation==='missing-response')i.response=null;if(mutation==='missing-completion')i.completedAt='';
 if(mutation==='newer-session')i.sessionSeq=4;if(mutation==='unknown-storage')s.priorStateUnknown=true;
 assert.equal(await staleDraftSource(s,f.target,f.hash),null);
});
for(const mutation of ['unpaired','untrusted','missing-response','unknown-dispatch','attempted','prior-state-unknown','operator-wait','human-authority','warm','wrong-document'])test('resumed target rejects '+mutation,async()=>{
 const f=await fixture(),p=f.target;
 if(mutation==='unpaired')p.lastResponse.observation.pairedUserTurnId='other';if(mutation==='untrusted')p.lastResponse.observation.ownerTrusted=false;
 if(mutation==='missing-response')p.lastResponse=null;if(mutation==='unknown-dispatch')p.pendingPrompt.dispatch={effectPossible:null};
 if(mutation==='attempted')p.pendingPrompt.sendAttempts=1;if(mutation==='prior-state-unknown')p.priorStateUnknown=true;
 if(mutation==='operator-wait')p.ownerWait={state:'WAIT'};if(mutation==='human-authority')p.lastDecision={humanAuthorityRequired:true};
 if(mutation==='warm')p.sessionRotation.warmResume={warm:true};if(mutation==='wrong-document')f.page.documentId='';
 assert.equal(draftRecoveryTarget(p,f.page),false);
});
test('unproven draft has a bounded explicit preservation state, no navigation or send',async()=>{
 const f=await fixture();f.target.sessionRotation.readinessWait={code:'SESSION_ROTATION_COMPOSER_DRAFT_PRESENT',sinceAt:new Date(Date.now()-3600000).toISOString(),composerTextHash:f.hash};
 let current=f.target;const delays=[];
 const deps={nowIso:()=>new Date().toISOString(),recoverStaleRotationDraft:async()=>({handled:false,process:current}),
  transportTransitionBoundary:async()=>({blocked:false,process:current}),saveRotationState:async(p,r)=>current={...p,sessionRotation:r},
  recordIncident:async()=>{},scheduleFast:(id,ms)=>delays.push(ms)};
 const result=await fn('observeRotationComposerWait',deps)(current,current.sessionRotation,f.page);
 assert.equal(result.process.sessionRotation.readinessWait.reviewRequired,true);assert.ok(delays.at(-1)>=30000);
 assert.equal(result.process.phase,'ROTATING');assert.equal(result.process.pendingPrompt.sendAttempts,0);
});
export {fixture,fn};

for(const failure of ['loading','bridge','late-stop'])test('expired rotation preserves recorded draft through '+failure,async()=>{
 const {PHASES}=await import(new URL('lib/contracts.mjs',root)),{SESSION_ROTATION_STATES}=await import(new URL('lib/session-rotation.mjs',root));
 const f=await fixture();let current=f.target,navigations=0;
 current.sessionRotation.navigationStartedAt=new Date(Date.now()-3600000).toISOString();
 current.sessionRotation.readinessWait={code:'SESSION_ROTATION_COMPOSER_DRAFT_PRESENT',sinceAt:new Date(Date.now()-3600000).toISOString(),composerTextHash:f.hash};
 const deps={PHASES,SESSION_ROTATION_STATES,EIC_LANDING_TIMEOUT_MS:60000,nowIso:()=>new Date().toISOString(),
  invalidCapturedResponse:()=>false,warmResumeTarget:()=>'',readEicSurfaceState:async()=>({entryUrl:current.gptRoot}),resolveManagedGptRoot:()=>current.gptRoot,supportedUrl:()=>true,
  recheckExpiredRotationReady:async()=>({handled:false}),ensureContentBridgeVersion:async()=>{},bridgeMessage:async()=>{throw Error('BRIDGE_LOST');},
  transportTransitionBoundary:async()=>{if(failure==='late-stop')current={...current,phase:'STOPPED'};return {blocked:current.phase==='STOPPED',process:current};},
  saveRotationState:async(p,r)=>current={...p,sessionRotation:r},scheduleFast:()=>{},
  chrome:{storage:{local:{}},tabs:{get:async()=>({id:current.tabId,windowId:current.windowId,url:current.gptRoot,status:failure==='bridge'?'complete':'loading'}),update:async()=>navigations++}}};
 const result=await fn('tickRotating',deps)(current);assert.equal(navigations,0);assert.equal(result.pendingPrompt.sendAttempts,0);
 if(failure==='late-stop')assert.equal(result.phase,'STOPPED');else {assert.equal(result.phase,'ROTATING');assert.equal(result.sessionRotation.readinessWait.reviewRequired,true);}
});
