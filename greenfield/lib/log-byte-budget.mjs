// Wire-format UTF-8 budgets, excluding browser/IndexedDB index and page overhead.
export const MAX_LOG_BYTES = 10_000_000;
const encoder = new TextEncoder();
export function serializedUtf8Bytes(value) { return encoder.encode(JSON.stringify(value)).length; }
export function fifoRowsByBytes(rows, maxBytes = MAX_LOG_BYTES) {
  const list = Array.isArray(rows) ? rows : [];
  let bytes = list.reduce((sum, row) => sum + serializedUtf8Bytes(row) + 1, 0);
  let start = 0;
  while (start < list.length && bytes > maxBytes) {
    bytes -= serializedUtf8Bytes(list[start]) + 1;
    start++;
  }
  return { rows:list.slice(start), dropped:start, bytes };
}
