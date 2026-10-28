(() => {
  'use strict';

  const DB_NAME = 'chatgpt_session_capture_v1';
  const DB_VERSION = 1;
  const SESSIONS = 'sessions';
  const RECORDS = 'records';

  function open() {
    return new Promise((resolve, reject) => {
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
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function requestAsPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function putSession(session) {
    const db = await open();
    try {
      const tx = db.transaction(SESSIONS, 'readwrite');
      tx.objectStore(SESSIONS).put(session);
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Session transaction aborted'));
      });
      return session;
    } finally {
      db.close();
    }
  }

  async function getSession(id) {
    const db = await open();
    try {
      const tx = db.transaction(SESSIONS, 'readonly');
      return await requestAsPromise(tx.objectStore(SESSIONS).get(id));
    } finally {
      db.close();
    }
  }

  async function getLatestSessionForTab(tabId) {
    const db = await open();
    try {
      const tx = db.transaction(SESSIONS, 'readonly');
      const index = tx.objectStore(SESSIONS).index('tabId');
      const all = await requestAsPromise(index.getAll(IDBKeyRange.only(tabId)));
      all.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
      return all[0] || null;
    } finally {
      db.close();
    }
  }

  async function listSessions() {
    const db = await open();
    try {
      const tx = db.transaction(SESSIONS, 'readonly');
      const all = await requestAsPromise(tx.objectStore(SESSIONS).getAll());
      return all.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    } finally {
      db.close();
    }
  }

  async function putRecord(record) {
    const db = await open();
    try {
      const tx = db.transaction(RECORDS, 'readwrite');
      tx.objectStore(RECORDS).put(record);
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Record transaction aborted'));
      });
      return record;
    } finally {
      db.close();
    }
  }

  async function getRecord(id) {
    const db = await open();
    try {
      const tx = db.transaction(RECORDS, 'readonly');
      return await requestAsPromise(tx.objectStore(RECORDS).get(id));
    } finally {
      db.close();
    }
  }

  async function getRecords(sessionId, kind = null) {
    const db = await open();
    try {
      const tx = db.transaction(RECORDS, 'readonly');
      const store = tx.objectStore(RECORDS);
      let records;
      if (kind) {
        records = await requestAsPromise(
          store.index('sessionKind').getAll(IDBKeyRange.only([sessionId, kind]))
        );
      } else {
        records = await requestAsPromise(
          store.index('sessionId').getAll(IDBKeyRange.only(sessionId))
        );
      }
      return records.sort((a, b) => (a.capturedAt || 0) - (b.capturedAt || 0));
    } finally {
      db.close();
    }
  }

  async function countRecords(sessionId) {
    const db = await open();
    try {
      const tx = db.transaction(RECORDS, 'readonly');
      const index = tx.objectStore(RECORDS).index('sessionId');
      return await requestAsPromise(index.count(IDBKeyRange.only(sessionId)));
    } finally {
      db.close();
    }
  }

  async function deleteSession(id) {
    const db = await open();
    try {
      const tx = db.transaction([SESSIONS, RECORDS], 'readwrite');
      tx.objectStore(SESSIONS).delete(id);
      const index = tx.objectStore(RECORDS).index('sessionId');
      const cursorRequest = index.openCursor(IDBKeyRange.only(id));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Delete transaction aborted'));
      });
    } finally {
      db.close();
    }
  }

  async function clearAll() {
    const db = await open();
    try {
      const tx = db.transaction([SESSIONS, RECORDS], 'readwrite');
      tx.objectStore(SESSIONS).clear();
      tx.objectStore(RECORDS).clear();
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
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
