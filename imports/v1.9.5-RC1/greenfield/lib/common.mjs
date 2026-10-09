export function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

export function randomId(prefix = "id") {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function text(value, max = 120000) {
  return String(value ?? "").slice(0, max);
}

export function normalizeText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value ?? ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function errorRecord(error) {
  return {
    name: String(error?.name || "Error"),
    message: String(error?.message || error || "Unknown error").slice(0, 4000),
    code: String(error?.code || "").slice(0, 200),
    stack: String(error?.stack || "").slice(0, 12000)
  };
}

export function bounded(value, max = 120000, seen = new WeakSet()) {
  if (typeof value === "string") return value.slice(0, max);
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (typeof value === "symbol" || typeof value === "bigint") return String(value);
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => bounded(item, max, seen));
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (value instanceof Error) return errorRecord(value);
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 200)) out[key] = bounded(item, max, seen);
    return out;
  }
  return value;
}
