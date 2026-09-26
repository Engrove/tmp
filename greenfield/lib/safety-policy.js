// Shared deterministic policy, loaded in the isolated content world and in
// the extension worker. No model-generated answer can grant permission.
//
// v1.7.3 retains the v1.7.0 semantic model gate and hardens it for mixed-language UI evidence. It deliberately evaluates semantic capability signals instead of exact
// marketing-name equality. Model family labels (Sol/Luna/Astra/...) are
// informational unless a future policy explicitly introduces a separate pin.
// The configured GPT number is a minimum version when the UI exposes one.
// Missing cosmetic model text is not, by itself, a stop condition.
(() => {
  const norm = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/[−–—]/g, "-").replace(/\s+/g, " ").trim();
  const semanticText = (value) => norm(value)
    // Swedish "nåla fast" means "pin", not English Fast reasoning. Remove
    // only the known UI action phrase; never globally discard the English
    // effort label "Fast".
    .replace(/\b(?:nåla|fäst)\s+fast\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const containsSemanticTerm = (value, alternatives) => new RegExp(
    `(?:^|[^\\p{L}\\p{N}_])(?:${alternatives})(?=$|[^\\p{L}\\p{N}_])`,
    "iu"
  ).test(semanticText(value));
  const defaults = Object.freeze({
    requiredModel: "GPT-5.6", minimumEffort: "extended",
    messages3h: 24, messages24h: 96, messages7d: 400,
    tokens24h: 800000, minGapSeconds: 180,
    maxPromptTokens: 24000, outputReserveTokens: 8192
  });
  const ranks = { extended: 2, heavy: 3, max: 3 };

  function modelVersion(text) {
    const s = norm(text);
    // Require a token boundary after the complete numeric version so labels
    // such as GPT-5.6x are not silently accepted as GPT-5.6.
    const m = s.match(/(?:^|\b)gpt[- ]?(\d+(?:\.\d+){0,3})(?![\d.a-z-])/iu);
    if (!m) return null;
    const parts = m[1].split(".").map(Number);
    if (!parts.length || parts.some(n => !Number.isSafeInteger(n) || n < 0)) return null;
    return { text: m[1], parts };
  }

  function compareVersions(a, b) {
    const ap = Array.isArray(a?.parts) ? a.parts : [];
    const bp = Array.isArray(b?.parts) ? b.parts : [];
    const n = Math.max(ap.length, bp.length);
    for (let i = 0; i < n; i += 1) {
      const av = Number(ap[i] || 0), bv = Number(bp[i] || 0);
      if (av > bv) return 1;
      if (av < bv) return -1;
    }
    return 0;
  }

  function degradedModelSignal(text) {
    return containsSemanticTerm(text, "auto|automatic|automatiskt?|instant|mini|nano|fast|snabb|nopea|quick|fallback");
  }

  function normalizePolicy(value = {}) {
    const out = { ...defaults };
    const model = String(value.requiredModel ?? defaults.requiredModel).trim();
    // Family/marketing suffixes are accepted syntactically but are not a
    // capability gate. The numeric GPT version is the compatibility floor.
    if (!/^GPT[- ]\d+(?:\.\d+){0,3}(?:\s+[A-Za-z0-9_-]+){0,3}$/i.test(model) || !modelVersion(model) || degradedModelSignal(model)) {
      throw new Error("SAFETY_MODEL_POLICY_INVALID");
    }
    out.requiredModel = model.replace(/^GPT /i, "GPT-");
    if (value.minimumEffort != null && !Object.hasOwn(ranks, value.minimumEffort)) throw new Error("SAFETY_EFFORT_POLICY_INVALID");
    out.minimumEffort = value.minimumEffort || defaults.minimumEffort;
    for (const [key, min, max] of [
      ["messages3h", 1, 1000], ["messages24h", 1, 5000], ["messages7d", 1, 10000],
      ["tokens24h", 10000, 50000000], ["minGapSeconds", 10, 86400],
      ["maxPromptTokens", 1000, 100000], ["outputReserveTokens", 1024, 100000]
    ]) {
      const n = Number(value[key] ?? defaults[key]);
      if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`SAFETY_POLICY_INVALID:${key}`);
      out[key] = n;
    }
    return out;
  }

  function effort(text) {
    const s = semanticText(text);
    if (!s) return -1;
    // English, Swedish and Finnish are all expected in the same runtime.
    // Rank exact semantic words/phrases only after known non-effort UI action
    // phrases have been removed.
    if (containsSemanticTerm(s, "light|standard|low|medium|snabb|lätt|nopea|kevyt|vakio|normaali|instant|quick|fast|normal")) return 0;
    // v1.8.6: ChatGPT's model picker shows the thinking level as text
    // ("Extra hög" observed 2026-09-26). Extra high = the top level (Heavy);
    // High = Extended. Checked in this order so "extra hög" never ranks as "hög".
    if (containsSemanticTerm(s, "heavy|max|maximum|maximal|tung|raskas|djupgående|djup|deep|deeper|deepest|intensive|intensiv|syvä|syvällinen|extra hög|extra high|extra-high|xhigh")) return 3;
    if (containsSemanticTerm(s, "extended|utökad|utökat|förlängd|laajennettu|pidennetty|longer|fördjupad|hög|high")) return 2;
    return -1;
  }

  function reasoningSignal(text) {
    const s = semanticText(text);
    return containsSemanticTerm(s, "thinking|reasoning|tänkande|tänketid|tänknivå|ajattelu|ajatteluaika|päättely|päättelytaso|reasoning effort|thinking time|extended|utökad|utökat|förlängd|laajennettu|pidennetty|heavy|max|maximum|maximal|djupgående|djup|deep|deeper|intensiv|syvä|syvällinen");
  }

  function evaluateModel(evidence, policy = defaults, { now = Date.now(), url = "", gptRoot = "" } = {}) {
    const deny = (code) => ({
      allowed: false, code,
      model: evidence?.modelLabel || "",
      effort: evidence?.effortLabel || "",
      observedAtMs: evidence?.observedAtMs || 0
    });
    if (!evidence || !["CHATGPT_UI_CONTROLS_V1","CHATGPT_UI_CONTROLS_V2"].includes(evidence.source)) return deny("MODEL_EVIDENCE_MISSING");
    if (!Number.isFinite(evidence.observedAtMs) || now - evidence.observedAtMs > 15000 || now < evidence.observedAtMs - 1000) return deny("MODEL_EVIDENCE_STALE");

    let target, root;
    try { target = new URL(url); root = new URL(gptRoot); } catch { return deny("EIC_SURFACE_UNVERIFIED"); }
    if (target.protocol !== "https:" || !["chatgpt.com", "chat.openai.com"].includes(target.hostname) ||
        target.origin !== root.origin || !/^\/g\/g-[^/]+/.test(root.pathname) ||
        !(target.pathname === root.pathname.replace(/\/$/, "") || target.pathname.startsWith(root.pathname.replace(/\/$/, "") + "/"))) return deny("EIC_SURFACE_UNVERIFIED");
    if (evidence.mode === "WORK" || evidence.mode === "CODEX") return deny("CHAT_MODE_REQUIRED");
    if (evidence.blockingUi) return deny("BLOCKING_CHATGPT_UI");
    if (evidence.quota?.active) return deny("PROVIDER_QUOTA_OR_FALLBACK");

    if (evidence.ambiguous) {
      return deny(evidence.ambiguityKind === "effort" ? "THINKING_EFFORT_UNKNOWN" : "MODEL_IDENTITY_UNKNOWN");
    }

    const label = norm(evidence.modelLabel);
    const effortLabel = norm(evidence.effortLabel);
    if (degradedModelSignal(label)) return deny("MODEL_DEGRADED");

    const requiredVersion = modelVersion(policy.requiredModel);
    if (!requiredVersion) return deny("MODEL_POLICY_INVALID");
    const observedVersion = modelVersion(label);

    // If the UI exposes an explicit GPT token but its numeric form cannot be
    // parsed, fail closed. If the UI exposes no model name at all, capability
    // can still be established from the correct EIC surface + reasoning UI.
    if (label && /\bgpt(?:[- ]?\d)?\b/iu.test(label) && !observedVersion) return deny("MODEL_IDENTITY_UNKNOWN");
    if (observedVersion && compareVersions(observedVersion, requiredVersion) < 0) return deny("MODEL_VERSION_MISMATCH");

    const structuralReasoning = evidence.reasoningControlSeen === true || evidence.effortControlSeen === true;
    const reasoningSeen = structuralReasoning || reasoningSignal(effortLabel) || /\b(thinking|reasoning|tänkande)\b/iu.test(label);
    if (!reasoningSeen) return deny("THINKING_MODE_UNVERIFIED");

    let observedEffort = effort(effortLabel);
    let effortAssurance = "NAMED_EFFORT";
    if (observedEffort < 0) {
      // A positively identified reasoning control is stronger than an unknown
      // cosmetic label. For the default Extended floor it is accepted as an
      // unranked deep-reasoning control. Heavy remains strict unless the label
      // can be semantically ranked at Heavy/Max/Deep level.
      if (structuralReasoning && ranks[policy.minimumEffort] <= ranks.extended) {
        observedEffort = ranks.extended;
        effortAssurance = "REASONING_CONTROL_UNRANKED";
      } else {
        return deny("THINKING_EFFORT_UNKNOWN");
      }
    }
    if (observedEffort < ranks[policy.minimumEffort]) return deny("THINKING_EFFORT_TOO_LOW");

    const explicitModelVersion = Boolean(observedVersion);
    const explicitEffortRank = effortAssurance === "NAMED_EFFORT";
    const fullyNamed = explicitModelVersion && explicitEffortRank;
    return {
      allowed: true,
      code: fullyNamed ? "UI_MODEL_VERIFIED" : "UI_MODEL_COMPATIBLE",
      model: evidence.modelLabel || "",
      effort: evidence.effortLabel || "",
      observedAtMs: evidence.observedAtMs,
      assurance: explicitModelVersion ? "VISIBLE_UI_COMPATIBLE_VERSION" : "VISIBLE_REASONING_CONTROL_MODEL_NAME_UNEXPOSED",
      effortAssurance,
      observedModelVersion: observedVersion?.text || "",
      minimumModelVersion: requiredVersion.text,
      modelNamePolicy: "NUMERIC_MINIMUM_FAMILY_AGNOSTIC",
      visibleUiOnly: true
    };
  }

  function quotaSignal(text) {
    const s = norm(text);
    return /(?:you(?:'|’)ve|you have).{0,30}(?:reached|hit).{0,50}(?:limit|cap)|(?:usage|message|thinking|gpt[- ]?\d).{0,45}(?:limit reached|limit hit|limit resets)|(?:nått|uppnått).{0,50}(?:gräns|gränsen|begränsning)|(?:användningsgräns|meddelandegräns).{0,25}(?:nådd|nåtts)|(?:käyttöraja|viestiraja|raja on saavutettu)|(?:responses|svar).{0,35}(?:use|using|använd).{0,30}(?:another|different|annan).{0,15}(?:model|modell)|(?:switch|byta|växla).{0,30}(?:mini|instant)|(?:thinking|gpt[- ]?\d).{0,35}(?:unavailable|not available|inte tillgänglig)/iu.test(s);
  }

  function resetTime(text, now = Date.now(), dateTime = "") {
    // HH:MM by itself has no date/timezone. Do not guess tomorrow/today.
    if (dateTime && /^\d{4}-\d\d-\d\dT\d\d:\d\d.*(?:Z|[+-]\d\d:\d\d)$/i.test(dateTime)) {
      const t = Date.parse(dateTime);
      if (Number.isFinite(t) && t > now && t < now + 31 * 86400000) return { atMs: t + 60000, confidence: "EXPLICIT_DATETIME" };
    }
    const match = norm(text).match(/(?:try again in|resets in|försök igen om|återställs om)\s+(\d+)\s*(minutes?|minuter?|hours?|timmar?)/u);
    if (match) {
      const delay = Number(match[1]) * (/hour|tim/u.test(match[2]) ? 3600000 : 60000);
      if (delay > 0 && delay <= 7 * 86400000) return { atMs: now + delay + 60000, confidence: "RELATIVE_DURATION" };
    }
    return { atMs: null, confidence: "UNKNOWN_DATE_OR_TIMEZONE" };
  }

  function estimateTokens(text) {
    const bytes = new TextEncoder().encode(String(text || "")).length;
    return { estimate: Math.ceil(bytes / 3), bytes, method: "UTF8_BYTES_DIV_3_ESTIMATE", exact: false };
  }

  globalThis.GreenfieldSafetyPolicy = Object.freeze({
    defaults, normalizePolicy, evaluateModel, quotaSignal, resetTime, estimateTokens,
    effort, modelVersion, compareVersions, reasoningSignal, degradedModelSignal
  });
})();
