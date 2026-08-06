import test from "node:test";
import assert from "node:assert/strict";

import {
  SESSION_DB_NAME,
  SESSION_DB_POINTER_KEYS,
  SESSION_DB_SCHEMA,
  SESSION_DB_STORES,
  SessionDatabase,
  openSessionDatabase,
  redactSessionRecord,
  sessionDbPlan
} from "../lib/session-db.mjs";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function namedError(name, message = name) {
  const error = new Error(message);
  error.name = name;
  return error;
}

function fakeDb({ failPut = null, corruptReadback = false } = {}) {
  const stores = new Map(SESSION_DB_STORES.map((name) => [name, new Map()]));
  const db = {
    objectStoreNames: [...SESSION_DB_STORES],
    close() {},
    transaction(storeNames, mode) {
      const tx = {
        mode,
        error: null,
        oncomplete: null,
        onabort: null,
        onerror: null,
        objectStore(name) {
          const map = stores.get(name);
          if (!map) throw new Error("STORE_NOT_FOUND");
          const complete = () => setTimeout(() => tx.oncomplete?.(), 0);
          const fail = (error) => {
            tx.error = error;
            setTimeout(() => tx.onabort?.(), 0);
          };
          const source = {
            put(value) {
              if (failPut) {
                fail(namedError(failPut));
                return {};
              }
              map.set(String(value.id), clone(value));
              complete();
              return {};
            },
            get(id) {
              const request = { result: undefined, error: null, onsuccess: null, onerror: null };
              setTimeout(() => {
                const found = map.get(String(id));
                request.result = corruptReadback && found ? { ...clone(found), id: "wrong-id" } : clone(found);
                request.onsuccess?.();
                complete();
              }, 0);
              return request;
            },
            delete(id) {
              map.delete(String(id));
              complete();
              return {};
            },
            index() {
              return source;
            },
            openCursor(query = null) {
              const values = [...map.values()].filter((value) => query == null ||
                value.conversationKey === query ||
                value.projectId === query ||
                value.taskFingerprint === query ||
                value.updatedAt === query);
              let index = 0;
              const request = { result: null, error: null, onsuccess: null, onerror: null };
              const emit = () => setTimeout(() => {
                if (index >= values.length) {
                  request.result = null;
                  request.onsuccess?.();
                  complete();
                  return;
                }
                const value = clone(values[index++]);
                request.result = { value, continue: emit };
                request.onsuccess?.();
              }, 0);
              emit();
              return request;
            }
          };
          return source;
        }
      };
      return tx;
    }
  };
  return { db, stores };
}

test("v0.10.0 Session DB plan is current-only and declares all required stores", () => {
  const plan = sessionDbPlan();
  assert.equal(plan.schema, SESSION_DB_SCHEMA);
  assert.equal(plan.name, SESSION_DB_NAME);
  assert.equal(plan.currentOnly, true);
  assert.equal(plan.upgradeBehavior, "RESET_TO_EMPTY_V1");
  assert.deepEqual(plan.stores, SESSION_DB_STORES);
});

test("v0.10.0 Session DB uses small chrome.storage pointer keys only", () => {
  assert.deepEqual(Object.keys(SESSION_DB_POINTER_KEYS).sort(), [
    "ACTIVE_CAPTURE_ID", "ACTIVE_MEMORY_ID", "READINESS"
  ]);
  for (const value of Object.values(SESSION_DB_POINTER_KEYS)) {
    assert.match(value, /^eicAutonomAgent\.v10\./);
  }
});

test("v0.10.0 Session DB redacts secrets recursively before persistence", () => {
  const redacted = redactSessionRecord({
    id: "record-1",
    token: "secret-token",
    nested: { cookie: "secret-cookie", safe: "visible" },
    entries: [{ credentialRef: "credential", value: 1 }]
  });
  assert.equal(redacted.token, "[REDACTED]");
  assert.equal(redacted.nested.cookie, "[REDACTED]");
  assert.equal(redacted.nested.safe, "visible");
  assert.equal(redacted.entries[0].credentialRef, "[REDACTED]");
});

test("v0.10.0 IndexedDB put requires transaction completion and exact readback", async () => {
  const { db } = fakeDb();
  const sessionDb = new SessionDatabase(db);
  const stored = await sessionDb.put("sessionMemories", {
    id: "memory-1",
    conversationKey: "chatgpt.com:c:1",
    sourceHash: "a".repeat(64),
    token: "must-not-persist"
  });
  assert.equal(stored.id, "memory-1");
  assert.equal(stored.token, "[REDACTED]");
  assert.ok(stored.updatedAt);
});

test("v0.10.0 IndexedDB rejects unknown stores and missing record identity", async () => {
  const { db } = fakeDb();
  const sessionDb = new SessionDatabase(db);
  await assert.rejects(() => sessionDb.put("legacyState", { id: "x" }), /SESSION_DB_STORE_UNKNOWN/);
  await assert.rejects(() => sessionDb.put("captures", { conversationKey: "x" }), /SESSION_DB_RECORD_ID_REQUIRED/);
});

test("v0.10.0 IndexedDB maps quota failure to a fail-closed domain error", async () => {
  const { db } = fakeDb({ failPut: "QuotaExceededError" });
  const sessionDb = new SessionDatabase(db);
  await assert.rejects(
    () => sessionDb.put("captures", { id: "capture-1" }),
    /SESSION_DB_QUOTA_EXCEEDED/
  );
});

test("v0.10.0 IndexedDB rejects corrupted readback", async () => {
  const { db } = fakeDb({ corruptReadback: true });
  const sessionDb = new SessionDatabase(db);
  await assert.rejects(
    () => sessionDb.put("captures", { id: "capture-1" }),
    /SESSION_DB_FAILURE:Error/
  );
});

test("v0.10.0 IndexedDB list, delete and conversation purge preserve unrelated records", async () => {
  const { db } = fakeDb();
  const sessionDb = new SessionDatabase(db);
  await sessionDb.put("captures", { id: "capture-a", conversationKey: "conversation-a" });
  await sessionDb.put("captures", { id: "capture-b", conversationKey: "conversation-b" });
  assert.equal((await sessionDb.list("captures")).length, 2);
  const result = await sessionDb.purge({ conversationKey: "conversation-a" });
  assert.equal(result.deleted, 1);
  assert.equal(await sessionDb.get("captures", "capture-a"), null);
  assert.equal((await sessionDb.get("captures", "capture-b")).id, "capture-b");
});

test("v0.10.0 missing IndexedDB factory blocks persistence explicitly", async () => {
  await assert.rejects(() => openSessionDatabase(null), /INDEXEDDB_UNAVAILABLE/);
});
