export const textEncoder = new TextEncoder();

export function sanitizeText(value, maxLength = 4000) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, maxLength);
}

export function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function clampInteger(value, min, max, fallback = min) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function clampNumber(value, min, max, fallback = min) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function utf8Bytes(value) {
  return textEncoder.encode(String(value ?? "")).byteLength;
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(String(value ?? "")));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function randomId(prefix = "id") {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function stableStringify(value) {
  const seen = new WeakSet();
  const normalize = (item) => {
    if (item === null || typeof item !== "object") return item;
    if (seen.has(item)) throw new TypeError("Cirkulär struktur kan inte serialiseras.");
    seen.add(item);
    if (Array.isArray(item)) {
      const result = item.map(normalize);
      seen.delete(item);
      return result;
    }
    const result = {};
    for (const key of Object.keys(item).sort()) {
      const normalized = normalize(item[key]);
      if (normalized !== undefined) result[key] = normalized;
    }
    seen.delete(item);
    return result;
  };
  return JSON.stringify(normalize(value));
}

export function isAllowedChatUrl(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === "https:" &&
      (parsed.hostname === "chatgpt.com" || parsed.hostname === "chat.openai.com");
  } catch {
    return false;
  }
}

export function isOpenAiAuthUrl(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === "https:" &&
      (parsed.hostname === "auth.openai.com" ||
       /\/(?:auth|login|signin)(?:\/|$)/i.test(parsed.pathname));
  } catch {
    return false;
  }
}

export function conversationKeyFromUrl(url) {
  try {
    const parsed = new URL(String(url));
    if (!isAllowedChatUrl(parsed.href)) return "";
    // Custom GPT conversations use /g/<gpt-id>/c/<conversation-id>.
    // The conversation id is the exact session locator and must win over the GPT id.
    const conversation = parsed.pathname.match(/\/c\/([^/?#]+)/i);
    if (conversation) return `${parsed.hostname}:c:${conversation[1]}`;
    const gpt = parsed.pathname.match(/\/g\/([^/?#]+)/i);
    if (gpt) return `${parsed.hostname}:g:${gpt[1]}`;
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    // A prepared root session may carry UI-only query parameters such as ?model=...
    // or ?temporary-chat=true. They are not conversation identity and must not block the
    // normal root -> /c/<id> promotion after the first submitted prompt.
    if (path === "/") return `${parsed.hostname}:/`;
    return `${parsed.hostname}:${path}${parsed.search}`;
  } catch {
    return "";
  }
}

export function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

export function boundedArray(value, maxItems) {
  return Array.isArray(value) ? value.slice(-maxItems) : [];
}

export function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}


export function headTailText(value, maxLength = 4000) {
  const text = String(value ?? "").replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim();
  const limit = Math.max(128, Number(maxLength) || 4000);
  if (text.length <= limit) return text;
  const marker = "\n\n[… middle omitted by deterministic head-tail compaction …]\n\n";
  const available = Math.max(0, limit - marker.length);
  const head = Math.floor(available * 0.42);
  const tail = available - head;
  return `${text.slice(0, head)}${marker}${text.slice(-tail)}`;
}
