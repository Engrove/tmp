import { deepClone, nowIso, sanitizeText } from "./common.mjs";

export const SESSION_DB_SCHEMA = "eic.autonom.session-db.v1";
export const SESSION_DB_NAME = "eic-autonom-agent-v0.10.1";
export const SESSION_DB_VERSION = 1;
export const SESSION_DB_STORES = Object.freeze([
  "captures",
  "turns",
  "sections",
  "sectionSummaries",
  "sessionMemories",
  "operatorActions",
  "metadata"
]);

export const SESSION_DB_POINTER_KEYS = Object.freeze({
  ACTIVE_CAPTURE_ID: "eicAutonomAgent.v10.activeCaptureId",
  ACTIVE_MEMORY_ID: "eicAutonomAgent.v10.activeSessionMemoryId",
  READINESS: "eicAutonomAgent.v10.sessionContextReadiness"
});

const SECRET_KEYS = /(?:token|secret|cookie|authorization|credential|signed[_-]?url|session[_-]?locator|lock[_-]?token|confirmation[_-]?token)/i;

function redacted(value, seen = new WeakSet()) {
  if (value == null || typeof value !== "object") return value;
  if (seen.has(value)) return "[CYCLE]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redacted(item, seen));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SECRET_KEYS.test(key) ? "[REDACTED]" : redacted(item, seen);
  }
  return out;
}

export function redactSessionRecord(value) {
  return redacted(deepClone(value));
}

export function sessionDbPlan() {
  return {
    schema: SESSION_DB_SCHEMA,
    name: SESSION_DB_NAME,
    version: SESSION_DB_VERSION,
    stores: [...SESSION_DB_STORES],
    currentOnly: true,
    upgradeBehavior: "RESET_TO_EMPTY_V1"
  };
}

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("INDEXEDDB_REQUEST_FAILED"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("INDEXEDDB_TRANSACTION_ABORTED"));
    transaction.onerror = () => reject(transaction.error || new Error("INDEXEDDB_TRANSACTION_FAILED"));
  });
}

function mapDbError(error) {
  if (error?.name === "QuotaExceededError") {
    const mapped = new Error("SESSION_DB_QUOTA_EXCEEDED");
    mapped.cause = error;
    return mapped;
  }
  if (error?.name === "VersionError") {
    const mapped = new Error("SESSION_DB_VERSION_CONFLICT");
    mapped.cause = error;
    return mapped;
  }
  const mapped = new Error(`SESSION_DB_FAILURE:${error?.name || "UNKNOWN"}`);
  mapped.cause = error;
  return mapped;
}

export async function openSessionDatabase(indexedDbFactory = globalThis.indexedDB) {
  if (!indexedDbFactory?.open) throw new Error("INDEXEDDB_UNAVAILABLE");
  let request;
  try {
    request = indexedDbFactory.open(SESSION_DB_NAME, SESSION_DB_VERSION);
  } catch (error) {
    throw mapDbError(error);
  }
  request.onupgradeneeded = () => {
    const db = request.result;
    for (const existing of [...db.objectStoreNames]) db.deleteObjectStore(existing);
    for (const store of SESSION_DB_STORES) {
      const objectStore = db.createObjectStore(store, { keyPath: "id" });
      if (["captures", "turns", "sections", "sectionSummaries", "sessionMemories", "operatorActions"].includes(store)) {
        objectStore.createIndex("conversationKey", "conversationKey", { unique: false });
        objectStore.createIndex("projectId", "projectId", { unique: false });
        objectStore.createIndex("taskFingerprint", "taskFingerprint", { unique: false });
        objectStore.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      if (store === "turns") objectStore.createIndex("captureId", "captureId", { unique: false });
      if (store === "sections") objectStore.createIndex("captureId", "captureId", { unique: false });
    }
  };
  try {
    const db = await requestPromise(request);
    return new SessionDatabase(db);
  } catch (error) {
    throw mapDbError(error);
  }
}

export class SessionDatabase {
  constructor(db) {
    this.db = db;
  }

  close() {
    this.db?.close?.();
  }

  async put(store, record) {
    if (!SESSION_DB_STORES.includes(store)) throw new Error("SESSION_DB_STORE_UNKNOWN");
    const value = redactSessionRecord(record);
    if (!sanitizeText(value?.id, 300)) throw new Error("SESSION_DB_RECORD_ID_REQUIRED");
    value.updatedAt ||= nowIso();
    const tx = this.db.transaction([store], "readwrite");
    try {
      tx.objectStore(store).put(value);
      await transactionDone(tx);
      const readback = await this.get(store, value.id);
      if (!readback || readback.id !== value.id) throw new Error("SESSION_DB_READBACK_FAILED");
      return readback;
    } catch (error) {
      throw mapDbError(error);
    }
  }

  async get(store, id) {
    if (!SESSION_DB_STORES.includes(store)) throw new Error("SESSION_DB_STORE_UNKNOWN");
    const tx = this.db.transaction([store], "readonly");
    try {
      const result = await requestPromise(tx.objectStore(store).get(String(id)));
      await transactionDone(tx);
      return result ? deepClone(result) : null;
    } catch (error) {
      throw mapDbError(error);
    }
  }

  async delete(store, id) {
    if (!SESSION_DB_STORES.includes(store)) throw new Error("SESSION_DB_STORE_UNKNOWN");
    const tx = this.db.transaction([store], "readwrite");
    try {
      tx.objectStore(store).delete(String(id));
      await transactionDone(tx);
      return (await this.get(store, id)) == null;
    } catch (error) {
      throw mapDbError(error);
    }
  }

  async list(store, { index = null, query = null, limit = 500 } = {}) {
    if (!SESSION_DB_STORES.includes(store)) throw new Error("SESSION_DB_STORE_UNKNOWN");
    const tx = this.db.transaction([store], "readonly");
    const source = index ? tx.objectStore(store).index(index) : tx.objectStore(store);
    const out = [];
    await new Promise((resolve, reject) => {
      const request = source.openCursor(query);
      request.onerror = () => reject(request.error || new Error("INDEXEDDB_CURSOR_FAILED"));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || out.length >= Math.max(1, Math.min(5000, Number(limit) || 500))) {
          resolve();
          return;
        }
        out.push(deepClone(cursor.value));
        cursor.continue();
      };
    });
    await transactionDone(tx);
    return out;
  }

  async purge({ conversationKey = null, olderThan = null } = {}) {
    let deleted = 0;
    for (const store of SESSION_DB_STORES) {
      const records = await this.list(store, { limit: 5000 });
      for (const record of records) {
        const matchesConversation = !conversationKey || record.conversationKey === conversationKey;
        const matchesAge = !olderThan || Date.parse(record.updatedAt || record.createdAt || 0) < Date.parse(olderThan);
        if (matchesConversation && matchesAge && await this.delete(store, record.id)) deleted += 1;
      }
    }
    return { deleted };
  }
}
