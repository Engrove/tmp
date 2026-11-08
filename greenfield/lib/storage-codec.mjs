import { sha256Hex } from './common.mjs';

// Physical representation only: consumers still receive the original JSON.
// Primary and independent WAL copies remain independently recoverable.
export const PACKED_STORAGE_SCHEMA = 'eic.gf.storage-packed.v1';
export const STORAGE_PACK_MIN_BYTES = 32768;
export const STORAGE_PACK_MAX_BYTES = 64 * 1024 * 1024;
let packingEnabled = true;
export function disableStoragePacking() { packingEnabled = false; }
export const isPackedStorageValue = value => value?.schema === PACKED_STORAGE_SCHEMA;
export function packableStorageKey(key) {
  const logical = String(key).replace(/^eic\.gf\.checkpoint\./,'').replace(/\.[01]$/,'');
  return /^(eic\.gf\.(process\.worker\.|mission-work-queue\.worker\.|mission-history\.v1\.|unsent-draft-archive\.v1\.|session-start-archive\.v1\.))/.test(logical) || logical === 'eic.gf.safety.v1';
}
function fail(code) { return Object.assign(new Error(code),{code}); }
async function collect(stream, maxBytes) {
  const reader=stream.getReader(),chunks=[];let size=0;
  try {
    while(true) {
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>maxBytes)throw fail('STORAGE_PACK_SIZE_EXCEEDED');
      chunks.push(value);
    }
  } catch(error) { void reader.cancel().catch(()=>{});throw error; }
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}return bytes;
}
function base64(bytes) {
  let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(text);
}
export async function packStorageValue(key,value) {
  if(!packingEnabled || !packableStorageKey(key) || isPackedStorageValue(value) || value==null || typeof value!=='object' ||
      typeof CompressionStream!=='function' || typeof DecompressionStream!=='function')return value;
  const text=JSON.stringify(value),bytes=new TextEncoder().encode(text);
  if(bytes.length<STORAGE_PACK_MIN_BYTES || bytes.length>STORAGE_PACK_MAX_BYTES)return value;
  const compressed=await collect(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')),STORAGE_PACK_MAX_BYTES);
  const packed={schema:PACKED_STORAGE_SCHEMA,codec:'GZIP_JSON_UTF8_V1',key,originalBytes:bytes.length,sha256:await sha256Hex(text),data:base64(compressed)};
  return new TextEncoder().encode(JSON.stringify(packed)).length < bytes.length * 0.85 ? packed : value;
}
export async function unpackStorageValue(key,value) {
  if(!isPackedStorageValue(value))return value;
  if(value.key!==key || value.codec!=='GZIP_JSON_UTF8_V1' || !Number.isSafeInteger(value.originalBytes) ||
      value.originalBytes<1 || value.originalBytes>STORAGE_PACK_MAX_BYTES || typeof value.data!=='string' ||
      value.data.length>STORAGE_PACK_MAX_BYTES*2 || !/^[a-f0-9]{64}$/.test(value.sha256 || ''))throw fail('STORAGE_PACK_HEADER_INVALID');
  if(typeof DecompressionStream!=='function')throw fail('STORAGE_PACK_CODEC_UNAVAILABLE');
  let bytes;
  try {
    const compressed=Uint8Array.from(atob(value.data),c=>c.charCodeAt(0));
    bytes=await collect(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),value.originalBytes);
  } catch { throw fail('STORAGE_PACK_DATA_INVALID'); }
  if(bytes.length!==value.originalBytes)throw fail('STORAGE_PACK_LENGTH_MISMATCH');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(await sha256Hex(text)!==value.sha256)throw fail('STORAGE_PACK_CHECKSUM_MISMATCH');
  const decoded=JSON.parse(text);
  if(!decoded || typeof decoded!=='object' || isPackedStorageValue(decoded))throw fail('STORAGE_PACK_VALUE_INVALID');
  return decoded;
}
export async function unpackStorageRows(rows) {
  if(!rows || typeof rows!=='object' || Array.isArray(rows))return rows;
  return Object.fromEntries(await Promise.all(Object.entries(rows).map(async([key,value])=>[key,await unpackStorageValue(key,value)])));
}
