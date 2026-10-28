(() => {
  'use strict';

  // Redaction applied to stored records unless the user enabled sensitive
  // capture. Conversation text is never rewritten; evidence data (network,
  // storage, runtime, debugger) is redacted by key, by URL parameter and by
  // token shape.

  const REDACTED = '[REDACTED BY CGSC: sensitive capture disabled]';
  const SENSITIVE_KEY_PATTERN = /(?:authorization|cookie|api[-_]?key|csrf|xsrf|oai[-_]?session[-_]?id|oai[-_]?device[-_]?id|device[-_]?id|deviceid|session[-_]?id|sessionid|session[-_]?token|access[-_]?token|refresh[-_]?token|id[-_]?token|auth[-_]?token|bearer|password|passwd|signature|credential|secret|jwt|(?:^|[-_])token(?:$|[-_]))/i;
  const SENSITIVE_URL_PARAM_PATTERN = /^(?:token|access_token|id_token|refresh_token|auth|authorization|session|session_id|signature|sig|key|api_key|secret|credential|policy|expires|x-amz-signature|x-amz-credential|x-amz-security-token|x-goog-signature|x-goog-credential)$/i;
  const URL_KEY_PATTERN = /url|href|src|uri/i;
  const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
  const BEARER_PATTERN = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{16,}/gi;
  const JSON_STRING_FIELD_PATTERN = /("([^"\\]{1,100})"\s*:\s*)"(?:[^"\\]|\\.)*"/g;
  // Keys of transcript records that hold evidence HTML and are redacted like evidence.
  const TRANSCRIPT_EVIDENCE_KEYS = new Set(['html', 'finalHtml']);

  // Returns the URL unchanged unless it carries a sensitive query parameter.
  function sanitizeUrl(url, includeSensitive) {
    if (includeSensitive || !url) return url;
    const raw = String(url);
    if (/^(?:blob|data|javascript):/i.test(raw)) return '[local-or-active-resource-omitted]';
    const htmlEncoded = raw.includes('&amp;');
    let parsed;
    try {
      parsed = new URL(htmlEncoded ? raw.replaceAll('&amp;', '&') : raw);
    } catch (_) {
      return raw;
    }
    const keys = [...new Set([...parsed.searchParams.keys()].filter((key) => SENSITIVE_URL_PARAM_PATTERN.test(key)))];
    if (!keys.length) return raw;
    for (const key of keys) parsed.searchParams.set(key, 'REDACTED');
    return htmlEncoded ? parsed.href.replaceAll('&', '&amp;') : parsed.href;
  }

  function sanitizeString(value, includeSensitive) {
    if (includeSensitive) return value;
    return String(value)
      .replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => {
        const trailing = candidate.match(/[),.;:!?]+$/)?.[0] || '';
        const core = trailing ? candidate.slice(0, -trailing.length) : candidate;
        return `${sanitizeUrl(core, false)}${trailing}`;
      })
      .replace(JWT_PATTERN, '[REDACTED JWT]')
      .replace(BEARER_PATTERN, '$1 [REDACTED]')
      .replace(JSON_STRING_FIELD_PATTERN, (match, prefix, key) => (SENSITIVE_KEY_PATTERN.test(key) ? `${prefix}"[REDACTED]"` : match));
  }

  function sanitizeHeaders(headers, includeSensitive) {
    if (!headers || typeof headers !== 'object' || includeSensitive) return headers;
    const output = {};
    for (const [key, value] of Object.entries(headers)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? REDACTED
        : (typeof value === 'string' ? sanitizeString(value, false) : sanitizeValue(value, false, key));
    }
    return output;
  }

  // mode 'evidence': every string is redacted.
  // mode 'transcript': URL fields and evidence HTML are redacted; message text
  // (finalText, finalMarkdown, reasoning text, ...) is preserved exactly.
  function sanitizeValue(value, includeSensitive, keyHint = '', seen = new WeakMap(), depth = 0, mode = 'evidence') {
    if (includeSensitive || value == null) return value;
    const key = String(keyHint);
    if (SENSITIVE_KEY_PATTERN.test(key)) return REDACTED;
    if (typeof value === 'string') {
      if (URL_KEY_PATTERN.test(key)) return sanitizeUrl(value, false);
      if (mode === 'transcript' && !TRANSCRIPT_EVIDENCE_KEYS.has(key)) return value;
      return sanitizeString(value, false);
    }
    if (typeof value !== 'object') return value;
    if (depth > 100) return '[CGSC sanitizer depth limit]';
    if (seen.has(value)) return seen.get(value);
    if (Array.isArray(value)) {
      const output = [];
      seen.set(value, output);
      // Array items inherit the key of the array (for example "steps" or "links").
      for (let index = 0; index < value.length; index += 1) {
        output.push(sanitizeValue(value[index], false, key, seen, depth + 1, mode));
      }
      return output;
    }
    const output = {};
    seen.set(value, output);
    for (const [childKey, item] of Object.entries(value)) {
      if (/^headers?$/i.test(childKey) && item && typeof item === 'object') output[childKey] = sanitizeHeaders(item, false);
      else output[childKey] = sanitizeValue(item, false, childKey, seen, depth + 1, mode);
    }
    return output;
  }

  globalThis.CgscSanitize = {
    REDACTED,
    SENSITIVE_KEY_PATTERN,
    SENSITIVE_URL_PARAM_PATTERN,
    sanitizeUrl,
    sanitizeString,
    sanitizeHeaders,
    sanitizeValue
  };
})();
