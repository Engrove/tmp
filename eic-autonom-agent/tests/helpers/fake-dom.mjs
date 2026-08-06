/**
 * v0.10.12: the minimum browser surface needed to *execute* `content.js`.
 *
 * v0.10.11 shipped a content bridge that identified itself as 0.10.10 while the
 * background required 0.10.11. Three packages were built, 154/154 file hashes
 * verified, 862 tests passed — and no gate ever ran the bridge and asked it what
 * version it was. `EIC_PING` is a two-line answer; nothing was there to ask.
 *
 * This is a stub, not a DOM. It exists so the real content script can boot, the
 * message listener can register, and `EIC_PING` can be answered.
 */

class FakeClassList {
  constructor() {
    this.tokens = new Set();
  }

  add(...names) {
    for (const name of names) this.tokens.add(name);
  }

  remove(...names) {
    for (const name of names) this.tokens.delete(name);
  }

  contains(name) {
    return this.tokens.has(name);
  }

  toggle(name, force) {
    const next = force === undefined ? !this.tokens.has(name) : Boolean(force);
    if (next) this.tokens.add(name);
    else this.tokens.delete(name);
    return next;
  }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.dataset = {};
    this.classList = new FakeClassList();
    this.attributes = new Map();
    this.textContent = "";
    this.innerHTML = "";
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.clientHeight = 0;
    this.value = "";
    this.isConnected = true;
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  getAttribute(name) {
    return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(String(name));
  }

  hasAttribute(name) {
    return this.attributes.has(String(name));
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter((item) => item !== child);
    child.parentNode = null;
    return child;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }

  closest() {
    return null;
  }

  addEventListener() {}

  removeEventListener() {}

  getBoundingClientRect() {
    return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 };
  }

  scrollTo() {}

  focus() {}

  click() {}

  dispatchEvent() {
    return true;
  }
}

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
    this.observing = false;
  }

  observe() {
    this.observing = true;
  }

  disconnect() {
    this.observing = false;
  }

  takeRecords() {
    return [];
  }
}

/**
 * Install a browser-ish global environment and return a restore function.
 * `hostname` defaults to a supported ChatGPT host so `isSupportedPage()` is true.
 */
export function installFakeDom({
  href = "https://chatgpt.com/c/conv-fake-0001",
  chrome
} = {}) {
  const url = new URL(href);
  const body = new FakeElement("body");
  const documentElement = new FakeElement("html");

  const document = {
    body,
    documentElement,
    title: "EIC harness",
    readyState: "complete",
    visibilityState: "visible",
    createElement: (tagName) => new FakeElement(tagName),
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true
  };

  const storage = new Map();
  const sessionStorage = {
    getItem: (key) => (storage.has(String(key)) ? storage.get(String(key)) : null),
    setItem: (key, value) => storage.set(String(key), String(value)),
    removeItem: (key) => storage.delete(String(key)),
    clear: () => storage.clear()
  };

  const previous = new Map();
  const assign = (key, value) => {
    previous.set(key, Object.prototype.hasOwnProperty.call(globalThis, key)
      ? globalThis[key]
      : undefined);
    globalThis[key] = value;
  };

  assign("document", document);
  assign("location", {
    href: url.href,
    protocol: url.protocol,
    hostname: url.hostname,
    host: url.host,
    pathname: url.pathname,
    origin: url.origin,
    search: url.search
  });
  assign("sessionStorage", sessionStorage);
  assign("localStorage", sessionStorage);
  assign("MutationObserver", FakeMutationObserver);
  assign("getComputedStyle", () => ({ visibility: "visible", display: "block" }));
  assign("requestAnimationFrame", (callback) => setTimeout(() => callback(Date.now()), 0));
  assign("cancelAnimationFrame", (handle) => clearTimeout(handle));
  assign("scrollTo", () => {});
  assign("innerHeight", 900);
  assign("innerWidth", 1440);
  assign("Node", FakeElement);
  assign("Element", FakeElement);
  assign("HTMLElement", FakeElement);
  if (chrome) assign("chrome", chrome);
  assign("window", globalThis);

  return function restore() {
    for (const [key, value] of previous) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
    previous.clear();
  };
}

/**
 * A `chrome` double just large enough for the content bridge: it captures the
 * registered `onMessage` listener so a test can send `EIC_PING` and read the
 * answer the bridge actually gives.
 */
export function createContentScriptChrome() {
  const listeners = [];
  const sent = [];
  return {
    __listeners: listeners,
    __sent: sent,
    runtime: {
      id: "fake-extension-id",
      lastError: null,
      onMessage: {
        addListener: (listener) => listeners.push(listener),
        removeListener: (listener) => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        }
      },
      sendMessage: async (message) => {
        sent.push(message);
        return undefined;
      }
    },
    /** Deliver a message to the bridge and resolve with its response. */
    ask(message) {
      return new Promise((resolve, reject) => {
        const listener = listeners[0];
        if (!listener) {
          reject(new Error("CONTENT_BRIDGE_REGISTERED_NO_LISTENER"));
          return;
        }
        const handled = listener(message, {}, resolve);
        if (handled !== true) reject(new Error("CONTENT_BRIDGE_DID_NOT_ACCEPT_MESSAGE"));
      });
    }
  };
}
