import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./helpers/background-harness.mjs";
import { loadProcessForWindow } from "../lib/process-store.mjs";
import { sha256Hex } from "../lib/common.mjs";
import { hasCurrentGenerationEvidence, createWaitingRefreshState, resetWaitingRefreshOnAssistantResponse } from "../lib/waiting-refresh.mjs";
import { conversationRecoveryUrl, shouldRememberManagedUrl, knownConversationUrl, expectedThreadMissing } from "../lib/conversation-recovery.mjs";

const ROOT = "https://chatgpt.com/g/g-test-eic";
const CONV = `${ROOT}/c/abc-123`;
const pending = () => ({ phase: "WAITING", gptRoot: ROOT, lastManagedUrl: CONV, lastPrompt: { acknowledged: true } });

test("v1.8.8 boundary: a busy composer or an unbacked generating boolean is not positive generation evidence", () => {
  assert.equal(hasCurrentGenerationEvidence({ generating: true, signals: {} }), false);
  assert.equal(hasCurrentGenerationEvidence({ generating: true, signals: { composerBusy: true } }), false);
  assert.equal(hasCurrentGenerationEvidence({ generating: false, signals: { stopVisible: true } }), false);
  assert.equal(hasCurrentGenerationEvidence({ generating: true, signals: { stopVisible: true } }), true);
  assert.equal(hasCurrentGenerationEvidence({ generating: true, signals: { streaming: true } }), true);
});

test("v1.8.8 boundary: completion clears generation deferral, stage and requested-at state", () => {
  const base=createWaitingRefreshState({ now: 1000, promptHash: "p", turn: 1 });
  const r=resetWaitingRefreshOnAssistantResponse({
    current: { ...base, generationHoldUntilMs: 999999, stage: "F5_30", requestedAt: new Date(2000).toISOString() },
    page: { generating: false, assistantCount: 1, lastAssistantId: "a", assistantHash: "new" },
    now: 3000
  });
  assert.equal(r.reset,true);
  assert.equal(r.state.generationHoldUntilMs,0);
  assert.equal(r.state.stage,"");
  assert.equal(r.state.requestedAt,"");
});

test("v1.8.8 boundary: a planned fresh-session rotation does not restore the old conversation", () => {
  const p = { ...pending(), phase: "ROTATING" };
  assert.equal(conversationRecoveryUrl(p, ROOT), ROOT);
  assert.equal(shouldRememberManagedUrl(p, ROOT), true);
  assert.equal(expectedThreadMissing(p, { url: ROOT, pageHealth: {readyState:"complete",turnCount:0} }), false);
});

test("v1.8.8 boundary: recovery cannot borrow a conversation from another GPT or origin", () => {
  assert.equal(knownConversationUrl({ ...pending(), lastManagedUrl: "https://chatgpt.com/g/g-other/c/abc" }), "");
  assert.equal(knownConversationUrl({ ...pending(), lastManagedUrl: "https://example.invalid/c/abc" }), "");
  assert.equal(knownConversationUrl({ ...pending(), lastManagedUrl: "https://chatgpt.com/c/abc-123" }), "https://chatgpt.com/c/abc-123");
});

test("v1.8.8 boundary: missing-thread detection waits for an empty, fully loaded page, never interrupts proven generation", () => {
  const page={ url: ROOT, generating:false, pageHealth:{readyState:"complete",turnCount:0} };
  assert.equal(expectedThreadMissing(pending(),page),true);
  assert.equal(expectedThreadMissing(pending(),{...page,generating:true}),false);
  assert.equal(expectedThreadMissing(pending(),{...page,pageHealth:{readyState:"loading",turnCount:0}}),false);
  assert.equal(expectedThreadMissing(pending(),{...page,pageHealth:{readyState:"complete",turnCount:2}}),false);
  assert.equal(expectedThreadMissing({...pending(),lastManagedUrl:""},page),false);
});

async function start(extraExports=[]) {
  const h=await harness({extraExports});
  h.chrome.offscreen={createDocument:async()=>{},hasDocument:async()=>true};
  await h.mod.startRun({windowId:1,goal:"Projekt: 71 - Greenfield Works - Gf: GF-052."});
  let p=await loadProcessForWindow(1);
  p=await h.mod.tickSending(p);
  p=await h.mod.tickSending(p);
  assert.equal(p.phase,"WAITING");
  return {h,p};
}

test("v1.8.8 boundary: an EIC-proven generic conversation URL is retained; an unproven name is not", async () => {
  const {h,p}=await start(["observeSafetyForProcess"]);
  h.page.url="https://chatgpt.com/c/abc-123";
  h.page.modelEvidence.gptSurface={composerName:"EIC",headerName:"EIC"};
  await h.mod.observeSafetyForProcess(p,h.page);
  assert.equal((await loadProcessForWindow(1)).lastManagedUrl,h.page.url);
  h.page.url="https://chatgpt.com/c/other";
  h.page.modelEvidence.gptSurface={composerName:"Other",headerName:"Other"};
  await h.mod.observeSafetyForProcess(await loadProcessForWindow(1),h.page);
  assert.equal((await loadProcessForWindow(1)).lastManagedUrl,"https://chatgpt.com/c/abc-123");
});

test("v1.8.8 boundary: in-flight quality quarantine still stops recovery even past the generation limit", async () => {
  const realNow=Date.now;
  try {
    const {h,p}=await start();
    const reloads=[];
    h.chrome.tabs.reload=async(...args)=>{reloads.push(args);};
    p.safety.qualityIncident={code:"IN_FLIGHT_QUALITY_QUARANTINE",atMs:Date.now(),turn:p.turn};
    Date.now=()=>realNow()+5*60*60*1000;
    const held=await h.mod.tickWaiting(p);
    assert.equal(held.phase,"WAITING");
    assert.equal(held.safety.hold.code,"IN_FLIGHT_QUALITY_QUARANTINE");
    assert.equal(reloads.length,0);
    assert.equal(h.sent.length,1);
  } finally {Date.now=realNow;}
});

test("v1.8.8 boundary: a response that completes during the generation grace is captured without reload or resend", async () => {
  const realNow=Date.now;
  let offset=0;
  try {
    const {h}=await start();
    const reloads=[];
    h.chrome.tabs.reload=async(...args)=>{reloads.push(args);};
    h.page.signals={stopVisible:true,streaming:true};
    Date.now=()=>realNow()+offset;
    offset=40*60*1000;
    await h.mod.tickWaiting(await loadProcessForWindow(1));
    const text=JSON.stringify({schema:"eic.a2a.response.v1",status:"CONTINUE",summary:"Bounded progress.",workPerformed:["Step"],evidence:["Owner"],blockers:[],nextSuggestedAction:"Continue."});
    const hash=await sha256Hex(text);
    Object.assign(h.page,{
      generating:false, signals:{stopVisible:false,streaming:false},
      assistantCount:1,lastAssistantId:"assistant-1",assistantText:text,assistantHash:hash,
      autonomousTurn:{
        expectedUserTurnId:h.page.lastUserId,expectedUserIndex:h.page.userCount-1,
        resolvedUserTurnId:h.page.lastUserId,resolvedBy:"USER_TURN_ID",userTextHash:h.page.lastUserHash,
        assistantFound:true,assistantId:"assistant-1",assistantOwnerKind:"EXPLICIT_TURN_SHELL",
        assistantOwnerTrusted:true,assistantReplicaCount:1,assistantText:text,
        assistantTextLength:text.length,assistantHash:hash,assistantGenerating:false,assistantSignals:{}
      }
    });
    let p=await loadProcessForWindow(1);
    for(let i=0;i<8 && p.phase==="WAITING";i++){
      offset+=3000;
      p=await h.mod.tickWaiting(p);
    }
    assert.equal(p.phase,"ANALYZING");
    assert.equal(p.lastResponse.hash,hash);
    assert.equal(reloads.length,0);
    assert.equal(h.sent.length,1);
  } finally {Date.now=realNow;}
});
