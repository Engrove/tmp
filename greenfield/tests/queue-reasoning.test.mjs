import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {normalizeReasoningLevel,reasoningLabels,reasoningAuthorizationMatches} from '../lib/reasoning-level.mjs';
import {normalizeMissionWorkQueue,normalizeMissionWorkItem,loadMissionWorkQueue,saveMissionWorkQueue,
  updateMissionWorkItem,createQueueContext,publicMissionWorkQueue} from '../lib/mission-work-queue.mjs';
import {normalizeMissionQueueSet,saveMissionQueueSet,loadMissionQueueSets,applyMissionQueueSet} from '../lib/mission-queue-sets.mjs';
import {createOperatorBackup,restoreOperatorBackup} from '../lib/operator-backup.mjs';
import {queueDispatchAdmission} from '../lib/queue-dispatch-admission.mjs';
import {createProcess,ownerToken,isCurrentToken} from '../lib/state.mjs';
import {PHASES} from '../lib/contracts.mjs';
import {usageIdentity} from '../lib/usage-governor.mjs';
import {dispatchedTurnQuality} from '../lib/turn-quality.mjs';
import {attachDispatchReceipt} from './fixtures/dispatch-receipt.mjs';
import {reasoningUI,levels,runtime,functionSource,gptRoot,url,background} from './fixtures/queue-reasoning-ui.mjs';

function storage() {
  const data={};return {data,async get(keys){return structuredClone(keys==null?data:Object.fromEntries(
    (Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,data[k]])));},
    async set(values){Object.assign(data,structuredClone(values));},async remove(keys){for(const k of [].concat(keys))delete data[k];}};
}
function bookmarks() {
  let id=2;const root={id:'0',children:[{id:'2',title:'Other',children:[]}]};
  const find=(key,n=root)=>n.id===key?n:(n.children||[]).map(c=>find(key,c)).find(Boolean);
  return {getTree:async()=>[structuredClone(root)],getChildren:async key=>structuredClone(find(key).children||[]),
    async create(v){const node={id:String(++id),...v,...(!v.url?{children:[]}: {})};find(v.parentId).children.push(node);return structuredClone(node);},
    async update(key,v){Object.assign(find(key),v);return structuredClone(find(key));},
    async removeTree(key){const n=find(key);find(n.parentId).children=find(n.parentId).children.filter(c=>c.id!==key);}};
}
function queueSeed() {
  return normalizeMissionWorkQueue({workerId:'worker',windowId:1,queueId:'queue',items:levels.map((reasoningLevel,i)=>({
    itemId:'slot-'+i,goal:'same mission',savedMissionId:'mission',label:'Synthetic mission',reasoningLevel,
    priority:'NORMAL',maxInteractions:6,order:i,schedule:{windows:[{days:[1,2,3,4,5],start:'08:00',end:'17:00'}],minIntervalMinutes:5}
  }))});
}

test('legacy queues and sets default to Extra high; unknown levels fail closed',()=>{
  assert.equal(normalizeMissionWorkItem({goal:'legacy'}).reasoningLevel,'xhigh');
  assert.equal(normalizeMissionQueueSet({name:'legacy',items:[{goal:'work'}]}).items[0].reasoningLevel,'xhigh');
  for(const value of ['pro','auto','','HIGH',0,{},'unknown'])assert.throws(()=>normalizeReasoningLevel(value),/REASONING_LEVEL_INVALID/);
});
test('real storage, queue-set create/update, profile vault, apply and backup round-trip preserve each slot',async()=>{
  const local=storage(),vault=bookmarks();let q=await saveMissionWorkQueue(queueSeed(),local);
  const created=await saveMissionQueueSet({name:'Levels',queue:q},local,{bookmarks:vault});
  assert.deepEqual(created.set.items.map(i=>i.reasoningLevel),levels);
  q=await updateMissionWorkItem(1,'slot-0',{reasoningLevel:'high'},local,{workerId:'worker'});
  assert.deepEqual(q.items.map(i=>i.reasoningLevel),['high','medium','high','xhigh']);
  const updated=await saveMissionQueueSet({name:'Levels',setId:created.set.setId,queue:q},local,{bookmarks:vault});
  assert.equal(updated.set.setId,created.set.setId);
  const restored=(await loadMissionQueueSets(storage(),{bookmarks:vault})).sets[0];
  const applied=applyMissionQueueSet({workerId:'other',windowId:2},restored);
  assert.deepEqual(applied.items.map(i=>i.reasoningLevel),['high','medium','high','xhigh']);
  assert.equal(applied.items[0].schedule.minIntervalMinutes,5);
  assert.deepEqual(publicMissionWorkQueue(q).items.map(i=>i.reasoningLevel),q.items.map(i=>i.reasoningLevel));
  assert.equal(createQueueContext(q,q.items[1]).reasoningLevel,'medium');
  const backup=await createOperatorBackup(local,{version:'1.9.44',extensionId:'fixture'}), destination=storage();
  await restoreOperatorBackup(JSON.parse(JSON.stringify(backup)),destination);
  const imported=await loadMissionWorkQueue(1,destination,{workerId:'worker'});
  assert.deepEqual(imported.items.map(i=>i.reasoningLevel),q.items.map(i=>i.reasoningLevel));
  assert.equal(imported.enabled,false);
  const sets=await loadMissionQueueSets(destination,{bookmarks:null});
  assert.deepEqual(sets.sets.find(s=>s.setId===created.set.setId).items.map(i=>i.reasoningLevel),q.items.map(i=>i.reasoningLevel));
});

for(const kind of ['slider','range','named','ordinal'])for(const level of levels)for(const initial of ['low','xhigh']) {
  test(`${kind}: ${initial} -> ${level}, exact readback and target-specific receipt`,async()=>{
    const f=reasoningUI({kind,initial});try {
      const result=await f.ensure(level);assert.equal(result.ok,true,JSON.stringify(result));
      assert.equal(result.proof.reasoningLevel,level);assert.equal(f.proof(level).allowed,true);
      for(const other of levels.filter(x=>x!==level))assert.equal(f.proof(other).allowed,false);
      assert.equal(f.counts.proSelections,0);assert.equal(f.counts.sends,0);
      const opens=f.counts.opens;assert.equal((await f.ensure(level)).ok,true);assert.equal(f.counts.opens,opens);
    } finally {f.close();}
  });
}
test('cached success is re-selected when the next queue item requests a different level',async()=>{
  const f=reasoningUI();try {
    for(const level of ['high','low','xhigh','medium']){assert.equal((await f.ensure(level)).ok,true);assert.equal(f.proof(level).allowed,true);}
    assert.equal(f.counts.opens,4);assert.equal(f.counts.proSelections,0);
  }finally{f.close();}
});
for(const kind of ['slider','named','ordinal'])test(`${kind}: unavailable target is not replaced; failure cache belongs to target`,async()=>{
  const f=reasoningUI({kind,initial:'high',available:['low','high','xhigh','pro']});try {
    const fail=await f.ensure('medium');assert.equal(fail.ok,false);assert.equal(fail.code,'THINKING_TARGET_UNAVAILABLE');
    assert.equal(f.proof('medium').allowed,false);assert.equal(f.counts.sends,0);
    const good=await f.ensure('high');assert.equal(good.ok,true,JSON.stringify(good));assert.equal(f.counts.proSelections,0);
  }finally{f.close();}
});
test('preselected Pro moves down to requested level without reselecting Pro',async()=>{
  const f=reasoningUI({initial:'pro'});try{assert.equal((await f.ensure('low')).ok,true);assert.equal(f.counts.proSelections,0);}finally{f.close();}
});
for(const level of levels)test(`${level}: exact queue choice overrides only effort floor, retaining model and surface guards`,async()=>{
  const f=reasoningUI();try {
    assert.equal((await f.ensure(level)).ok,true);
    const S=f.w.GreenfieldSafetyPolicy, evidence=f.page().modelEvidence;
    const check=(ev,policy=f.policy(level),target=url)=>S.evaluateModel(ev,policy,{url:target,gptRoot,now:f.w.Date.now(),requireHighestEffort:true});
    assert.equal(check(evidence,{...f.policy(level),minimumEffort:'heavy'}).allowed,true);
    for(const patch of [{modelLabel:'GPT-4.1'},{modelLabel:'GPT-5.6 Pro'},{quota:{active:true}},
      {blockingUi:true},{ambiguous:true},{effortLabel:'Pro'},{observedAtMs:f.w.Date.now()-16000}])
      assert.equal(check({...evidence,...patch}).allowed,false,JSON.stringify(patch));
    assert.equal(check(evidence,f.policy(level),'https://chatgpt.com/g/g-other/c/wrong').allowed,false);
    const wrong=levels.find(x=>x!==level);
    assert.equal(S.evaluateModel(evidence,f.policy(wrong),{url,gptRoot,now:f.w.Date.now()}).code,'THINKING_TARGET_MISMATCH');
    assert.equal(check(evidence,{...f.policy(level),reasoningLevel:'pro'}).code,'REASONING_LEVEL_INVALID');
  }finally{f.close();}
});
test('a legacy Extra-high receipt cannot certify High and new low receipts remain historical after edits',()=>{
  const p=createProcess({workerId:'worker',windowId:1,tabId:2,goal:'work',initialPrompt:'work'});
  p.lastPrompt={hash:'hash',conversationKey:url,acknowledged:true,dispatchId:'dispatch'};p.lastManagedUrl=url;
  attachDispatchReceipt(p);assert.equal(dispatchedTurnQuality(p).allowed,true);
  p.lastPrompt.modelProof.effort='Hög';assert.equal(dispatchedTurnQuality(p).allowed,false);
  for(const level of levels){
    const proof=p.lastPrompt.modelProof;proof.reasoningLevel=level;proof.effort=reasoningLabels[level];
    proof.highestEffort.reasoningLevel=level;proof.highestEffort.label=reasoningLabels[level];
    p.queueContext={reasoningLevel:'xhigh'};
    assert.equal(dispatchedTurnQuality(p).allowed,true,level);
  }
});

async function sendHarness({level='medium',duringUsage=null}={}) {
  const local=storage(),f=reasoningUI({initial:'xhigh'});
  let q=queueSeed();q.items=q.items.slice(0,1);Object.assign(q.items[0],{reasoningLevel:level,status:'ACTIVE',activationCount:1,schedule:null});
  q.enabled=true;q.activeItemId=q.items[0].itemId;q=await saveMissionWorkQueue(q,local);
  const p=createProcess({workerId:'worker',windowId:1,tabId:2,goal:'same mission',initialPrompt:'bounded work',gptRoot});
  p.queueContext=createQueueContext(q,q.items[0]);p.phase=PHASES.SENDING;p.pendingPrompt.hash='hash';p.pendingPrompt.dispatch=null;
  const deps={Date:f.w.Date,chrome:{runtime:{id:'fixture'},storage:{local}},runtimeFault:'',PHASES,ownerToken,isCurrentToken,
    Safety:f.w.GreenfieldSafetyPolicy,normalizeReasoningLevel,reasoningAuthorizationMatches,loadMissionWorkQueue,queueDispatchAdmission,
    readSafety:async()=>({policy:f.w.GreenfieldSafetyPolicy.defaults,entries:[{id:usageIdentity(p,p.pendingPrompt)}]}),
    loadProcessForWindow:async()=>p,maintainLocalStorage:async()=>{},usageIdentity,isInitializationPrompt:()=>false,
    authorizeUsageSend:async()=>{await duringUsage?.({local,p});return {allowed:true,policy:f.w.GreenfieldSafetyPolicy.defaults};},
    providerTransportPending:()=>false,holdForSafety:async(p,hold)=>({...p,hold}),transportTransitionBoundary:async()=>({blocked:false,process:p}),
    sha256Hex:async()=>'hash',normalizeText:s=>s,bridgeMessage:async(tab,message)=>f.w.handle(message),tabState:async()=>f.page(),audit:async()=>{}};
  deps.reasoningPolicyForProcess=runtime('reasoningPolicyForProcess',deps);
  deps.readQueueDispatchAdmission=runtime('readQueueDispatchAdmission',deps);
  const preflight=runtime('ensureHighestThinkingBeforeSend',deps);
  const result=await preflight(p,f.page());assert.equal(result.handled,false,JSON.stringify(result.process.hold));
  p.safety={turnProof:{...f.proof(level),promptHash:'hash',usageId:usageIdentity(p,p.pendingPrompt)}};
  p.pendingPrompt.dispatch={operationId:'dispatch',effectPossible:false};
  const authorize=runtime('authorizeDispatch',deps);
  const submit=f.submitWith(message=>authorize(message,{id:'fixture',tab:{id:2,windowId:1}}));
  return {f,p,local,submit,preflight};
}
for(const level of levels)test(`real preflight, durable admission and content submit select ${level}, click once and prevent replay`,async()=>{
  const h=await sendHarness({level});try {
    const first=await h.submit(level);assert.equal(first.ok,true,JSON.stringify(first));assert.equal(h.f.counts.sends,1);
    const second=await h.submit(level);assert.equal(second.acknowledged,true);assert.equal(h.f.counts.sends,1);
  }finally{h.f.close();}
});
test('an edit during usage authorization rejects stale proof before any send click',async()=>{
  let edited=false;
  const h=await sendHarness({level:'high',duringUsage:async({local})=>{
    if(!edited){edited=true;await updateMissionWorkItem(1,'slot-0',{reasoningLevel:'low'},local,{workerId:'worker'});}
  }});try {
    const result=await h.submit('high');assert.equal(result.ok,false);assert.equal(result.effectPossible,false);
    assert.equal(result.code,'REASONING_LEVEL_CHANGED');assert.equal(h.f.counts.sends,0);
    // The old process snapshot still says high. Preflight must read durable low.
    const next=await h.preflight(h.p,h.f.page());assert.equal(next.handled,false,JSON.stringify(next.process.hold));
    assert.equal(h.f.proof('low').allowed,true);assert.equal(h.f.proof('high').allowed,false);
  }finally{h.f.close();}
});

test('operator inspection uses the active slot level, while an unmanaged tab keeps the global policy',async()=>{
  const local=storage(),f=reasoningUI();try {
    const q=await saveMissionWorkQueue(queueSeed(),local);
    await f.ensure('low');
    const p={workerId:'worker',windowId:1,tabId:2,queueContext:createQueueContext(q,q.items[0])};
    const deps={chrome:{tabs:{query:async()=>[{id:2,url}]},runtime:{id:'fixture',getURL:p=>'chrome-extension://fixture/'+p}},runtimeReady:Promise.resolve(),supportedUrl:()=>true,
      ensureContentBridgeVersion:async()=>{},bridgeMessage:async()=>({ok:true,state:f.page()}),
      readEicSurfaceState:async()=>({entryUrl:gptRoot}),loadProcessForWindow:async()=>p,
      loadMissionWorkQueue:async()=>loadMissionWorkQueue(1,local,{workerId:'worker'}),normalizeReasoningLevel,
      readSafety:async()=>({policy:f.w.GreenfieldSafetyPolicy.defaults}),Safety:f.w.GreenfieldSafetyPolicy};
    deps.chrome.storage={local};deps.reasoningPolicyForProcess=runtime('reasoningPolicyForProcess',deps);
    const inspect=runtime('panelSafetyAction',deps);
    const sender={id:'fixture',url:'chrome-extension://fixture/sidepanel.html'};
    const selected=await inspect({type:'EIC_GF_SAFETY_INSPECT',windowId:1},sender);
    assert.equal(selected.inspection.allowed,true);assert.equal(selected.inspection.reasoningLevel,'low');
    p.tabId=999;
    assert.equal((await inspect({type:'EIC_GF_SAFETY_INSPECT',windowId:1},sender)).inspection.code,'THINKING_EFFORT_TOO_LOW');
  }finally{f.close();}
});

test('actual schedule editor saves reasoning with schedule; clear preserves stored level and other slots',async()=>{
  const panel=readFileSync(new URL('../sidepanel.js',import.meta.url),'utf8');
  const dom=new JSDOM(readFileSync(new URL('../sidepanel.html',import.meta.url),'utf8'),{runScripts:'outside-only'});
  const local=storage();let queue=await saveMissionWorkQueue(queueSeed(),local);
  const state={missionQueue:publicMissionWorkQueue(queue),scheduleEditor:null},$=id=>dom.window.document.getElementById(id);
  const deps={state,$,reasoningLabels,normalizeReasoningLevel,SCHEDULE_DAY_LABELS:['M','T','O','T','F','L','S'],
    escapeHtml:s=>String(s),localDateTimeValue:()=>'',
    mutateMissionQueue:async(operation,patch)=>{queue=await updateMissionWorkItem(1,patch.itemId,patch,local,{workerId:'worker'});state.missionQueue=publicMissionWorkQueue(queue);}};
  deps.renderScheduleEditor=runtime('renderScheduleEditor',deps,panel);
  deps.closeScheduleEditor=runtime('closeScheduleEditor',deps,panel);
  const open=runtime('openScheduleEditor',deps,panel),input=runtime('handleScheduleEditorInput',deps,panel),save=runtime('saveScheduleEditor',deps,panel);
  try {
    open('slot-1');assert.equal($('queueReasoningLevel').value,'medium');
    $('queueReasoningLevel').value='high';input({target:$('queueReasoningLevel')});await save();
    assert.equal(queue.items[1].reasoningLevel,'high');assert.equal(queue.items[0].reasoningLevel,'low');
    open('slot-1');$('queueReasoningLevel').value='low';input({target:$('queueReasoningLevel')});await save({clear:true});
    assert.equal(queue.items[1].reasoningLevel,'high');assert.equal(queue.items[1].schedule,null);
    assert.equal($('queueReasoningLevel').getAttribute('aria-describedby'),'queueReasoningHint');
  }finally{dom.window.close();}
});
