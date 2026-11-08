import {sha256Hex} from '../../lib/common.mjs';
import {createProcess} from '../../lib/state.mjs';
const gptRoot='https://chatgpt.com/g/g-test',conversationKey='https://chatgpt.com/c/settled';
export async function settledRotationFixture(){
 const binding={initializationId:'init-1',processId:'source',workerId:'worker',runId:'run',sessionSeq:2,queueId:'queue',itemId:'item',savedMissionId:'mission',workPromptHash:'a'.repeat(64)};
 const ackHash=await sha256Hex(JSON.stringify(binding));
 const a2a={messageId:'init-1',messageType:'SESSION_INITIALIZATION',instruction:'Initialize, acknowledge '+ackHash};
 const text=JSON.stringify(a2a),hash=await sha256Hex(text);
 const source={...createProcess({workerId:'worker',windowId:2,tabId:1,goal:'Mission',initialPrompt:'Continue safely'}),processId:'source',workerId:'worker',runId:'run',tabId:1,windowId:2,gptRoot,phase:'ROTATING',sessionSeq:3,
  sessionInitialization:{status:'READY',initializationId:'init-1',sessionSeq:2,createdAt:'2026-11-03T20:00:00Z',completedAt:'2026-11-03T20:01:00Z',conversationKey,
   acknowledgement:{schema:'eic.greenfield.initialization-ack.v1',hash:ackHash,binding},
   receipt:{text,hash,a2a,transportKind:'SESSION_INITIALIZATION',transportId:'init-1',acknowledged:true,dispatchId:'dispatch',dispatchedUserTurnId:'init-turn',conversationKey,postedAtMs:Date.parse('2026-11-03T20:00:10Z')},response:{messageId:'init-response',hash:'b'.repeat(64)}}};
 const promptText='work done',responseText='completed checkpoint';
 const target={...structuredClone(source),pendingPrompt:{text:'next work',hash:await sha256Hex('next work'),sendAttempts:0,dispatch:null},
  lastPrompt:{text:promptText,hash:await sha256Hex(promptText),acknowledged:true,dispatchedUserTurnId:'work-turn',conversationKey},
  lastResponse:{text:responseText,hash:await sha256Hex(responseText),messageId:'work-reply',contract:{ok:true},observation:{ownerTrusted:true,causalMatch:true,messageId:'work-reply',expectedUserTurnId:'work-turn',pairedUserTurnId:'work-turn',conversationKey}},
  sessionRotation:{rotationId:'rotation',state:'NAVIGATING',queueSwitch:true,targetTabId:1,sourceResponseState:'COMPLETED_RESPONSE_CHECKPOINTED',hardReloadState:'COMPLETED',hardReloadBeforeResume:true}};
 const page={url:gptRoot,documentId:'doc',userCount:0,generating:false,composerReady:true,composerEmpty:false,composerTextHash:hash};
 return {source,target,page,text,hash};
}
