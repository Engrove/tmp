import { loadPersistedProcessInventory, saveProcess } from "./process-store.mjs";
import { getWorkerBinding, restoreWorkerBinding } from "./worker-identity.mjs";
import { loadMissionWorkQueue, saveMissionWorkQueue } from "./mission-work-queue.mjs";
import { customGptRoot } from "./managed-eic-surface.mjs";
import { TERMINAL_PHASES, PHASES } from "./contracts.mjs";
import { CHECKPOINT_PREFIX, readCheckpoint } from "./durable-checkpoint.mjs";
import { autonomousUserTurnProof, expectedAutonomousUserTurn } from "./turn-causality.mjs";

export function conversationKey(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || !["chatgpt.com","chat.openai.com"].includes(u.hostname)) return "";
    const id = u.pathname.match(/\/c\/([a-z0-9-]+)(?:\/|$)/i)?.[1];
    return id ? `${u.origin}/c/${id}` : "";
  } catch { return ""; }
}
export function recoveryProof(process, page, tab) {
  const identity = conversationKey(process.lastManagedUrl);
  if (!identity || identity !== conversationKey(tab.url) || identity !== conversationKey(page.url)) {
    return {ok:false,code:"CONVERSATION_IDENTITY_UNPROVEN"};
  }
  if (process.storageRecoveryRequired) {
    return {ok:false,code:"STORAGE_RECOVERY_REQUIRES_REVIEW"};
  }

  const turnProof = autonomousUserTurnProof(process, page);
  if (!turnProof.ok) {
    return {ok:false,code:"RECOVERY_USER_TURN_UNPROVEN",detail:turnProof.code};
  }
  return {
    ok:true,
    code:turnProof.code === "LEGACY_USER_TEXT_HASH_MATCH"
      ? "CONVERSATION_AND_USER_HASH_MATCH"
      : "CONVERSATION_AND_USER_TURN_MATCH",
    turnProof:turnProof.code
  };
}

export async function reconcileRestart({ local, session, tabs, ensureBridge }) {
  const inventory = await loadPersistedProcessInventory(local);
  const report = { atMs:Date.now(), restored:[], unresolved:[], errors:inventory.errors };
  // Queues created before the first process must not disappear from the
  // operator's recovery picture when volatile bindings are lost.
  const queuePrefix="eic.gf.mission-work-queue.worker.";
  const stored=await local.get(null);
  const queueKeys=new Set(Object.keys(stored).map(k=>k.startsWith(CHECKPOINT_PREFIX)?k.slice(CHECKPOINT_PREFIX.length).replace(/\.[01]$/,""):k).filter(k=>k.startsWith(queuePrefix)));
  const owned=new Set(inventory.processes.map(p=>p.workerId));
  for(const key of queueKeys) if(!owned.has(key.slice(queuePrefix.length))) {
    try {
      const record=await readCheckpoint(key,local),q=record.value;
      if(record.health==="RECOVERY_REQUIRED")throw Error("CHECKPOINT_RECONCILIATION_REQUIRED:"+key);
      if(q?.items?.length && (await getWorkerBinding(q.windowId,session))?.workerId!==q.workerId) report.unresolved.push({workerId:q.workerId,goal:q.items[0].label || q.items[0].goal,queueItems:q.items.length,code:"QUEUE_WITHOUT_PROVEN_CONVERSATION"});
    }catch(error){report.errors.push({key,code:String(error.message)});}
  }
  const liveTabs = await tabs.query({});
  const keys = new Map();
  for (const p of inventory.processes) {
    const key = conversationKey(p.lastManagedUrl);
    if (key && !TERMINAL_PHASES.has(p.phase)) keys.set(key,(keys.get(key)||0)+1);
  }
  for (const original of inventory.processes) {
    let queue;
    try { queue = await loadMissionWorkQueue(original.windowId,local,{workerId:original.workerId}); }
    catch (error) { report.errors.push({key:original.workerId,code:error.message}); continue; }
    if (TERMINAL_PHASES.has(original.phase) && !queue.enabled) continue;
    const currentBinding = await getWorkerBinding(original.windowId,session);
    if (currentBinding?.workerId === original.workerId && liveTabs.some(t=>t.id===original.tabId && t.windowId===original.windowId)) continue;
    let key = conversationKey(original.lastManagedUrl);
    let candidates = key ? liveTabs.filter(t => conversationKey(t.url) === key) : [];
    let legacyObservation = null;
    if (!key && original.gptRoot) {
      // v1.5.3 did not persist the conversation URL. Its A2A prompt contains
      // unique process/run identity; prefer persisted autonomous turn identity/ordinal
      // and use the exact stored prompt hash only as a legacy fallback. Never guess by window number.
      const expectedHash=original.pendingPrompt?.dispatch && original.pendingPrompt.dispatch.effectPossible!==false ? original.pendingPrompt.hash : original.lastPrompt?.hash;
      const expectedTurn=expectedAutonomousUserTurn(original);
      const sameRoot=liveTabs.filter(t=>customGptRoot(t.url)===customGptRoot(original.gptRoot) && conversationKey(t.url));
      const proven=[];
      if ((expectedHash || expectedTurn.id || Number.isInteger(expectedTurn.index)) && sameRoot.length<=16) for (const candidate of sameRoot) {
        try {
          await ensureBridge(candidate.id);
          const observed=await tabs.sendMessage(candidate.id,{
            type:"EIC_GF_GET_PAGE_STATE",
            expectedUserTurnId:expectedTurn.id,
            expectedUserIndex:expectedTurn.index
          });
          const turnProof=observed?.ok ? autonomousUserTurnProof(original,observed.state) : {ok:false};
          if (observed?.ok && conversationKey(observed.state?.url)===conversationKey(candidate.url) && turnProof.ok) {
            proven.push({tab:candidate,page:observed.state});
          }
        } catch {}
      }
      if (proven.length===1 && !(keys.get(conversationKey(proven[0].tab.url))>0)) {
        candidates=[proven[0].tab];legacyObservation=proven[0].page;
        key=conversationKey(proven[0].tab.url);original.lastManagedUrl=proven[0].page.url;keys.set(key,1);
      }
    }
    const row = {workerId:original.workerId,processId:original.processId,goal:String(original.goal||"").slice(0,220),phase:original.phase,conversationUrl:original.lastManagedUrl || "", queueItems:queue.items.length};
    if (!key || candidates.length !== 1 || (keys.get(key)||0)>1) {
      report.unresolved.push({...row,code:!key ? "NO_DURABLE_CONVERSATION_ID" : candidates.length===0 ? "CONVERSATION_TAB_NOT_RESTORED" : "AMBIGUOUS_CONVERSATION"});
      continue;
    }
    const tab = candidates[0];
    try {
      await ensureBridge(tab.id);
      const expectedTurn = expectedAutonomousUserTurn(original);
      const observed = legacyObservation ? {ok:true,state:legacyObservation} : await tabs.sendMessage(tab.id,{
        type:"EIC_GF_GET_PAGE_STATE",
        expectedUserTurnId:expectedTurn.id,
        expectedUserIndex:expectedTurn.index
      });
      if (!observed?.ok) throw new Error("RECOVERY_PAGE_UNAVAILABLE");
      const proof = recoveryProof(original,observed.state,tab);
      if (!proof.ok) throw new Error(proof.code);
      await restoreWorkerBinding(tab.windowId,original.workerId,session);
      const process = {...original,windowId:tab.windowId,tabId:tab.id,generation:original.generation+1,updatedAt:new Date().toISOString(),
        restartRecovery:{atMs:Date.now(),code:proof.code,legacyHashMigration:Boolean(legacyObservation),priorWindowId:original.windowId,priorTabId:original.tabId}};
      if (process.phase === PHASES.DETACHED && process.detached?.recoverTo) process.phase=process.detached.recoverTo;
      process.detached = null;
      queue.windowId = tab.windowId;
      // Process publication is last; any failure leaves the worker discoverable
      // in the next startup inventory, never silently replaced by a new worker.
      await saveMissionWorkQueue(queue,local);
      await saveProcess(process,local,session);
      report.restored.push({...row,windowId:tab.windowId,tabId:tab.id,code:proof.code});
    } catch (error) { report.unresolved.push({...row,code:String(error.message)}); }
  }
  return report;
}
