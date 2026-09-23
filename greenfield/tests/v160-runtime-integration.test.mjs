import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './helpers/background-harness.mjs';
import {loadProcessForWindow} from '../lib/process-store.mjs';
import {readSafety,pauseAdmission,updateSafetyPolicy} from '../lib/usage-governor.mjs';
async function prepared(h){await h.mod.startRun({windowId:1,goal:'Read verified owner state and prepare a bounded result.'});return loadProcessForWindow(1);}

test('v1.6 real sending path reserves durable usage and records a model receipt before the effect',async()=>{
 const h=await harness();let p=await prepared(h);p=await h.mod.tickSending(p);
 assert.equal(h.sent.length,1);assert.equal((await readSafety()).entries.length,1);
 assert.equal(p.pendingPrompt.dispatch.effectPossible,true);assert.equal(p.safety.turnProof.allowed,true);
 p=await h.mod.tickSending(p);assert.equal(p.phase,'WAITING');assert.equal(p.lastPrompt.modelProof.model,'GPT-5.6 Thinking');assert.equal(h.sent.length,1);
});
test('v1.6 real sending path rejects a downgraded model before any submission',async()=>{
 const h=await harness();const p=await prepared(h);h.page.modelEvidence.modelLabel='GPT-5.6 Instant';const held=await h.mod.tickSending(p);
 assert.equal(h.sent.length,0);assert.equal((await readSafety()).entries.length,0);assert.equal(held.safety.hold.code,'MODEL_DEGRADED');
});
test('v1.6 a manual composer draft is preserved without submission',async()=>{
 const h=await harness();const p=await prepared(h);h.page.composerEmpty=false;h.page.composerTextHash='manual';const held=await h.mod.tickSending(p);assert.equal(h.sent.length,0);assert.equal(held.safety.hold.code,'OPERATOR_DRAFT_PRESENT');
});
test('v1.6 lost send callback and changed document cause a durable no-resend hold',async()=>{
 const h=await harness({submitMode:'transport-loss'});let p=await prepared(h);p=await h.mod.tickSending(p);assert.equal(p.pendingPrompt.dispatch.effectPossible,null);
 h.page.documentId='new-document';p=await h.mod.tickSending(p);assert.equal(p.safety.hold.code,'DISPATCH_EFFECT_UNRESOLVED');assert.equal(h.sent.length,1);
});
test('v1.6 an empty transport reply is unknown effect, never confirmed no effect',async()=>{
 const h=await harness({submitMode:'empty-reply'});let p=await prepared(h);p=await h.mod.tickSending(p);assert.equal(p.pendingPrompt.dispatch.effectPossible,null);
 h.page.documentId='new-document';p=await h.mod.tickSending(p);assert.equal(p.safety.hold.code,'DISPATCH_EFFECT_UNRESOLVED');assert.equal(h.sent.length,1);
});
test('v1.6 a model downgrade during a real waiting turn quarantines the response',async()=>{
 const h=await harness();let p=await prepared(h);p=await h.mod.tickSending(p);p=await h.mod.tickSending(p);
 h.page.modelEvidence.effortLabel='Standard';h.page.generating=false;h.page.assistantText='Pretend successful response';h.page.assistantHash='response';
 p=await h.mod.tickWaiting(p);assert.equal(p.safety.qualityIncident.code,'IN_FLIGHT_QUALITY_QUARANTINE');assert.equal(p.lastResponse,null);
 h.page.modelEvidence.effortLabel='Extended';p=await h.mod.tickWaiting(p);assert.equal(p.safety.qualityIncident.code,'IN_FLIGHT_QUALITY_QUARANTINE');assert.equal(h.sent.length,1);
});
test('v1.6 current dispatch authorization rejects another tab or operation',async()=>{
 const h=await harness();await prepared(h);
 const result=await h.mod.authorizeDispatch({dispatchId:'wrong',promptHash:'fake'},{id:h.chrome.runtime.id,tab:{...h.tab,id:99}});assert.equal(result.ok,false);
});
test('v1.6 paused global admission cannot be bypassed by direct dispatch authorization',async()=>{
 const h=await harness();let p=await prepared(h);p=await h.mod.tickSending(p);await pauseAdmission(true);
 const result=await h.mod.authorizeDispatch({dispatchId:p.pendingPrompt.dispatch.operationId,promptHash:p.pendingPrompt.hash},{id:h.chrome.runtime.id,tab:h.tab});assert.equal(result.ok,false);assert.equal(result.code,'ADMISSION_PAUSED');
});
test('v1.6 startup reconstructs the scan alarm and returns explicit fleet health data',async()=>{
 const h=await harness();assert.ok(h.alarms.has('eic.gf.recovery-scan.v1'));const snapshot=await h.mod.fleetStatusSnapshot();assert.equal(snapshot.runtimeFault,'');assert.equal(snapshot.usedCapacity,0);assert.equal(snapshot.safety.exactProviderUsage,false);
});
test('v1.6 policy mutation is denied to a page pretending to be the side panel',async()=>{
 const h=await harness();await assert.rejects(h.mod.panelSafetyAction({type:'EIC_GF_SAFETY_PAUSE',paused:false},{id:h.chrome.runtime.id,tab:h.tab,url:h.chrome.runtime.getURL('sidepanel.html')}),/PANEL_SENDER/);
});
