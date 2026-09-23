import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import '../lib/safety-policy.js';

const S=globalThis.GreenfieldSafetyPolicy;
const root='https://chatgpt.com/g/g-test-eic';
const url=root+'/c/abc-123';
const NOW=1800000000000;
const evidence=(patch={})=>({
  source:'CHATGPT_UI_CONTROLS_V1',
  observedAtMs:NOW,
  modelLabel:'GPT-5.6 Sol',
  effortLabel:'Extended',
  reasoningControlSeen:true,
  effortControlSeen:true,
  mode:'CHAT',
  quota:{active:false},
  ...patch
});
const check=(patch={},policy=S.defaults)=>S.evaluateModel(evidence(patch),policy,{now:NOW,url,gptRoot:root});

test('v1.7 model floor is family-agnostic for Sol, Luna and Astra',()=>{
  for(const model of ['GPT-5.6 Sol','GPT-5.6 Luna','GPT-6 Astra','GPT-6.0 Astra','GPT-7 Nebula']){
    const r=check({modelLabel:model,effortLabel:'Djupgående'});
    assert.equal(r.allowed,true,model);
    assert.ok(['UI_MODEL_VERIFIED','UI_MODEL_COMPATIBLE'].includes(r.code));
  }
});

test('v1.7 numeric model floor accepts newer versions and rejects older versions',()=>{
  assert.equal(check({modelLabel:'GPT-5.60 Sol'}).allowed,true);
  assert.equal(check({modelLabel:'GPT-5.7 Whatever'}).allowed,true);
  assert.equal(check({modelLabel:'GPT-6 Astra'}).allowed,true);
  const older=check({modelLabel:'GPT-5.5 Sol'});
  assert.equal(older.allowed,false);
  assert.equal(older.code,'MODEL_VERSION_MISMATCH');
});

test('v1.7 family suffix in configured floor is informational, not an exact-name pin',()=>{
  const policy=S.normalizePolicy({...S.defaults,requiredModel:'GPT-5.6 Sol'});
  assert.equal(check({modelLabel:'GPT-5.6 Luna'},policy).allowed,true);
  assert.equal(check({modelLabel:'GPT-6 Astra'},policy).allowed,true);
});

test('v1.7 screenshot case can start when model name is not exposed but Djupgående control is visible',()=>{
  const r=check({modelLabel:'',effortLabel:'Djupgående',reasoningControlSeen:true});
  assert.equal(r.allowed,true);
  assert.equal(r.code,'UI_MODEL_COMPATIBLE');
  assert.equal(r.assurance,'VISIBLE_REASONING_CONTROL_MODEL_NAME_UNEXPOSED');
  assert.equal(r.effortAssurance,'NAMED_EFFORT');
});

test('v1.7 unknown future reasoning label is accepted at Extended floor when the reasoning control itself is identified',()=>{
  const r=check({modelLabel:'GPT-6 Astra',effortLabel:'Research+',reasoningControlSeen:true});
  assert.equal(r.allowed,true);
  assert.equal(r.code,'UI_MODEL_COMPATIBLE');
  assert.equal(r.effortAssurance,'REASONING_CONTROL_UNRANKED');
});

test('v1.7 unknown reasoning label does not silently satisfy Heavy floor',()=>{
  const policy=S.normalizePolicy({...S.defaults,minimumEffort:'heavy'});
  const r=check({modelLabel:'GPT-6 Astra',effortLabel:'Research+',reasoningControlSeen:true},policy);
  assert.equal(r.allowed,false);
  assert.equal(r.code,'THINKING_EFFORT_UNKNOWN');
});

test('v1.7 Djupgående and Deep are Heavy-class effort labels',()=>{
  for(const label of ['Djupgående','Deep','Deep reasoning','Heavy','Max']){
    assert.equal(S.effort(label),3,label);
  }
});

test('v1.7 explicit degraded labels still fail closed despite compatible version',()=>{
  for(const model of ['GPT-6 Astra Auto','GPT-6 Instant','GPT-6 mini','GPT-7 Fast']){
    const r=check({modelLabel:model,effortLabel:'Djupgående'});
    assert.equal(r.allowed,false,model);
    assert.equal(r.code,'MODEL_DEGRADED');
  }
});

test('v1.7 malformed explicit GPT token does not become unnamed compatibility evidence',()=>{
  const r=check({modelLabel:'GPT-6x',effortLabel:'Djupgående',reasoningControlSeen:true});
  assert.equal(r.allowed,false);
  assert.equal(r.code,'MODEL_IDENTITY_UNKNOWN');
});

test('v1.7 model parser is generic across future family names',()=>{
  assert.deepEqual(S.modelVersion('Selected: GPT-6 Astra')?.parts,[6]);
  assert.deepEqual(S.modelVersion('GPT-6.2 Orion')?.parts,[6,2]);
  assert.equal(S.modelVersion('GPT-6x'),null);
});

const adapterSource=await readFile(new URL('../lib/model-observation.js',import.meta.url),'utf8');
function adapter(){
  const context={
    Date,Set,Map,
    GreenfieldSafetyPolicy:S,
    document:{querySelector:()=>null,querySelectorAll:()=>[]},
    getComputedStyle:()=>({display:'block',visibility:'visible'})
  };
  vm.runInNewContext(adapterSource,context);
  return context.GreenfieldModelObservation;
}

test('v1.7 current-use parser accepts future family names without a family whitelist',()=>{
  const a=adapter();
  assert.equal(a.parseCurrentModelNotice('Du använder GPT-6 Astra.'),'GPT-6 Astra');
  assert.equal(a.parseCurrentModelNotice('You are currently using GPT-7 Nebula Pro.'),'GPT-7 Nebula Pro');
  assert.equal(a.parseCurrentModelNotice('Växla till GPT-6 Astra (rekommenderad modell)'), '');
});

test('v1.7 recommendation remains diagnostic and is never promoted to current-use evidence',()=>{
  const a=adapter();
  assert.equal(a.parseCurrentModelNotice('Använder skaparens rekommenderade modell: GPT-5.6 Sol'),'');
  assert.equal(a.parseRecommendedModel('Använder skaparens rekommenderade modell: GPT-5.6 Sol'),'GPT-5.6 Sol');
});

test('v1.7 same numeric model version with different family labels is not ambiguous',()=>{
  const a=adapter();
  const r=a.resolveModelLabels(['GPT-5.6 Sol','GPT-5.6 Luna'],S);
  assert.equal(r.ambiguous,false);
  assert.ok(/^GPT-5\.6 /.test(r.label));
});

test('v1.7 conflicting numeric versions remain ambiguous',()=>{
  const a=adapter();
  const r=a.resolveModelLabels(['GPT-5.6 Sol','GPT-6 Astra'],S);
  assert.equal(r.ambiguous,true);
});


test('v1.7 composer fallback recognizes the visible Djupgående chip without a model label',()=>{
  const button={
    innerText:'Djupgående',textContent:'Djupgående',
    closest:()=>null,
    getBoundingClientRect:()=>({width:120,height:28}),
    getAttribute:(name)=>name==='aria-label'?'':null,
    hasAttribute:()=>false,
    matches:()=>false,
    querySelector:()=>null
  };
  const form={querySelectorAll:()=>[button]};
  const composer={closest:(selector)=>selector==='form'?form:null};
  const context={
    Date,Set,Map,
    GreenfieldSafetyPolicy:S,
    document:{
      querySelector:(selector)=>selector==='#prompt-textarea'?composer:null,
      querySelectorAll:()=>[]
    },
    getComputedStyle:()=>({display:'block',visibility:'visible'})
  };
  vm.runInNewContext(adapterSource,context);
  const observed=context.GreenfieldModelObservation.observe();
  assert.equal(observed.modelLabel,'');
  assert.equal(observed.effortLabel,'Djupgående');
  assert.equal(observed.reasoningControlSeen,true);
  const proof=S.evaluateModel({...observed,observedAtMs:NOW},S.defaults,{now:NOW,url,gptRoot:root});
  assert.equal(proof.allowed,true);
  assert.equal(proof.code,'UI_MODEL_COMPATIBLE');
});
