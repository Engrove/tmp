import {usageIdentity} from '../../lib/usage-governor.mjs';
// Synthetic historical send receipt for lifecycle tests. Every field required
// by the production gate is populated; this does not mock the gate's verdict.
export function attachDispatchReceipt(process, {now=Date.now()-120000}={}) {
  const prompt=process.lastPrompt;
  prompt.usageId=usageIdentity(process,prompt);
  prompt.conversationKey ||= process.lastManagedUrl;
  prompt.dispatchId ||= 'fixture-dispatch';
  prompt.modelProof={allowed:true,code:'UI_MODEL_COMPATIBLE',effort:'Extra hög',currentReceiptValid:true,
    highestEffortVerified:true,observedAtMs:now,receiptExpiresAtMs:now+59000,
    promptHash:prompt.hash,usageId:prompt.usageId,
    highestEffort:{status:'VERIFIED',label:'Extra hög',strategy:'ORDINAL_TARGET',verifiedAtMs:now-1000,url:prompt.conversationKey}};
  process.safety={...process.safety,turnProof:structuredClone(prompt.modelProof)};
  return process;
}
