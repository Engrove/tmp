import { sha256Hex } from './common.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { readCheckpoint, writeCheckpoint, storageLock } from './durable-checkpoint.mjs';
export const RECOVERY_NOTICES_KEY = 'eic.gf.recovery-notices.v1';
export async function recoveryNoticeId(row) {
  const {atMs,noticeId,acknowledged,...identity} = row;
  return sha256Hex(canonicalJson(identity));
}
export async function recoveryNoticeView(report, storage) {
  const record = await readCheckpoint(RECOVERY_NOTICES_KEY, storage);
  if (record.health === 'RECOVERY_REQUIRED') throw new Error('RECOVERY_NOTICE_STORAGE_UNRECONCILED');
  const acknowledged = new Set((record.value?.acknowledged || []).map(r=>r.id));
  const unresolved = await Promise.all((report.unresolved || []).map(async row => {
    const noticeId = await recoveryNoticeId(row);
    return {...row,noticeId,acknowledged:acknowledged.has(noticeId)};
  }));
  return {...report,unresolved,noticeCount:new Set(unresolved.filter(r=>!r.acknowledged).map(r=>r.workerId)).size};
}
export async function acknowledgeRecoveryNotices(report, ids, storage) {
  return storageLock(storage,RECOVERY_NOTICES_KEY+':ack',async()=>{
    const view = await recoveryNoticeView(report,storage), allowed = new Set(view.unresolved.map(r=>r.noticeId));
    if (!Array.isArray(ids) || !ids.length || ids.some(id=>!allowed.has(id))) throw new Error('RECOVERY_NOTICE_STALE');
    const prior = (await readCheckpoint(RECOVERY_NOTICES_KEY,storage)).value?.acknowledged || [];
    const wanted = new Set(ids);
    const acknowledged = [...prior.filter(r=>!wanted.has(r.id)),...ids.map(id=>({id,atMs:Date.now()}))].slice(-200);
    await writeCheckpoint(RECOVERY_NOTICES_KEY,{schema:'eic.greenfield.recovery-notices.v1',acknowledged},storage);
    return recoveryNoticeView(report,storage);
  });
}
