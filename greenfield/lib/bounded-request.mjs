// Bound connection, headers, body and cleanup by one elapsed-time budget.
// A timeout never proves a remote mutation did not happen. Callers may retry
// read-only queries; mutations require their original idempotency receipt.
export async function boundedJsonRequest(url, options = {}, {
  fetchImpl = fetch, timeoutMs = 10_000, maxBytes = 32_768, readBody = true
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new Error('REQUEST_BUDGET_INVALID');
  const controller = new AbortController();
  let expired = false, timer, reader;
  const timeout = new Promise((_,reject) => {
    timer = setTimeout(() => {
      expired = true; controller.abort();
      reject(Object.assign(new Error('REQUEST_TIMEOUT'), {code:'REQUEST_TIMEOUT',effectPossible:options.method !== 'GET'}));
      if (reader) void reader.cancel().catch(()=>{});
    },timeoutMs);
  });
  const operation = (async()=>{
    const response = await fetchImpl(url,{...options,signal:controller.signal});
    if (expired) { void response.body?.cancel().catch(()=>{}); throw new Error('REQUEST_TIMEOUT'); }
    const result = {ok:response.ok,status:response.status,body:null};
    if (!readBody || !response.ok || response.status === 204) {
      void response.body?.cancel().catch(()=>{}); return result;
    }
    if (!/application\/json/i.test(response.headers.get('content-type') || '')) throw new Error('REQUEST_CONTENT_TYPE');
    reader = response.body?.getReader();
    if (!reader) throw new Error('REQUEST_BODY_UNAVAILABLE');
    const parts = []; let bytes = 0;
    while (true) {
      const {done,value} = await reader.read();
      if (expired) throw new Error('REQUEST_TIMEOUT');
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('REQUEST_BODY_TOO_LARGE');
      parts.push(value);
    }
    const data = new Uint8Array(bytes); let offset = 0;
    for (const part of parts) { data.set(part,offset); offset += part.length; }
    return {...result,body:JSON.parse(new TextDecoder().decode(data))};
  })();
  try { return await Promise.race([operation,timeout]); }
  finally { clearTimeout(timer); if (reader) void reader.cancel().catch(()=>{}); controller.abort(); }
}
