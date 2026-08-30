
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href + `?audit=${Date.now()}-${Math.random()}`);

let passed = 0;
const results = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    results.push({name, status:"PASS"});
    console.log(`PASS ${name}`);
  } catch (e) {
    results.push({name, status:"FAIL", error:String(e?.stack || e)});
    console.error(`FAIL ${name}\n${e?.stack || e}`);
  }
}

const common = await imp("lib/common.mjs");
const ui = await imp("lib/ui-contract.mjs");
const mission = await imp("lib/mission-state-machine.mjs");
const cdp = await imp("lib/cdp-session.mjs");
const continuity = await imp("lib/continuity.mjs");
const scoped = await imp("lib/scoped-continuity.mjs");
const loop = await imp("lib/browser-controller-loop.mjs");
const recovery = await imp("lib/browser-recovery.mjs");
const autostart = await imp("lib/autostart-transaction.mjs");
const reload = await imp("lib/reload-lifecycle.mjs");
const capture = await imp("lib/session-capture.mjs");
const browserAction = await imp("lib/browser-action-contract.mjs");
const browserRisk = await imp("lib/browser-risk-policy.mjs");
const sessionReceipts = await imp("lib/session-receipts.mjs");

await test("nullableInteger rejects absence/coercion traps", () => {
  for (const v of [null, undefined, "", " ", false, true, [], {}, "1.5", NaN, Infinity]) {
    assert.equal(common.nullableInteger(v), null, `unexpected integer for ${String(v)}`);
  }
  assert.equal(common.nullableInteger(0), 0);
  assert.equal(common.nullableInteger("12"), 12);
  assert.equal(common.nullableInteger(-1, {min:0}), null);
});

await test("UI command null windowId rejected and numeric string accepted", () => {
  assert.throws(() => ui.createUiCommand({command:"GET_SNAPSHOT", windowId:null}), /WINDOW_ID_INVALID/);
  const c = ui.createUiCommand({command:"GET_SNAPSHOT", windowId:"12"});
  assert.equal(c.windowId, 12);
  assert.throws(() => ui.parseUiCommand({...c, windowId:null}), /WINDOW_ID_INVALID/);
});

await test("mission null windowId remains null", () => {
  assert.equal(mission.createMission({windowId:null}).windowId, null);
  assert.equal(mission.createMission({windowId:"7"}).windowId, 7);
});

await test("CDP null target remains null and cannot match", () => {
  const s = cdp.createCdpSession({profile:"BROWSER", surface:{tabId:null}});
  assert.equal(s.tabId, null);
  assert.equal(cdp.cdpSessionMatchesSurface({...s, state:"ATTACHED"}, {tabId:null}), false);
});

await test("continuity null scope remains null", () => {
  const c = continuity.createContinuity({scopeWindowId:null});
  assert.equal(c.scope.windowId, null);
  assert.equal(scoped.continuityScopeWindowId(c), null);
  assert.equal(scoped.bindContinuityScope(c,{windowId:null}).scope.windowId, null);
  assert.equal(scoped.bindContinuityScope(c,{windowId:"9"}).scope.windowId, 9);
});

await test("browser loop null windowId rejected", () => {
  assert.throws(() => loop.createBrowserLoopState(null), /WINDOW_ID_REQUIRED|WINDOW_ID_INVALID/);
  assert.equal(loop.createBrowserLoopState("8").windowId, 8);
});

await test("browser recovery null windowId rejected", () => {
  assert.throws(() => recovery.createBrowserRecoveryState(null), /WINDOW_ID_REQUIRED|WINDOW_ID_INVALID/);
  assert.equal(recovery.createBrowserRecoveryState("8").windowId, 8);
});

await test("autostart null selected tab fails closed", () => {
  const r = autostart.evaluateAutostartPrecondition({selectedTabId:null, linkedTabs:{}});
  assert.equal(r.ok, false);
  assert.equal(r.reason, "NO_SELECTED_TAB");
});

await test("reload lifecycle null target is rejected", () => {
  assert.throws(() => reload.createReloadReadbackExpectation({
    tabId:null, selectedTabId:null, linkedTab:{tabId:null},
    tab:{id:null,url:"https://chatgpt.com/"}, page:{url:"https://chatgpt.com/",conversationKey:"c",documentEpoch:"e"}
  }), /RELOAD_TARGET_NOT_SELECTED_LINKED/);
});

await test("browser action null tabId rejected", () => {
  assert.throws(() => browserAction.normalizeBrowserAction({
    protocol: browserAction.BROWSER_ACTION_PROTOCOL, schemaVersion:1,
    actionId:"a",turnId:"t",operation:"observe",
    target:{tabId:null,surfaceId:"s",documentEpoch:"e",origin:"https://example.com"},
    expectedEffect:"observe"
  }), /TAB_ID_INVALID/);
});

await test("browser risk isolation does not coerce null tabId to zero", () => {
  const obs = browserRisk.isolateBrowserObservation({
    schema:"x",schemaVersion:1,observationId:"o",observationDigest:"d",
    target:{tabId:null},page:{},elements:[]
  });
  assert.equal(obs.target.tabId, null);
  const approval = browserRisk.normalizeBrowserApproval({target:{tabId:null}});
  assert.ok(approval === null || approval.target?.tabId === null);
});

await test("blank-tab session receipt does not emit tab:0 for missing id", () => {
  const id = sessionReceipts.sessionIdentityFromPage({url:"https://chatgpt.com/",documentEpoch:"e"}, null);
  assert.match(id.value, /#tab:unknown#/);
  assert.doesNotMatch(id.value, /#tab:0#/);
});

await test("repeated identical transcript turns retain occurrence identity", async () => {
  const r = await capture.buildSessionCapture({
    conversationKey:"conversation-A", taskFingerprint:"task", mandateVersion:"m", mandateSha256:"h",
    captureId:"cap-repeat",
    messages:[
      {role:"user",text:"repeat",ordinal:0},
      {role:"user",text:"repeat",ordinal:1}
    ]
  });
  assert.equal(r.turns.length, 2);
  assert.equal(new Set(r.turns.map(x=>x.id)).size, 2);
  assert.equal(r.capture.completeness, "COMPLETE");
});

await test("same long prefix and length with different tail retain both turns", async () => {
  const prefix = "x".repeat(260);
  const a = prefix + "A";
  const b = prefix + "B";
  assert.equal(a.length,b.length);
  const r = await capture.buildSessionCapture({
    conversationKey:"conversation-B", taskFingerprint:"task", mandateVersion:"m", mandateSha256:"h",
    captureId:"cap-prefix",
    messages:[
      {role:"assistant",text:a,ordinal:10},
      {role:"assistant",text:b,ordinal:11}
    ]
  });
  assert.equal(r.turns.length, 2);
  assert.equal(new Set(r.turns.map(x=>x.id)).size, 2);
});

await test("virtualized sweep preserves repeated content at distinct ordinals", async () => {
  let step=0;
  const adapter={
    async getScrollState(){ return {atTop:true,atBottom:step>=1,top:step}; },
    async scrollTo(where){ if(where==="NEXT") step++; },
    async restoreScroll(){},
    async readVisibleMessages(){
      return step===0
        ? [{role:"user",text:"same",ordinal:0},{role:"user",text:"same",ordinal:1}]
        : [{role:"user",text:"same",ordinal:1},{role:"assistant",text:"done",ordinal:2}];
    }
  };
  const r=await capture.sweepVirtualizedTranscript({adapter,maxSweeps:4,stableSweepsRequired:1});
  assert.equal(r.messages.length,3);
  assert.deepEqual(r.messages.map(x=>x.ordinal),[0,1,2]);
});

const bg = fs.readFileSync(path.join(ROOT,"background.js"),"utf8");
const side = fs.readFileSync(path.join(ROOT,"sidepanel.js"),"utf8");
const contracts = fs.readFileSync(path.join(ROOT,"lib/contracts.mjs"),"utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT,"manifest.json"),"utf8"));

await test("no Number.isInteger(Number(...)) coercion pattern remains", () => {
  const files=[];
  function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(/\.(m?js)$/.test(e.name))files.push(p);}}
  walk(ROOT);
  const hits=files.filter(p=>!p.includes(`${path.sep}tests${path.sep}`) && fs.readFileSync(p,"utf8").includes("Number.isInteger(Number("));
  assert.deepEqual(hits,[]);
});

await test("current audit and continuity schemas drive initialization", () => {
  assert.match(contracts,/export const AUDIT_SCHEMA = "eic\.autonom\.audit\.v13"/);
  assert.match(contracts,/export const CONTINUITY_SCHEMA = "eic\.nano\.continuity\.v5"/);
  assert.match(bg,/stores\.audit\?\.schema === AUDIT_SCHEMA/);
  assert.match(bg,/stores\.continuity\?\.schema === CONTINUITY_SCHEMA/);
  assert.doesNotMatch(bg,/eic\.autonom\.audit\.v11/);
  assert.doesNotMatch(bg,/eic\.nano\.continuity\.v4/);
});

await test("initialization is single-flight", () => {
  assert.match(bg,/let initializationPromise = null;/);
  assert.match(bg,/if \(initializationPromise\) return initializationPromise;/);
  assert.match(bg,/initializationPromise = initializeOnce\(\)/);
  assert.match(bg,/finally[\s\S]{0,300}initializationPromise = null;/);
});

await test("writeRuntimeBundle uses strict explicit-window fallback", () => {
  assert.match(bg,/const explicitScopeProvided = explicitWindowId !== undefined/);
  assert.match(bg,/const scopedWindowId = explicitScopeProvided[\s\S]{0,180}continuityScopeWindowId\(continuity\)/);
});

await test("loadBundle observer path has no direct storage set", () => {
  const start=bg.indexOf("async function loadBundle(");
  const end=bg.indexOf("\nasync function ", start+20);
  assert.ok(start>=0 && end>start);
  const body=bg.slice(start,end);
  assert.doesNotMatch(body,/chrome\.storage\.local\.set/);
});

await test("import and rollback use single runtime/config commit path", () => {
  const importStart=bg.indexOf("async function importState(");
  const rollbackStart=bg.indexOf("async function rollbackImportedState(");
  const nextAfterRollback=bg.indexOf("\nasync function ", rollbackStart+20);
  const importBody=bg.slice(importStart,rollbackStart);
  const rollbackBody=bg.slice(rollbackStart,nextAfterRollback);
  assert.doesNotMatch(importBody,/chrome\.storage\.local\.set\(\{\s*\[STORAGE_KEYS\.CONFIG\]/);
  assert.doesNotMatch(rollbackBody,/chrome\.storage\.local\.set\(\{\s*\[STORAGE_KEYS\.CONFIG\]/);
  assert.match(importBody,/writeRuntimeBundle\([\s\S]*STORAGE_KEYS\.CONFIG/);
  assert.match(rollbackBody,/writeRuntimeBundle\([\s\S]*STORAGE_KEYS\.CONFIG/);
});

await test("CDP attach has durable reconcile and compensation", () => {
  assert.match(bg,/CDP_ATTACH_PERSIST_FAILED_DETACHED/);
  assert.match(bg,/CDP_ATTACH_PERSIST_FAILED_COMPENSATION_FAILED/);
  assert.match(bg,/existing\?\.state === CDP_SESSION_STATES\.ATTACHED[\s\S]{0,1000}writeRuntimeBundle/);
});

await test("PAUSE STOP cancellation is signalled before queue acquisition", () => {
  const s=bg.indexOf("async function controlRun(");
  const e=bg.indexOf("\nasync function ",s+20);
  const body=bg.slice(s,e);
  const cancel=body.indexOf("signalAutomaticCaptureCancellation");
  const enqueue=body.indexOf("return enqueue");
  assert.ok(cancel>=0 && enqueue>=0 && cancel<enqueue, `cancel=${cancel} enqueue=${enqueue}`);
  assert.match(bg,/const sessionCaptureInFlight = new Map\(\)/);
});

await test("auto capture in-flight cleanup covers STARTED guard persistence", () => {
  const s=bg.indexOf("function scheduleBackgroundAutoSessionCapture(");
  const e=bg.indexOf("\nasync function prepareBackgroundAutoCapture",s+20) > s
    ? bg.indexOf("\nasync function prepareBackgroundAutoCapture",s+20)
    : bg.indexOf("\nasync function tickWindow",s+20);
  const body=bg.slice(s,e > s ? e : s + 6000);
  const setPos=body.indexOf("autoCaptureInFlight.set");
  const tryPos=body.indexOf("try {",setPos);
  const startPersist=body.indexOf('status: "STARTED"',setPos);
  const finallyPos=body.indexOf("finally", startPersist);
  const deletePos=body.indexOf("autoCaptureInFlight.delete", finallyPos);
  assert.ok(setPos>=0 && tryPos>setPos && startPersist>tryPos && finallyPos>startPersist && deletePos>finallyPos);
});

await test("session capture commits runtime before global pointer mirror", () => {
  const s=bg.indexOf("async function captureSessionContext(");
  const e=bg.indexOf("\nasync function requestCoreSurfaceReview",s+20);
  const body=bg.slice(s,e);
  const commit=body.lastIndexOf("await writeRuntimeBundle");
  const mirror=body.indexOf("[SESSION_DB_POINTER_KEYS.ACTIVE_CAPTURE_ID]",commit);
  assert.ok(commit>=0 && mirror>commit, `commit=${commit} mirror=${mirror}`);
  assert.match(body,/context\.sessionCaptureSummary\?\.captureId/);
  assert.match(body,/context\.sessionMemorySummary\?\.memoryId/);
});

await test("sidepanel stale refresh responses are sequence-gated", () => {
  assert.match(side,/refreshSequence/);
  assert.match(side,/refreshAppliedSequence/);
  assert.match(side,/if \(refreshSequence >= state\.refreshAppliedSequence\)/);
});

await test("audit and application logs have dedicated serializers", () => {
  assert.match(bg,/let applicationLogPersistenceQueue = Promise\.resolve\(\)/);
  assert.match(bg,/let fullAuditPersistenceQueue = Promise\.resolve\(\)/);
  assert.match(bg,/serializeApplicationLogPersistence/);
  assert.match(bg,/serializeFullAuditPersistence/);
});

await test("window removal does not create window context before existence check", () => {
  const s=bg.indexOf("chrome.windows.onRemoved.addListener");
  const e=bg.indexOf("\n});",s)+4;
  const body=bg.slice(s,e);
  assert.match(body,/await loadBundle\(\)/);
  assert.match(body,/runtime\.windows\[String\(windowId\)\]/);
  assert.doesNotMatch(body,/loadBundle\(windowId\)/);
  assert.match(body,/writeRuntimeBundle\(runtime, rootContinuity, audit, null\)/);
});

await test("release identity is current across manifest/contracts/content", () => {
  assert.equal(manifest.version,"0.12.14");
  assert.match(contracts,/APP_VERSION = "0\.12\.14"/);
  const content=fs.readFileSync(path.join(ROOT,"content.js"),"utf8");
  assert.match(content,/VERSION = "0\.12\.14"/);
});

console.log(JSON.stringify({total:results.length,passed,failed:results.length-passed,results},null,2));
if (passed !== results.length) process.exit(1);
