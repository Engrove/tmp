(() => {
  'use strict';

  if (window.__CGSC_PAGE_HOOK_INSTALLED__) return;
  Object.defineProperty(window, '__CGSC_PAGE_HOOK_INSTALLED__', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  const PAGE_SOURCE = 'CGSC_PAGE_V1';
  const BRIDGE_SOURCE = 'CGSC_BRIDGE_V1';
  const pending = [];
  const MAX_PENDING = 200;
  let bridgeToken = null;
  let captureConfig = { pageNetwork: false, captureRuntime: false };
  let networkHooksInstalled = false;

  function now() {
    return Date.now();
  }

  function randomId(prefix = 'evt') {
    return `${prefix}-${now()}-${Math.random().toString(36).slice(2)}`;
  }

  function emit(type, payload) {
    const message = {
      source: PAGE_SOURCE,
      token: bridgeToken,
      type,
      payload,
      emittedAt: now()
    };
    if (!bridgeToken) {
      pending.push(message);
      if (pending.length > MAX_PENDING) pending.shift();
      return;
    }
    window.postMessage(message, '*');
  }

  function flushPending() {
    while (pending.length) {
      const message = pending.shift();
      message.token = bridgeToken;
      window.postMessage(message, '*');
    }
  }

  function headersToObject(headers) {
    const output = {};
    try {
      if (headers instanceof Headers) {
        for (const [key, value] of headers.entries()) output[key] = value;
      } else if (Array.isArray(headers)) {
        for (const pair of headers) {
          if (Array.isArray(pair) && pair.length >= 2) output[String(pair[0])] = String(pair[1]);
        }
      } else if (headers && typeof headers === 'object') {
        for (const [key, value] of Object.entries(headers)) output[key] = String(value);
      }
    } catch (error) {
      output.__capture_error__ = String(error);
    }
    return output;
  }

  function isTextual(contentType = '') {
    return /(^text\/|json|javascript|xml|graphql|event-stream|x-www-form-urlencoded|markdown|csv)/i.test(contentType);
  }

  function bytesToBase64(bytes) {
    const chunkSize = 0x8000;
    let binary = '';
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
  }

  async function readBlobLike(value, contentType = '') {
    try {
      if (value == null) return null;
      if (typeof value === 'string') {
        return { encoding: 'utf-8', body: value, size: value.length };
      }
      if (value instanceof URLSearchParams) {
        const body = value.toString();
        return { encoding: 'utf-8', body, size: body.length };
      }
      if (value instanceof FormData) {
        const entries = [];
        for (const [key, entry] of value.entries()) {
          if (entry instanceof File) {
            entries.push({
              key,
              file: {
                name: entry.name,
                type: entry.type,
                size: entry.size,
                lastModified: entry.lastModified
              }
            });
          } else {
            entries.push({ key, value: String(entry) });
          }
        }
        return { encoding: 'form-data-summary', body: entries, size: entries.length };
      }
      if (value instanceof Blob) {
        const type = value.type || contentType;
        if (isTextual(type)) {
          return { encoding: 'utf-8', body: await value.text(), size: value.size, contentType: type };
        }
        return {
          encoding: 'base64',
          body: bytesToBase64(new Uint8Array(await value.arrayBuffer())),
          size: value.size,
          contentType: type
        };
      }
      if (value instanceof ArrayBuffer) {
        const bytes = new Uint8Array(value);
        return { encoding: 'base64', body: bytesToBase64(bytes), size: bytes.byteLength };
      }
      if (ArrayBuffer.isView(value)) {
        const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        return { encoding: 'base64', body: bytesToBase64(bytes), size: bytes.byteLength };
      }
      return { encoding: 'summary', body: String(value), size: null };
    } catch (error) {
      return { encoding: 'capture-error', body: String(error), size: null };
    }
  }

  function installFetchHook() {
    const originalFetch = window.fetch;
    if (typeof originalFetch !== 'function') return;

    window.fetch = function cgscFetch(input, init = undefined) {
      if (!captureConfig.pageNetwork) return originalFetch.apply(this, arguments);
      const requestId = randomId('fetch');
      const startedAt = now();
      let requestUrl = '';
      let requestMethod = 'GET';
      let requestHeaders = {};

      try {
        if (input instanceof Request) {
          requestUrl = input.url;
          requestMethod = init?.method || input.method || 'GET';
          requestHeaders = headersToObject(init?.headers || input.headers);
        } else {
          requestUrl = String(input);
          requestMethod = init?.method || 'GET';
          requestHeaders = headersToObject(init?.headers);
        }
      } catch (_) {
        requestUrl = String(input || '');
      }

      Promise.resolve().then(async () => {
        let requestBody = null;
        try {
          if (init?.body != null) {
            requestBody = await readBlobLike(init.body, requestHeaders['content-type']);
          } else if (input instanceof Request && !['GET', 'HEAD'].includes(requestMethod.toUpperCase())) {
            try {
              requestBody = await readBlobLike(await input.clone().blob(), requestHeaders['content-type']);
            } catch (_) {
              requestBody = null;
            }
          }
        } catch (error) {
          requestBody = { encoding: 'capture-error', body: String(error) };
        }

        emit('RECORD', {
          id: requestId,
          kind: 'page-fetch-request',
          capturedAt: startedAt,
          data: {
            url: requestUrl,
            method: requestMethod,
            headers: requestHeaders,
            body: requestBody,
            pageUrl: location.href
          }
        });
      });

      let fetchPromise;
      try {
        fetchPromise = originalFetch.apply(this, arguments);
      } catch (error) {
        emit('RECORD', {
          id: `${requestId}-error`,
          kind: 'page-fetch-error',
          capturedAt: now(),
          data: {
            requestId,
            url: requestUrl,
            message: String(error),
            stack: error?.stack || null,
            durationMs: now() - startedAt,
            pageUrl: location.href
          }
        });
        throw error;
      }

      return Promise.resolve(fetchPromise).then((response) => {
        const responseClone = response.clone();
        const headers = headersToObject(response.headers);
        const contentType = headers['content-type'] || '';

        Promise.resolve().then(async () => {
          let body;
          try {
            if (isTextual(contentType)) {
              const text = await responseClone.text();
              body = { encoding: 'utf-8', body: text, size: text.length };
            } else {
              const bytes = new Uint8Array(await responseClone.arrayBuffer());
              body = { encoding: 'base64', body: bytesToBase64(bytes), size: bytes.byteLength };
            }
          } catch (error) {
            body = { encoding: 'capture-error', body: String(error), size: null };
          }

          emit('RECORD', {
            id: `${requestId}-response`,
            kind: 'page-fetch-response',
            capturedAt: now(),
            data: {
              requestId,
              url: response.url || requestUrl,
              status: response.status,
              statusText: response.statusText,
              redirected: response.redirected,
              type: response.type,
              headers,
              body,
              durationMs: now() - startedAt,
              pageUrl: location.href
            }
          });
        });

        return response;
      }, (error) => {
        emit('RECORD', {
          id: `${requestId}-error`,
          kind: 'page-fetch-error',
          capturedAt: now(),
          data: {
            requestId,
            url: requestUrl,
            message: String(error),
            stack: error?.stack || null,
            durationMs: now() - startedAt,
            pageUrl: location.href
          }
        });
        throw error;
      });
    };
  }

  function installXhrHook() {
    const OriginalXHR = window.XMLHttpRequest;
    if (typeof OriginalXHR !== 'function') return;

    const originalOpen = OriginalXHR.prototype.open;
    const originalSend = OriginalXHR.prototype.send;
    const originalSetRequestHeader = OriginalXHR.prototype.setRequestHeader;

    OriginalXHR.prototype.open = function cgscOpen(method, url) {
      if (!captureConfig.pageNetwork) {
        this.__cgsc = null;
        return originalOpen.apply(this, arguments);
      }
      this.__cgsc = {
        id: randomId('xhr'),
        method: String(method || 'GET'),
        url: String(url || ''),
        headers: {},
        openedAt: now()
      };
      return originalOpen.apply(this, arguments);
    };

    OriginalXHR.prototype.setRequestHeader = function cgscSetHeader(name, value) {
      if (this.__cgsc) this.__cgsc.headers[String(name)] = String(value);
      return originalSetRequestHeader.apply(this, arguments);
    };

    OriginalXHR.prototype.send = function cgscSend(body) {
      if (!captureConfig.pageNetwork) return originalSend.apply(this, arguments);
      const meta = this.__cgsc || {
        id: randomId('xhr'),
        method: 'GET',
        url: '',
        headers: {},
        openedAt: now()
      };

      Promise.resolve(readBlobLike(body, meta.headers['content-type'])).then((capturedBody) => {
        emit('RECORD', {
          id: meta.id,
          kind: 'page-xhr-request',
          capturedAt: now(),
          data: {
            url: meta.url,
            method: meta.method,
            headers: meta.headers,
            body: capturedBody,
            pageUrl: location.href
          }
        });
      });

      this.addEventListener('loadend', async () => {
        let responseBody = null;
        try {
          if (!this.responseType || this.responseType === 'text' || this.responseType === 'json') {
            responseBody = {
              encoding: 'utf-8',
              body: this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText,
              size: this.responseText?.length ?? null
            };
          } else {
            responseBody = await readBlobLike(this.response, this.getResponseHeader('content-type') || '');
          }
        } catch (error) {
          responseBody = { encoding: 'capture-error', body: String(error), size: null };
        }

        let responseHeaders = {};
        try {
          const raw = this.getAllResponseHeaders() || '';
          responseHeaders = Object.fromEntries(
            raw.trim().split(/[\r\n]+/).filter(Boolean).map((line) => {
              const separator = line.indexOf(':');
              return separator < 0
                ? [line.trim(), '']
                : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
            })
          );
        } catch (_) {
          responseHeaders = {};
        }

        emit('RECORD', {
          id: `${meta.id}-response`,
          kind: 'page-xhr-response',
          capturedAt: now(),
          data: {
            requestId: meta.id,
            url: this.responseURL || meta.url,
            status: this.status,
            statusText: this.statusText,
            responseType: this.responseType || 'text',
            headers: responseHeaders,
            body: responseBody,
            durationMs: now() - meta.openedAt,
            pageUrl: location.href
          }
        });
      }, { once: true });

      return originalSend.apply(this, arguments);
    };
  }

  function installWebSocketHook() {
    const OriginalWebSocket = window.WebSocket;
    if (typeof OriginalWebSocket !== 'function') return;

    function WrappedWebSocket(url, protocols) {
      if (!captureConfig.pageNetwork) {
        return protocols === undefined ? new OriginalWebSocket(url) : new OriginalWebSocket(url, protocols);
      }
      const socket = protocols === undefined
        ? new OriginalWebSocket(url)
        : new OriginalWebSocket(url, protocols);
      const socketId = randomId('ws');

      emit('RECORD', {
        id: socketId,
        kind: 'page-websocket-open',
        capturedAt: now(),
        data: { url: String(url), protocols: protocols ?? null, pageUrl: location.href }
      });

      const originalSend = socket.send;
      socket.send = function cgscWebSocketSend(data) {
        Promise.resolve(readBlobLike(data)).then((body) => {
          emit('RECORD', {
            id: randomId(`${socketId}-sent`),
            kind: 'page-websocket-frame-sent',
            capturedAt: now(),
            data: { socketId, body, pageUrl: location.href }
          });
        });
        return originalSend.apply(this, arguments);
      };

      socket.addEventListener('message', (event) => {
        Promise.resolve(readBlobLike(event.data)).then((body) => {
          emit('RECORD', {
            id: randomId(`${socketId}-received`),
            kind: 'page-websocket-frame-received',
            capturedAt: now(),
            data: { socketId, origin: event.origin, body, pageUrl: location.href }
          });
        });
      });
      socket.addEventListener('close', (event) => {
        emit('RECORD', {
          id: randomId(`${socketId}-closed`),
          kind: 'page-websocket-close',
          capturedAt: now(),
          data: { socketId, code: event.code, reason: event.reason, wasClean: event.wasClean, pageUrl: location.href }
        });
      });
      socket.addEventListener('error', () => {
        emit('RECORD', {
          id: randomId(`${socketId}-error`),
          kind: 'page-websocket-error',
          capturedAt: now(),
          data: { socketId, pageUrl: location.href }
        });
      });

      return socket;
    }

    WrappedWebSocket.prototype = OriginalWebSocket.prototype;
    Object.defineProperties(WrappedWebSocket, {
      CONNECTING: { value: OriginalWebSocket.CONNECTING },
      OPEN: { value: OriginalWebSocket.OPEN },
      CLOSING: { value: OriginalWebSocket.CLOSING },
      CLOSED: { value: OriginalWebSocket.CLOSED }
    });
    window.WebSocket = WrappedWebSocket;
  }

  function installEventSourceHook() {
    const OriginalEventSource = window.EventSource;
    if (typeof OriginalEventSource !== 'function') return;

    function WrappedEventSource(url, configuration) {
      if (!captureConfig.pageNetwork) return new OriginalEventSource(url, configuration);
      const source = new OriginalEventSource(url, configuration);
      const sourceId = randomId('eventsource');
      emit('RECORD', {
        id: sourceId,
        kind: 'page-eventsource-open',
        capturedAt: now(),
        data: { url: String(url), withCredentials: Boolean(configuration?.withCredentials), pageUrl: location.href }
      });
      source.addEventListener('message', (event) => {
        emit('RECORD', {
          id: randomId(`${sourceId}-message`),
          kind: 'page-eventsource-message',
          capturedAt: now(),
          data: { sourceId, data: event.data, lastEventId: event.lastEventId, origin: event.origin, pageUrl: location.href }
        });
      });
      source.addEventListener('error', () => {
        emit('RECORD', {
          id: randomId(`${sourceId}-error`),
          kind: 'page-eventsource-error',
          capturedAt: now(),
          data: { sourceId, readyState: source.readyState, pageUrl: location.href }
        });
      });
      return source;
    }

    WrappedEventSource.prototype = OriginalEventSource.prototype;
    Object.defineProperties(WrappedEventSource, {
      CONNECTING: { value: OriginalEventSource.CONNECTING },
      OPEN: { value: OriginalEventSource.OPEN },
      CLOSED: { value: OriginalEventSource.CLOSED }
    });
    window.EventSource = WrappedEventSource;
  }

  function installNavigationHook() {
    for (const methodName of ['pushState', 'replaceState']) {
      const original = history[methodName];
      if (typeof original !== 'function') continue;
      history[methodName] = function cgscHistory() {
        const result = original.apply(this, arguments);
        if (!captureConfig.pageNetwork) return result;
        emit('RECORD', {
          id: randomId('navigation'),
          kind: 'page-navigation',
          capturedAt: now(),
          data: { method: methodName, url: location.href, state: safeSerialize(history.state, { maxDepth: 8, maxNodes: 10000 }) }
        });
        return result;
      };
    }
    addEventListener('popstate', () => {
      if (!captureConfig.pageNetwork) return;
      emit('RECORD', {
        id: randomId('navigation'),
        kind: 'page-navigation',
        capturedAt: now(),
        data: { method: 'popstate', url: location.href, state: safeSerialize(history.state, { maxDepth: 8, maxNodes: 10000 }) }
      });
    });
  }

  function safeSerialize(root, limits = {}) {
    const maxDepth = Number.isFinite(limits.maxDepth) ? limits.maxDepth : 20;
    const maxNodes = Number.isFinite(limits.maxNodes) ? limits.maxNodes : 250000;
    const maxString = Number.isFinite(limits.maxString) ? limits.maxString : 10 * 1024 * 1024;
    const seen = new WeakMap();
    let nodes = 0;
    let truncated = false;

    function encode(value, depth, path) {
      nodes += 1;
      if (nodes > maxNodes) {
        truncated = true;
        return { __cgsc_truncated__: 'maxNodes', path };
      }
      if (depth > maxDepth) {
        truncated = true;
        return { __cgsc_truncated__: 'maxDepth', path };
      }
      if (value === null || value === undefined) return value ?? null;
      const type = typeof value;
      if (type === 'string') {
        if (value.length > maxString) {
          truncated = true;
          return `${value.slice(0, maxString)}\n[CGSC truncated ${value.length - maxString} characters]`;
        }
        return value;
      }
      if (type === 'number' || type === 'boolean') return value;
      if (type === 'bigint') return { __type__: 'BigInt', value: value.toString() };
      if (type === 'symbol') return { __type__: 'Symbol', value: String(value) };
      if (type === 'function') return { __type__: 'Function', name: value.name || null, source: String(value) };

      if (seen.has(value)) return { __ref__: seen.get(value) };
      seen.set(value, path);

      try {
        if (value instanceof Date) return { __type__: 'Date', value: value.toISOString() };
        if (value instanceof RegExp) return { __type__: 'RegExp', value: String(value) };
        if (value instanceof URL) return { __type__: 'URL', value: value.href };
        if (value instanceof Error) {
          return { __type__: 'Error', name: value.name, message: value.message, stack: value.stack || null };
        }
        if (value instanceof ArrayBuffer) {
          const bytes = new Uint8Array(value);
          return { __type__: 'ArrayBuffer', byteLength: bytes.byteLength, base64: bytesToBase64(bytes) };
        }
        if (ArrayBuffer.isView(value)) {
          const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
          return { __type__: value.constructor?.name || 'TypedArray', byteLength: bytes.byteLength, base64: bytesToBase64(bytes) };
        }
        if (value instanceof Map) {
          return {
            __type__: 'Map',
            entries: [...value.entries()].map(([key, item], index) => [
              encode(key, depth + 1, `${path}.mapKey${index}`),
              encode(item, depth + 1, `${path}.mapValue${index}`)
            ])
          };
        }
        if (value instanceof Set) {
          return {
            __type__: 'Set',
            values: [...value.values()].map((item, index) => encode(item, depth + 1, `${path}.set${index}`))
          };
        }
        if (value instanceof Node) {
          return {
            __type__: value.constructor?.name || 'Node',
            nodeName: value.nodeName,
            textContent: value.textContent,
            outerHTML: value.outerHTML || null
          };
        }
        if (Array.isArray(value)) {
          return value.map((item, index) => encode(item, depth + 1, `${path}[${index}]`));
        }

        const output = { __type__: value.constructor?.name || 'Object' };
        for (const key of Reflect.ownKeys(value)) {
          const stringKey = typeof key === 'symbol' ? `[${String(key)}]` : String(key);
          try {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (descriptor && 'value' in descriptor) {
              output[stringKey] = encode(descriptor.value, depth + 1, `${path}.${stringKey}`);
            } else if (descriptor) {
              output[stringKey] = {
                __type__: 'Accessor',
                get: descriptor.get ? String(descriptor.get) : null,
                set: descriptor.set ? String(descriptor.set) : null
              };
            }
          } catch (error) {
            output[stringKey] = { __cgsc_error__: String(error) };
          }
        }
        return output;
      } catch (error) {
        return { __cgsc_error__: String(error), path };
      }
    }

    return {
      value: encode(root, 0, '$'),
      metadata: { maxDepth, maxNodes, maxString, visitedNodes: nodes, truncated }
    };
  }

  function captureRuntimeSnapshot(options = {}) {
    const globalPattern = /(^__.*(NEXT|APOLLO|INITIAL|PRELOADED|RELAY|QUERY|CHAT|CONVERSATION|ROUTER|STORE|STATE).*$)|(^webpackChunk)|(^next$)/i;
    const globals = {};
    const globalKeys = Reflect.ownKeys(window).filter((key) => typeof key === 'string' && globalPattern.test(key));
    for (const key of globalKeys) {
      try {
        globals[key] = safeSerialize(window[key], options.limits).value;
      } catch (error) {
        globals[key] = { __cgsc_error__: String(error) };
      }
    }

    const react = [];
    const candidates = document.querySelectorAll(
      '[data-message-author-role], [data-testid^="conversation-turn-"], article, main'
    );
    let elementIndex = 0;
    for (const element of candidates) {
      const keys = Reflect.ownKeys(element).filter((key) =>
        typeof key === 'string' && /^__react(Fiber|Props|Container)|^_reactRootContainer/.test(key)
      );
      if (!keys.length) continue;
      const entry = {
        index: elementIndex++,
        tagName: element.tagName,
        id: element.id || null,
        dataTestId: element.getAttribute('data-testid'),
        messageRole: element.getAttribute('data-message-author-role'),
        textSample: (element.innerText || element.textContent || '').slice(0, 1000),
        properties: {}
      };
      for (const key of keys) {
        try {
          entry.properties[key] = safeSerialize(element[key], options.limits).value;
        } catch (error) {
          entry.properties[key] = { __cgsc_error__: String(error) };
        }
      }
      react.push(entry);
    }

    return {
      capturedAt: now(),
      pageUrl: location.href,
      title: document.title,
      historyState: safeSerialize(history.state, options.limits),
      selectedGlobals: globals,
      selectedGlobalKeys: globalKeys,
      reactInternals: react,
      limitations: {
        note: 'JavaScript heap objects not reachable through selected globals or React-owned DOM properties are not enumerable through ordinary page JavaScript.',
        limits: options.limits || null
      }
    };
  }


  function installNetworkHooksOnce() {
    if (networkHooksInstalled) return;
    networkHooksInstalled = true;
    const installers = [
      ['fetch', installFetchHook],
      ['xhr', installXhrHook],
      ['websocket', installWebSocketHook],
      ['eventsource', installEventSourceHook],
      ['navigation', installNavigationHook]
    ];
    for (const [hook, install] of installers) {
      try {
        install();
      } catch (error) {
        emit('HOOK_ERROR', { hook, error: String(error), stack: error?.stack || null });
      }
    }
  }

  addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== BRIDGE_SOURCE) return;
    const message = event.data;
    if (message.type === 'INIT' && typeof message.token === 'string') {
      bridgeToken = message.token;
      flushPending();
      emit('READY', { pageUrl: location.href, installedAt: now() });
      return;
    }
    if (!bridgeToken || message.token !== bridgeToken) return;

    if (message.type === 'CONFIG') {
      captureConfig = {
        pageNetwork: Boolean(message.options?.pageNetwork),
        captureRuntime: Boolean(message.options?.captureRuntime)
      };
      if (captureConfig.pageNetwork) installNetworkHooksOnce();
      return;
    }

    if (message.type === 'CAPTURE_RUNTIME') {
      const commandId = message.commandId || randomId('runtime-command');
      Promise.resolve().then(() => {
        try {
          emit('RECORD', {
            id: commandId,
            kind: 'page-runtime-snapshot',
            capturedAt: now(),
            data: captureRuntimeSnapshot(message.options || {})
          });
          emit('COMMAND_RESULT', { commandId, ok: true });
        } catch (error) {
          emit('COMMAND_RESULT', {
            commandId,
            ok: false,
            error: String(error),
            stack: error?.stack || null
          });
        }
      });
    }
  });

})();
