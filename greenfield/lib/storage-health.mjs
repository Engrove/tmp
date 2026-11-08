import { readStorage } from "./storage-read.mjs";
export async function storageHealth(area=chrome.storage.local) {
  if(typeof area.getBytesInUse!=="function")return {known:false,bytes:null,limitBytes:null,ratio:null};
  const bytes=await readStorage({ get: keys => area.getBytesInUse(keys) }, null),limitBytes=Number(area.QUOTA_BYTES||10*1024*1024);
  return {known:true,bytes,limitBytes,ratio:bytes/limitBytes};
}
