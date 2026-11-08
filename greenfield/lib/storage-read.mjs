import { unpackStorageRows } from './storage-codec.mjs';
// Local wait budgets, not Chrome guarantees. Read timeouts do not cancel the
// platform request, but a late read cannot mutate storage or resume its caller.
export const STORAGE_READ_WAIT_MS = 5000;
export function readStorage(storage, keys, { timeoutMs = STORAGE_READ_WAIT_MS, decode = true } = {}) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("STORAGE_READ_TIMEOUT"), {
      code: "STORAGE_READ_TIMEOUT", effectPossible: false
    })), timeoutMs);
  });
  return Promise.race([Promise.resolve().then(() => storage.get(keys)).then(rows => decode ? unpackStorageRows(rows) : rows), deadline])
    .finally(() => clearTimeout(timer));
}
