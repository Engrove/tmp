/**
 * v0.10.11: the runtime harness that v0.10.10 did not have.
 *
 * Before this file, 32 of 77 test files loaded `background.js` with
 * `fs.readFileSync` and asserted on its *source text*. Nothing ever executed the
 * service worker, so no test could observe a runtime throw on the
 * prompt-critical path — which is why 835/835 could pass while the first live
 * run stalled before sending a single prompt.
 *
 * This is a deliberately small fake: enough `chrome.*`, `indexedDB` and
 * `crypto` surface for `background.js` to import and drive a real mission, and
 * nothing more. It is a test double, not a Chrome emulator.
 */

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

class FakeEvent {
  constructor() {
    this.listeners = [];
  }

  addListener(listener) {
    this.listeners.push(listener);
  }

  removeListener(listener) {
    this.listeners = this.listeners.filter((item) => item !== listener);
  }

  emit(...args) {
    return this.listeners.map((listener) => listener(...args));
  }
}

// ---------------------------------------------------------------------------
// indexedDB
// ---------------------------------------------------------------------------

class FakeRequest {
  constructor() {
    this.result = undefined;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
    this.onupgradeneeded = null;
  }

  succeed(result) {
    this.result = result;
    queueMicrotask(() => this.onsuccess?.({ target: this }));
  }
}

class FakeObjectStore {
  constructor(name, records, transaction) {
    this.name = name;
    this.records = records;
    this.transaction = transaction;
    this.indexNames = [];
  }

  createIndex(name) {
    this.indexNames.push(name);
    return { name };
  }

  put(record) {
    const request = new FakeRequest();
    this.records.set(String(record.id), clone(record));
    this.transaction.pending.push(request);
    request.succeed(record.id);
    return request;
  }

  get(id) {
    const request = new FakeRequest();
    this.transaction.pending.push(request);
    request.succeed(clone(this.records.get(String(id))) ?? undefined);
    return request;
  }

  delete(id) {
    const request = new FakeRequest();
    this.records.delete(String(id));
    this.transaction.pending.push(request);
    request.succeed(undefined);
    return request;
  }

  index() {
    return this;
  }

  openCursor() {
    const request = new FakeRequest();
    const values = [...this.records.values()].map(clone);
    let position = 0;
    const step = () => {
      if (position >= values.length) {
        request.result = null;
        queueMicrotask(() => request.onsuccess?.({ target: request }));
        return;
      }
      const value = values[position];
      position += 1;
      request.result = { value, continue: step };
      queueMicrotask(() => request.onsuccess?.({ target: request }));
    };
    this.transaction.pending.push(request);
    queueMicrotask(step);
    return request;
  }
}

class FakeTransaction {
  constructor(db, stores) {
    this.db = db;
    this.stores = stores;
    this.pending = [];
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    // One macrotask is enough: every fake request settles on a microtask.
    setTimeout(() => this.oncomplete?.(), 0);
  }

  objectStore(name) {
    if (!this.stores.includes(name)) throw new Error(`STORE_NOT_IN_TRANSACTION:${name}`);
    return new FakeObjectStore(name, this.db.stores.get(name), this);
  }
}

class FakeDatabase {
  constructor() {
    this.stores = new Map();
    this.closed = false;
  }

  get objectStoreNames() {
    return [...this.stores.keys()];
  }

  createObjectStore(name) {
    this.stores.set(name, new Map());
    return new FakeObjectStore(name, this.stores.get(name), { pending: [] });
  }

  deleteObjectStore(name) {
    this.stores.delete(name);
  }

  transaction(stores) {
    return new FakeTransaction(this, Array.isArray(stores) ? stores : [stores]);
  }

  close() {
    this.closed = true;
  }
}

export function createFakeIndexedDb() {
  const databases = new Map();
  return {
    open(name) {
      const request = new FakeRequest();
      let db = databases.get(name);
      const fresh = !db;
      if (fresh) {
        db = new FakeDatabase();
        databases.set(name, db);
      }
      queueMicrotask(() => {
        request.result = db;
        if (fresh) request.onupgradeneeded?.({ target: request });
        request.onsuccess?.({ target: request });
      });
      return request;
    }
  };
}

// ---------------------------------------------------------------------------
// chrome
// ---------------------------------------------------------------------------

/**
 * @param {object} options
 * @param {(tabId:number, message:object) => any} options.onTabMessage
 *   Handler standing in for the content script. Throwing from it models a
 *   content-bridge failure, which is the failure class this release is about.
 */
export function createFakeChrome({ onTabMessage, manifest = {} } = {}) {
  const storage = new Map();
  const tabs = new Map();
  const alarms = new Map();
  const panelMessages = [];

  const chrome = {
    __storage: storage,
    __tabs: tabs,
    __alarms: alarms,
    __panelMessages: panelMessages,
    runtime: {
      id: "fake-extension-id",
      lastError: null,
      onMessage: new FakeEvent(),
      onInstalled: new FakeEvent(),
      onStartup: new FakeEvent(),
      getManifest: () => ({
        manifest_version: 3,
        permissions: ["sidePanel", "storage", "tabs", "scripting", "alarms"],
        host_permissions: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
        ...manifest
      }),
      async sendMessage(message) {
        // Stands in for the sidepanel. There is no open panel in the harness,
        // so record and resolve exactly as Chrome does with no receiver.
        panelMessages.push(clone(message));
        return undefined;
      }
    },
    storage: {
      local: {
        async get(keys) {
          const wanted = keys == null
            ? [...storage.keys()]
            : (Array.isArray(keys) ? keys : [keys]);
          const out = {};
          for (const key of wanted) {
            if (storage.has(key)) out[key] = clone(storage.get(key));
          }
          return out;
        },
        async set(entries) {
          for (const [key, value] of Object.entries(entries)) storage.set(key, clone(value));
        },
        async remove(keys) {
          for (const key of (Array.isArray(keys) ? keys : [keys])) storage.delete(key);
        },
        async clear() {
          storage.clear();
        },
        async setAccessLevel() {}
      }
    },
    tabs: {
      onActivated: new FakeEvent(),
      onUpdated: new FakeEvent(),
      onRemoved: new FakeEvent(),
      onReplaced: new FakeEvent(),
      onDetached: new FakeEvent(),
      onAttached: new FakeEvent(),
      async get(tabId) {
        const tab = tabs.get(Number(tabId));
        if (!tab) throw new Error(`No tab with id: ${tabId}`);
        return clone(tab);
      },
      async query(info = {}) {
        return [...tabs.values()]
          .filter((tab) => (info.windowId == null || tab.windowId === info.windowId))
          .filter((tab) => (info.active == null || tab.active === info.active))
          .map(clone);
      },
      async update(tabId, patch) {
        const tab = tabs.get(Number(tabId));
        if (!tab) throw new Error(`No tab with id: ${tabId}`);
        Object.assign(tab, patch);
        return clone(tab);
      },
      async reload(tabId) {
        if (!tabs.has(Number(tabId))) throw new Error(`No tab with id: ${tabId}`);
      },
      async sendMessage(tabId, message) {
        if (!tabs.has(Number(tabId))) {
          throw new Error("Could not establish connection. Receiving end does not exist.");
        }
        return onTabMessage(Number(tabId), clone(message));
      }
    },
    scripting: {
      async executeScript() {
        return [{ result: null }];
      }
    },
    alarms: {
      onAlarm: new FakeEvent(),
      async get(name) {
        return alarms.get(name) || undefined;
      },
      async create(name, info) {
        alarms.set(name, { name, ...info });
      },
      async clear(name) {
        return alarms.delete(name);
      }
    },
    sidePanel: {
      async setPanelBehavior() {}
    },
    windows: {
      onRemoved: new FakeEvent()
    },
    debugger: {
      onDetach: new FakeEvent(),
      onEvent: new FakeEvent()
    }
  };
  return chrome;
}

export function createTab({
  tabId = 1001,
  windowId = 9001,
  url = "https://chatgpt.com/c/conv-fake-0001",
  title = "EIC harness"
} = {}) {
  return {
    id: tabId,
    windowId,
    url,
    title,
    active: true,
    discarded: false,
    frozen: false,
    autoDiscardable: true,
    status: "complete"
  };
}

/**
 * Minimal ChatGPT page model: an assistant-terminated transcript that records
 * every prompt the background actually submits. `submittedPrompts` is the
 * harness's proof of delivery — the thing the v0.10.10 run never produced.
 */
export function createFakePage({
  conversationKey = "chatgpt.com:c:conv-fake-0001",
  assistantText = "Ett stabilt assistantsvar utan EIC-trailer.",
  contentScriptVersion
} = {}) {
  const page = {
    conversationKey,
    assistantText,
    assistantCount: 1,
    documentEpoch: "epoch-fake-0001",
    submittedPrompts: [],
    failNextPageReads: 0,
    failAllPageReads: false,
    // Fail only page reads issued with these `source` values. `readPage` is called
    // both by the tick and by the decision-freshness check inside the application
    // step; failing only the latter models a transient content-bridge fault on the
    // prompt-critical path while the tick itself stays healthy.
    failPageReadSources: new Set(),
    ackTurnIds: new Set()
  };

  page.hash = () => `hash-${page.assistantCount}-${page.assistantText.length}`;

  // After a submit the newest message is the user's, exactly as in the real DOM.
  // The transcript only becomes an assistant-terminated candidate again once the
  // target replies, which is what makes "exactly one prompt per response" testable.
  page.awaitingReply = false;

  page.replyAsAssistant = (text) => {
    page.assistantText = String(text);
    page.assistantCount += 1;
    page.awaitingReply = false;
    return page;
  };

  page.state = () => ({
    ok: true,
    supported: true,
    sessionExists: true,
    url: `https://chatgpt.com/c/${conversationKey.split(":").pop()}`,
    title: "EIC harness",
    conversationKey,
    documentEpoch: page.documentEpoch,
    generating: false,
    composerBusy: false,
    stopControlVisible: false,
    streamingAssistant: false,
    responseState: "COMPLETE",
    taskFingerprint: `fingerprint-${conversationKey}`,
    assistantCount: page.assistantCount,
    latestAssistantHash: page.hash(),
    latestAssistant: page.assistantText,
    latestAssistantText: page.assistantText,
    latestAssistantCandidate: !page.awaitingReply,
    latestAssistantComplete: true,
    conversationExcerpt: page.assistantText,
    latestMessageRole: page.awaitingReply ? "user" : "assistant",
    latestMessageHash: page.awaitingReply
      ? `user-${page.submittedPrompts.length}`
      : page.hash(),
    userTurnIds: [...page.ackTurnIds],
    userMessageHashes: page.submittedPrompts.map((_, index) => `user-${index}`),
    backgroundSignals: { active: false, language: "sv" },
    contentScriptVersion,
    version: contentScriptVersion,
    sourceClass: "TRUSTED_PAGE_CHROME",
    trusted: true
  });

  page.handle = (message) => {
    const type = String(message?.type || "");
    if (type === "EIC_PING") {
      return { ok: true, version: contentScriptVersion };
    }
    if (type === "EIC_GET_PAGE_STATE") {
      const sourceBlocked = page.failPageReadSources.has(String(message.source || ""));
      if (page.failAllPageReads || sourceBlocked || page.failNextPageReads > 0) {
        if (!page.failAllPageReads && !sourceBlocked && page.failNextPageReads > 0) {
          page.failNextPageReads -= 1;
        }
        throw new Error("ChatGPT-fliken kunde inte läsas.");
      }
      return page.state();
    }
    if (type === "EIC_SUBMIT_PROMPT") {
      page.submittedPrompts.push({
        prompt: String(message.prompt || ""),
        turnId: String(message.turnId || message.expectedTurnId || ""),
        at: new Date().toISOString()
      });
      if (message.turnId) page.ackTurnIds.add(String(message.turnId));
      page.awaitingReply = true;
      return {
        ok: true,
        submitted: true,
        accepted: true,
        acknowledged: true,
        turnId: message.turnId || "",
        userTurnIds: [...page.ackTurnIds],
        userMessageHashes: page.submittedPrompts.map((_, index) => `user-${index}`)
      };
    }
    if (type === "EIC_CAPTURE_TRANSCRIPT") {
      return {
        ok: true,
        requestId: message.requestId,
        completeness: "COMPLETE",
        mode: "FULL",
        scrollRestored: true,
        gapCount: 0,
        conversationKey,
        documentEpoch: page.documentEpoch,
        turns: [
          { role: "user", text: "Uppdraget startades av operatören.", index: 0 },
          { role: "assistant", text: page.assistantText, index: 1 }
        ]
      };
    }
    if (type === "EIC_CANCEL_CAPTURE") return { ok: true };
    if (type === "EIC_SET_INDICATOR" || type === "EIC_SET_OVERLAY") return { ok: true };
    return { ok: true };
  };

  return page;
}
