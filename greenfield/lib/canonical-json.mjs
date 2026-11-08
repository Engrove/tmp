// This is Greenfield's sorted-key JSON codec, not RFC 8785. Arrays retain their
// order; strings and primitive values retain JSON semantics. Object insertion
// order is never evidence across Chrome storage or extension messaging.
export function canonicalJson(value) {
  const json = JSON.parse(JSON.stringify(value));
  const encode = v => Array.isArray(v) ? `[${v.map(encode).join(",")}]`
    : v !== null && typeof v === "object"
      ? `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${encode(v[k])}`).join(",")}}`
      : JSON.stringify(v);
  return encode(json);
}
// Optional fields occur at the owner fences. Absence is distinct from null;
// every defined JSON value still compares all fields and preserves array order.
export const jsonEqual = (a,b) => a === undefined || b === undefined
  ? a === b : canonicalJson(a) === canonicalJson(b);
