(() => {
  'use strict';

  const DB_NAME = 'chatgpt_session_capture_v1';
  const DB_VERSION = 1;
  const SESSIONS = 'sessions';
  const RECORDS = 'records';

  // One connection per context is reused for all operations; opening a new
  // connection for every record was the dominant cost during a sweep.
  let connection = null;

  function open() {
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SESSIONS)) {
          const sessions = db.createObjectStore(SESSIONS, { keyPath: 'id' });
          sessions.createIndex('tabId', 'tabId', { unique: false });
          sessions.createIndex('startedAt', 'startedAt', { unique: false });
          sessions.createIndex('status', 'status', { unique: false });
        }
        if (!db.objectStoreNames.contains(RECORDS)) {
          const records = db.createObjectStore(RECORDS, { keyPath: 'id' });
          records.createIndex('sessionId', 'sessionId', { unique: false });
          records.createIndex('sessionKind', ['sessionId', 'kind'], { unique: false });
          records.createIndex('capturedAt', 'capturedAt', { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          connection = null;
        };
        db.onclose = () => {
          connection = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        connection = null;
        reject(request.error);
      };
    });
    return connection;
  }

  // Runs an operation on the shared connection and retries once on a
  // connection that was closed underneath it.
  async function withDb(operation) {
    for (let attempt = 0; ; attempt += 1) {
      const db = await open();
      try {
        return await operation(db);
      } catch (error) {
        if (attempt === 0 && error?.name === 'InvalidStateError') {
          connection = null;
          continue;
        }
        throw error;
      }
    }
  }

  function requestAsPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transactionDone(tx, label) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error(`${label} transaction aborted`));
    });
  }

  async function putSession(session) {
    return withDb(async (db) => {
      const tx = db.transaction(SESSIONS, 'readwrite');
      tx.objectStore(SESSIONS).put(session);
      await transactionDone(tx, 'Session');
      return session;
    });
  }

  async function getSession(id) {
    return withDb((db) => requestAsPromise(db.transaction(SESSIONS, 'readonly').objectStore(SESSIONS).get(id)));
  }

  async function getLatestSessionForTab(tabId) {
    const all = await withDb((db) => requestAsPromise(
      db.transaction(SESSIONS, 'readonly').objectStore(SESSIONS).index('tabId').getAll(IDBKeyRange.only(tabId))
    ));
    all.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    return all[0] || null;
  }

  async function listSessions() {
    const all = await withDb((db) => requestAsPromise(db.transaction(SESSIONS, 'readonly').objectStore(SESSIONS).getAll()));
    return all.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  }

  async function putRecord(record) {
    return withDb(async (db) => {
      const tx = db.transaction(RECORDS, 'readwrite');
      tx.objectStore(RECORDS).put(record);
      await transactionDone(tx, 'Record');
      return record;
    });
  }

  async function getRecord(id) {
    return withDb((db) => requestAsPromise(db.transaction(RECORDS, 'readonly').objectStore(RECORDS).get(id)));
  }

  async function getRecords(sessionId, kind = null) {
    const records = await withDb((db) => {
      const store = db.transaction(RECORDS, 'readonly').objectStore(RECORDS);
      return requestAsPromise(kind
        ? store.index('sessionKind').getAll(IDBKeyRange.only([sessionId, kind]))
        : store.index('sessionId').getAll(IDBKeyRange.only(sessionId)));
    });
    return records.sort((a, b) => (a.capturedAt || 0) - (b.capturedAt || 0));
  }

  async function countRecords(sessionId) {
    return withDb((db) => requestAsPromise(
      db.transaction(RECORDS, 'readonly').objectStore(RECORDS).index('sessionId').count(IDBKeyRange.only(sessionId))
    ));
  }

  async function deleteSession(id) {
    return withDb(async (db) => {
      const tx = db.transaction([SESSIONS, RECORDS], 'readwrite');
      tx.objectStore(SESSIONS).delete(id);
      const cursorRequest = tx.objectStore(RECORDS).index('sessionId').openCursor(IDBKeyRange.only(id));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      await transactionDone(tx, 'Delete');
    });
  }

  async function clearAll() {
    return withDb(async (db) => {
      const tx = db.transaction([SESSIONS, RECORDS], 'readwrite');
      tx.objectStore(SESSIONS).clear();
      tx.objectStore(RECORDS).clear();
      await transactionDone(tx, 'Clear');
    });
  }

  globalThis.CgscDB = {
    open,
    putSession,
    getSession,
    getLatestSessionForTab,
    listSessions,
    putRecord,
    getRecord,
    getRecords,
    countRecords,
    deleteSession,
    clearAll
  };
})();
