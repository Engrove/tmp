// GFW v2 identities are read as a whole. Allocation and old-to-new registry
// migration belong to the canonical owner, never to this browser parser.
const TOKEN = /\bGF-[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*/i;
const TAGGED = /\bGf\s*:\s*([A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*)/i;

export function isGfwIdentity(value) {
  const key = String(value || "").toUpperCase();
  return /^GF-\d+\.\d+\.[1-9]\d{3,}$/.test(key) ||
    /^GF-[A-Z0-9_-]*\d[A-Z0-9_-]*$/.test(key);
}

export function gfwIdentityInText(value) {
  const source = String(value || "");
  const tagged = source.match(TAGGED);
  const candidate = (tagged ? tagged[1] : source.match(TOKEN)?.[0] || "").toUpperCase();
  return isGfwIdentity(candidate) ? candidate : "";
}
