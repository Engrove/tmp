import { text, nowIso } from "./common.mjs";

export const PROGRESS_LEDGER_SCHEMA = "eic.greenfield.progress-ledger.v1";
export const PROGRESS_CAPSULE_SCHEMA = "eic.greenfield.progress.v1";
export const PROGRESS_ALERT = Object.freeze({ NONE: "NONE", CHANGE_ROUTE: "CHANGE_ROUTE", STRATEGY_SWITCH: "STRATEGY_SWITCH", OPERATOR_REQUIRED: "OPERATOR_REQUIRED" });
export const TURN_VERDICT = Object.freeze({ ADVANCED: "ADVANCED", PLANNED: "PLANNED", CHURN: "CHURN", BLOCKED: "BLOCKED" });
export const STAGE_STATE = Object.freeze({ PENDING: "PENDING", ACTIVE: "ACTIVE", DONE: "DONE", BLOCKED: "BLOCKED", DROPPED: "DROPPED" });
export const PROGRESS_LIMITS = Object.freeze({
  maxStages: 12, maxDeadEnds: 20, maxEvidence: 24, maxLimitations: 12,
  maxTurnLog: 40, maxSeenIds: 400, maxTurnsPerStage: 6, maxSideFindings: 10, capsuleMaxChars: 6000
});

// Calibrated on captured legacy sessions (see scratchpad calibration, not committed).
export const BLOCKER_REPEAT_THRESHOLD = 0.30;
export const LEGACY_MIN_NEW_IDS = 1;

const ALERT_ORDER = [PROGRESS_ALERT.NONE, PROGRESS_ALERT.CHANGE_ROUTE, PROGRESS_ALERT.STRATEGY_SWITCH, PROGRESS_ALERT.OPERATOR_REQUIRED];
export function alertRank(alert) {
  const i = ALERT_ORDER.indexOf(alert);
  return i < 0 ? 0 : i;
}

const str = (v, ...a) => text(typeof v === "string" || typeof v === "number" ? v : "", ...a);
const int = (v, max = 1_000_000) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
const arr = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const strList = (v, n, max) => arr(v).filter((x) => typeof x === "string" && x.trim()).slice(0, n).map((x) => text(x, max));
const clone = (v) => JSON.parse(JSON.stringify(v));
const normKey = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const iso = (v, fallback) => (typeof v === "string" && v && !Number.isNaN(Date.parse(v)) ? v : fallback);

export const PROGRESS_DOCTRINE = "PROGRESS CONTRACT. Every operative turn must end with at least one new verifiable delta for the current stage: a commit, an executed test with exit code, a created artifact, an executed and read-back effect, a stage acceptance observed, a route eliminated with evidence, or a concrete operator request. Re-reading unchanged state, re-verifying accepted evidence and rewriting an unchanged checkpoint are not deltas. Stagnation is a defect of the same weight as a false claim. Never repeat an attempt listed in deadEnds unless you name the changed input. If no stages exist, return progress.plan (3-8 dependency-ordered stages with observable acceptance). Report stage completion with progress.stageUpdate. When the current route is blocked by a missing capability, permission, credential or file, switch to an independent stage or return progress.operatorRequest; do not keep probing.";

const STAGE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["id", "title", "deliverable", "acceptance"],
  properties: {
    id: { type: "string" }, title: { type: "string" }, deliverable: { type: "string" },
    acceptance: { type: "string" }, needsOperator: { type: "boolean" }
  }
};
export const PROGRESS_RESPONSE_JSON_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    delta: { type: "array", maxItems: 12, items: { type: "string", maxLength: 600 } },
    stageUpdate: {
      type: "object", additionalProperties: false, required: ["id", "state"],
      properties: {
        id: { type: "string" }, state: { type: "string", enum: ["DONE", "IN_PROGRESS", "BLOCKED"] },
        evidence: { type: "array", maxItems: 8, items: { type: "string", maxLength: 600 } }
      }
    },
    plan: { type: "array", maxItems: 12, items: STAGE_SCHEMA },
    planChange: {
      type: "object", additionalProperties: false, required: ["reason", "stages"],
      properties: { reason: { type: "string" }, stages: { type: "array", maxItems: 12, items: STAGE_SCHEMA } }
    },
    deadEnds: {
      type: "array", maxItems: 8,
      items: { type: "object", additionalProperties: false, properties: { route: { type: "string" }, reason: { type: "string" } } }
    },
    knownLimitations: {
      type: "array", maxItems: 6,
      items: { type: "object", additionalProperties: false, properties: { surface: { type: "string" }, code: { type: "string" } } }
    },
    operatorRequest: {
      type: "object", additionalProperties: false, required: ["ask"],
      properties: {
        ask: { type: "string" }, why: { type: "string" }, then: { type: "string" },
        options: { type: "array", maxItems: 6, items: { type: "string" } }
      }
    },
    sideFindings: { type: "array", maxItems: 6, items: { type: "string", maxLength: 400 } }
  }
};

// ---------------------------------------------------------------- identifiers

const STOPWORDS = new Set(("this that with from have been only remains remain current currently which would could into their there " +
  "these those after before until without other independent authorized owner owners verified blocker restricted still also does must " +
  "cannot will such then than when where while work").split(" "));

export function extractIdentifiers(strings) {
  const out = [];
  const seen = new Set();
  const add = (id) => { if (!seen.has(id)) { seen.add(id); out.push(id); } };
  for (const raw of arr(strings)) {
    if (typeof raw !== "string" || !raw) continue;
    const s = raw.slice(0, 20000);
    const found = [];
    for (const m of s.matchAll(/(?<![0-9a-z])[0-9a-f]{12,64}(?![0-9a-z])/gi)) found.push([m.index, m[0].toLowerCase()]);
    for (const m of s.matchAll(/\bA(\d{4,})\b/g)) found.push([m.index, `A${m[1]}`]);
    for (const m of s.matchAll(/\bartifact\s*#?(\d{3,})\b/gi)) found.push([m.index, `A${m[1]}`]);
    found.sort((a, b) => a[0] - b[0]);
    for (const [, id] of found) add(id);
  }
  return out;
}

function stripIdentifiers(s) {
  return String(s)
    .replace(/(?<![0-9a-z])[0-9a-f]{12,64}(?![0-9a-z])/gi, " ")
    .replace(/\bA\d{4,}\b/g, " ")
    .replace(/\bartifact\s*#?\d{3,}\b/gi, " ");
}

export function blockerTokens(blockers) {
  const set = new Set();
  for (const b of arr(blockers)) {
    if (typeof b !== "string") continue;
    const cleaned = stripIdentifiers(b.slice(0, 5000).replace(/^\s*blocker:\s*/i, "")).toLowerCase().replace(/\d+/g, " ");
    for (const tok of cleaned.split(/[^a-z]+/)) if (tok.length >= 4 && !STOPWORDS.has(tok)) set.add(tok);
  }
  return [...set].sort();
}

export function jaccard(a, b) {
  const A = new Set(arr(a)); const B = new Set(arr(b));
  if (!A.size && !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// ---------------------------------------------------------------- keys / ledger

export function progressMissionKey(process) {
  const saved = process?.queueContext?.savedMissionId;
  if (typeof saved === "string" && saved.trim()) return saved.trim();
  const m = typeof process?.goal === "string" ? process.goal.match(/GF-\d+\.\d+\.\d+/) : null;
  if (m) return `gfw:${m[0]}`;
  const pid = process?.processId;
  if (pid !== undefined && pid !== null && String(pid)) return `process:${pid}`;
  return "";
}

const emptyCounters = () => ({ turns: 0, advanced: 0, churn: 0, blocked: 0, churnStreak: 0, blockerRepeat: 0, stagesDone: 0 });

export function createProgressLedger({ missionKey, now = Date.now() } = {}) {
  if (typeof missionKey !== "string" || !missionKey.trim()) throw new Error("PROGRESS_MISSION_KEY_REQUIRED");
  const at = nowIso(now);
  return {
    schema: PROGRESS_LEDGER_SCHEMA, missionKey: text(missionKey.trim(), 300), createdAt: at, updatedAt: at,
    stages: [], currentStageId: "", acceptedEvidence: [], deadEnds: [], knownLimitations: [], sideFindings: [],
    seenIds: [], lastHandoff: "", lastBlockerTokens: [], turnLog: [], counters: emptyCounters(),
    alert: PROGRESS_ALERT.NONE, alertReason: "", alertSince: "", operatorRequest: null
  };
}

function normStage(s, fallbackState = STAGE_STATE.PENDING) {
  if (!isObj(s)) return null;
  const title = str(s.title, 200).trim();
  if (!title) return null;
  const state = Object.values(STAGE_STATE).includes(s.state) ? s.state : fallbackState;
  return {
    id: str(s.id, 60).trim(), title, deliverable: str(s.deliverable, 600), acceptance: str(s.acceptance, 600),
    state, needsOperator: s.needsOperator === true, evidence: strList(s.evidence, 8, 600),
    turnsSpent: int(s.turnsSpent, 10000), doneAt: str(s.doneAt, 40)
  };
}

function dedupeStages(list) {
  const used = new Set();
  const out = [];
  for (const st of list) {
    let id = st.id;
    if (!id || used.has(id)) {
      let n = out.length + 1;
      while (used.has(`S${n}`)) n++;
      id = `S${n}`;
    }
    used.add(id);
    out.push({ ...st, id });
  }
  return out;
}

function pickCurrent(stages) {
  const open = stages.find((s) => s.state !== STAGE_STATE.DONE && s.state !== STAGE_STATE.DROPPED && s.state !== STAGE_STATE.BLOCKED);
  if (open) return open.id;
  return stages.find((s) => s.state === STAGE_STATE.BLOCKED)?.id || "";
}

function normOperatorRequest(r) {
  if (!isObj(r)) return null;
  const status = ["OPEN", "ANSWERED", "CANCELLED"].includes(r.status) ? r.status : "OPEN";
  return {
    requestId: str(r.requestId, 200), ask: str(r.ask, 1000), why: str(r.why, 1000), then: str(r.then, 1000),
    options: strList(r.options, 6, 300), source: ["AI", "GREENFIELD", "OPERATOR"].includes(r.source) ? r.source : "GREENFIELD",
    status, createdAt: str(r.createdAt, 40), turn: int(r.turn, 100000), answer: str(r.answer, 4000), answeredAt: str(r.answeredAt, 40)
  };
}

function capNewest(list, n) { return list.length > n ? list.slice(list.length - n) : list; }

export function normalizeProgressLedger(value, { missionKey, now = Date.now() } = {}) {
  const fresh = () => createProgressLedger({ missionKey, now });
  if (!isObj(value) || value.schema !== PROGRESS_LEDGER_SCHEMA) return fresh();
  if (typeof value.missionKey !== "string" || !value.missionKey || (missionKey !== undefined && value.missionKey !== missionKey)) return fresh();
  const base = createProgressLedger({ missionKey: value.missionKey, now });
  const stages = dedupeStages(arr(value.stages).map((s) => normStage(s)).filter(Boolean).slice(0, PROGRESS_LIMITS.maxStages));
  const dead = [];
  for (const d of arr(value.deadEnds)) {
    if (!isObj(d) || !str(d.route).trim()) continue;
    const k = normKey(d.route);
    if (dead.some((x) => normKey(x.route) === k)) continue;
    dead.push({ route: str(d.route, 400), reason: str(d.reason, 400), turn: int(d.turn, 100000), at: str(d.at, 40) });
  }
  const lims = [];
  for (const l of arr(value.knownLimitations)) {
    if (!isObj(l) || !str(l.code).trim()) continue;
    const surface = str(l.surface, 80) || "UNKNOWN"; const code = str(l.code, 120);
    if (lims.some((x) => x.surface === surface && x.code === code)) continue;
    lims.push({ surface, code, turn: int(l.turn, 100000), at: str(l.at, 40) });
  }
  const c = isObj(value.counters) ? value.counters : {};
  return {
    ...base,
    createdAt: iso(value.createdAt, base.createdAt), updatedAt: iso(value.updatedAt, base.updatedAt),
    stages, currentStageId: pickCurrent(stages),
    acceptedEvidence: capNewest(arr(value.acceptedEvidence).filter((e) => isObj(e) && str(e.ref)).map((e) => ({
      ref: str(e.ref, 600), stageId: str(e.stageId, 60), turn: int(e.turn, 100000), at: str(e.at, 40)
    })), PROGRESS_LIMITS.maxEvidence),
    deadEnds: capNewest(dead, PROGRESS_LIMITS.maxDeadEnds),
    knownLimitations: capNewest(lims, PROGRESS_LIMITS.maxLimitations),
    sideFindings: capNewest(arr(value.sideFindings).filter((s) => isObj(s) && str(s.text)).map((s) => ({ text: str(s.text, 400), turn: int(s.turn, 100000) })), PROGRESS_LIMITS.maxSideFindings),
    seenIds: capNewest([...new Set(arr(value.seenIds).filter((x) => typeof x === "string" && x).map((x) => text(x, 120)))], PROGRESS_LIMITS.maxSeenIds),
    lastHandoff: str(value.lastHandoff, 2000),
    lastBlockerTokens: strList(value.lastBlockerTokens, 200, 60),
    turnLog: capNewest(arr(value.turnLog).filter(isObj).map((t) => ({
      turn: int(t.turn, 100000), at: str(t.at, 40), verdict: Object.values(TURN_VERDICT).includes(t.verdict) ? t.verdict : TURN_VERDICT.CHURN,
      stageId: str(t.stageId, 60), newIds: int(t.newIds), deltaCount: int(t.deltaCount),
      blockerSimilarity: Math.max(0, Math.min(1, Number(t.blockerSimilarity) || 0)), reasons: strList(t.reasons, 10, 200)
    })), PROGRESS_LIMITS.maxTurnLog),
    counters: {
      turns: int(c.turns), advanced: int(c.advanced), churn: int(c.churn), blocked: int(c.blocked),
      churnStreak: int(c.churnStreak), blockerRepeat: int(c.blockerRepeat), stagesDone: int(c.stagesDone)
    },
    alert: ALERT_ORDER.includes(value.alert) ? value.alert : PROGRESS_ALERT.NONE,
    alertReason: str(value.alertReason, 200), alertSince: iso(value.alertSince, ""),
    operatorRequest: normOperatorRequest(value.operatorRequest)
  };
}

// ---------------------------------------------------------------- response parsing

export function parseResponseProgress(targetResponse) {
  const raw = isObj(targetResponse) ? targetResponse.progress : undefined;
  if (raw === undefined || raw === null) return null;
  const out = {
    delta: [], stageUpdate: null, plan: null, planChange: null, deadEnds: [], knownLimitations: [],
    operatorRequest: null, sideFindings: [], errors: []
  };
  if (!isObj(raw)) { out.errors.push("progress is not an object"); return out; }
  if (raw.delta !== undefined) {
    if (Array.isArray(raw.delta)) out.delta = strList(raw.delta, 12, 600); else out.errors.push("delta is not an array");
  }
  const stageList = (list, label) => {
    if (!Array.isArray(list)) { out.errors.push(`${label} is not an array`); return null; }
    const stages = list.slice(0, PROGRESS_LIMITS.maxStages).map((s) => {
      const n = normStage({ ...(isObj(s) ? s : {}), state: undefined, evidence: undefined, turnsSpent: 0 });
      if (!n) out.errors.push(`${label} entry without title`);
      return n;
    }).filter(Boolean);
    return stages.length ? dedupeStages(stages) : null;
  };
  if (raw.stageUpdate !== undefined) {
    const u = raw.stageUpdate;
    if (!isObj(u) || !str(u.id).trim()) out.errors.push("stageUpdate requires id");
    else if (!["DONE", "IN_PROGRESS", "BLOCKED"].includes(u.state)) out.errors.push("stageUpdate.state invalid");
    else out.stageUpdate = { id: str(u.id, 60).trim(), state: u.state, evidence: strList(u.evidence, 8, 600) };
  }
  if (raw.plan !== undefined) out.plan = stageList(raw.plan, "plan");
  if (raw.planChange !== undefined) {
    const p = raw.planChange;
    if (!isObj(p) || !str(p.reason).trim()) out.errors.push("planChange requires reason");
    else {
      const stages = stageList(p.stages, "planChange.stages");
      if (stages) out.planChange = { reason: str(p.reason, 400), stages };
    }
  }
  if (raw.deadEnds !== undefined) {
    if (Array.isArray(raw.deadEnds)) {
      out.deadEnds = raw.deadEnds.slice(0, 8).filter((d) => isObj(d) && str(d.route).trim()).map((d) => ({ route: str(d.route, 400), reason: str(d.reason, 400) }));
    } else out.errors.push("deadEnds is not an array");
  }
  if (raw.knownLimitations !== undefined) {
    if (Array.isArray(raw.knownLimitations)) {
      out.knownLimitations = raw.knownLimitations.slice(0, 6).filter((l) => isObj(l) && str(l.code).trim())
        .map((l) => ({ surface: str(l.surface, 80) || "UNKNOWN", code: str(l.code, 120) }));
    } else out.errors.push("knownLimitations is not an array");
  }
  if (raw.operatorRequest !== undefined) {
    const r = raw.operatorRequest;
    if (!isObj(r) || !str(r.ask).trim()) out.errors.push("operatorRequest requires ask");
    else out.operatorRequest = { ask: str(r.ask, 1000), why: str(r.why, 1000), then: str(r.then, 1000), options: strList(r.options, 6, 300) };
  }
  if (raw.sideFindings !== undefined) {
    if (Array.isArray(raw.sideFindings)) out.sideFindings = strList(raw.sideFindings, 6, 400); else out.errors.push("sideFindings is not an array");
  }
  return out;
}

// ---------------------------------------------------------------- classification

function responseTexts(r, progress) {
  return [
    ...strList(r?.evidence, 100, 4000), ...strList(r?.workPerformed, 100, 4000), str(r?.summary, 8000),
    ...(progress?.delta || []), ...(progress?.stageUpdate?.evidence || [])
  ];
}

export function classifyTurn(ledger, { targetResponse = null } = {}) {
  const r = isObj(targetResponse) ? targetResponse : null;
  const progress = parseResponseProgress(r);
  const seen = new Set(arr(ledger?.seenIds));
  const newIds = extractIdentifiers(responseTexts(r, progress)).filter((id) => !seen.has(id));
  const blockers = strList(r?.blockers, 50, 4000);
  const hasBlockers = blockers.length > 0 || r?.status === "BLOCKED";
  const tokens = blockerTokens(blockers);
  const last = arr(ledger?.lastBlockerTokens);
  const blockerSimilarity = tokens.length && last.length ? jaccard(tokens, last) : 0;
  const blockerRepeated = hasBlockers && last.length > 0 && blockerSimilarity >= BLOCKER_REPEAT_THRESHOLD;
  const upd = progress?.stageUpdate;
  const stageDone = Boolean(upd && upd.state === "DONE" && upd.evidence.length > 0 &&
    arr(ledger?.stages).some((s) => s.id === upd.id && s.state !== STAGE_STATE.DONE));
  const deltaCount = progress?.delta.length || 0;
  const base = { newIds, deltaCount, stageDone, blockerSimilarity, blockerRepeated, hasBlockers, operatorRequest: progress?.operatorRequest || null };
  const done = (verdict, reason) => ({ verdict, ...base, reasons: [reason] });
  if (!r) return done(TURN_VERDICT.CHURN, "NO_STRUCTURED_RESPONSE");
  if (progress?.operatorRequest) return done(TURN_VERDICT.BLOCKED, "OPERATOR_REQUEST");
  if (r.status === "BLOCKED") return done(TURN_VERDICT.BLOCKED, "STATUS_BLOCKED");
  if (stageDone) return done(TURN_VERDICT.ADVANCED, "STAGE_DONE");
  if (progress?.plan && arr(ledger?.stages).length === 0) return done(TURN_VERDICT.PLANNED, "PLAN_ACCEPTED");
  if (progress) {
    if (deltaCount >= 1 && newIds.length >= 1) return done(TURN_VERDICT.ADVANCED, "REPORTED_DELTA_WITH_NEW_IDS");
    if (deltaCount >= 1) {
      return blockerRepeated
        ? done(TURN_VERDICT.CHURN, "DELTA_WITHOUT_NEW_EVIDENCE_UNDER_REPEATED_BLOCKER")
        : done(TURN_VERDICT.ADVANCED, "REPORTED_DELTA");
    }
    return done(TURN_VERDICT.CHURN, "NO_DELTA_REPORTED");
  }
  return newIds.length >= LEGACY_MIN_NEW_IDS
    ? done(TURN_VERDICT.ADVANCED, "NEW_EVIDENCE_IDS")
    : done(TURN_VERDICT.CHURN, "NO_NEW_EVIDENCE_IDS");
}

// ---------------------------------------------------------------- apply

function mergeDeadEnds(list, adds, turn, at) {
  const out = list.slice();
  for (const d of adds) {
    const k = normKey(d.route);
    if (!k || out.some((x) => normKey(x.route) === k)) continue;
    out.push({ route: str(d.route, 400), reason: str(d.reason, 400), turn, at });
  }
  return capNewest(out, PROGRESS_LIMITS.maxDeadEnds);
}

function mergeLimitations(list, adds, turn, at) {
  const out = list.slice();
  for (const l of adds) {
    if (out.some((x) => x.surface === l.surface && x.code === l.code)) continue;
    out.push({ surface: l.surface, code: l.code, turn, at });
  }
  return capNewest(out, PROGRESS_LIMITS.maxLimitations);
}

function detectLimitations(r) {
  const hay = [str(r?.summary, 8000), ...strList(r?.workPerformed, 100, 4000), ...strList(r?.evidence, 100, 4000), ...strList(r?.blockers, 50, 4000)].join("\n");
  const out = [];
  if (hay.includes("aik_trusted_session_required")) out.push({ surface: "AIK", code: "aik_trusted_session_required" });
  for (const m of hay.matchAll(/\b[a-z]+(?:_[a-z]+){2,}_required\b/g)) {
    if (m[0] === "aik_trusted_session_required") continue;
    if (!out.some((x) => x.code === m[0])) out.push({ surface: "UNKNOWN", code: m[0] });
    if (out.length >= 6) break;
  }
  return out;
}

function sanitizeId(s) { return String(s).replace(/[^A-Za-z0-9_.:-]+/g, "_").slice(0, 200); }

function computeAlert(L, cls, stageBudgetStage) {
  const c = L.counters;
  const cands = [];
  if (cls.operatorRequest) cands.push([PROGRESS_ALERT.OPERATOR_REQUIRED, "AI_OPERATOR_REQUEST"]);
  const cs = c.churnStreak;
  cands.push([ALERT_ORDER[cs >= 3 ? 3 : cs], `CHURN_STREAK_${cs}`]);
  const br = c.blockerRepeat;
  cands.push([br >= 4 ? ALERT_ORDER[3] : ALERT_ORDER[Math.min(br, 2)], `BLOCKER_REPEATED_${br}`]);
  const ts = stageBudgetStage?.turnsSpent || 0;
  const budget = ts >= 2 * PROGRESS_LIMITS.maxTurnsPerStage ? 3 : ts >= PROGRESS_LIMITS.maxTurnsPerStage ? 2 : 0;
  cands.push([ALERT_ORDER[budget], "STAGE_TURN_BUDGET"]);
  let best = [PROGRESS_ALERT.NONE, ""];
  for (const cand of cands) if (alertRank(cand[0]) > alertRank(best[0])) best = cand;
  return best;
}

export function applyTurn(ledgerIn, { targetResponse = null, turn, now = Date.now() } = {}) {
  const prev = clone(ledgerIn);
  const L = normalizeProgressLedger(prev, { missionKey: prev?.missionKey, now });
  const at = nowIso(now);
  const r = isObj(targetResponse) ? targetResponse : null;
  const progress = parseResponseProgress(r);
  const cls = classifyTurn(L, { targetResponse: r, now });
  const turnNo = int(turn) || L.counters.turns + 1;
  const reasons = [...cls.reasons];
  const previousAlert = L.alert;

  if (L.stages.length === 0 && progress?.plan) {
    L.stages = progress.plan.slice(0, PROGRESS_LIMITS.maxStages).map((s, i) => ({ ...s, state: i === 0 ? STAGE_STATE.ACTIVE : STAGE_STATE.PENDING }));
  } else if (progress?.planChange) {
    const kept = L.stages.filter((s) => s.state === STAGE_STATE.DONE);
    const usedIds = new Set(kept.map((s) => s.id));
    const fresh = progress.planChange.stages.map((s) => {
      let id = s.id;
      if (usedIds.has(id)) { let n = 1; while (usedIds.has(`${id}-${n}`)) n++; id = `${id}-${n}`; }
      usedIds.add(id);
      return { ...s, id, state: STAGE_STATE.PENDING };
    });
    L.stages = [...kept, ...fresh].slice(0, PROGRESS_LIMITS.maxStages);
    if (!L.stages.some((s) => s.state === STAGE_STATE.ACTIVE)) {
      const first = L.stages.find((s) => s.state === STAGE_STATE.PENDING);
      if (first) first.state = STAGE_STATE.ACTIVE;
    }
    reasons.push(`PLAN_CHANGE:${text(progress.planChange.reason, 160)}`);
  }

  const upd = progress?.stageUpdate;
  if (upd) {
    const st = L.stages.find((s) => s.id === upd.id);
    if (st) {
      if (upd.state === "DONE" && cls.stageDone) {
        st.state = STAGE_STATE.DONE; st.doneAt = at; st.evidence = [...st.evidence, ...upd.evidence].slice(-8);
        for (const ref of upd.evidence) L.acceptedEvidence.push({ ref: text(ref, 600), stageId: st.id, turn: turnNo, at });
        L.acceptedEvidence = capNewest(L.acceptedEvidence, PROGRESS_LIMITS.maxEvidence);
        L.counters.stagesDone++;
      } else if (upd.state === "BLOCKED" && st.state !== STAGE_STATE.DONE) st.state = STAGE_STATE.BLOCKED;
      else if (upd.state === "IN_PROGRESS" && st.state !== STAGE_STATE.DONE) st.state = STAGE_STATE.ACTIVE;
    }
  }
  L.currentStageId = pickCurrent(L.stages);
  const current = L.stages.find((s) => s.id === L.currentStageId) || null;
  if (current) current.turnsSpent++;

  if (progress) {
    L.deadEnds = mergeDeadEnds(L.deadEnds, progress.deadEnds, turnNo, at);
    L.knownLimitations = mergeLimitations(L.knownLimitations, progress.knownLimitations, turnNo, at);
    for (const t of progress.sideFindings) L.sideFindings.push({ text: t, turn: turnNo });
    L.sideFindings = capNewest(L.sideFindings, PROGRESS_LIMITS.maxSideFindings);
  }
  L.knownLimitations = mergeLimitations(L.knownLimitations, detectLimitations(r), turnNo, at);

  const ids = extractIdentifiers(responseTexts(r, progress));
  L.seenIds = capNewest([...new Set([...L.seenIds, ...ids])], PROGRESS_LIMITS.maxSeenIds);
  L.lastHandoff = str(r?.nextSuggestedAction, 2000);
  L.lastBlockerTokens = blockerTokens(strList(r?.blockers, 50, 4000));

  const c = L.counters;
  c.turns++;
  if (cls.verdict === TURN_VERDICT.ADVANCED || cls.verdict === TURN_VERDICT.PLANNED) { c.advanced++; c.churnStreak = 0; }
  else if (cls.verdict === TURN_VERDICT.CHURN) { c.churn++; c.churnStreak++; }
  else { c.blocked++; c.churnStreak++; }
  c.blockerRepeat = cls.blockerRepeated && !cls.stageDone ? c.blockerRepeat + 1 : 0;

  const [alert, alertReason] = computeAlert(L, cls, current);
  L.alert = alert; L.alertReason = alertReason;
  if (alert !== previousAlert) L.alertSince = alert === PROGRESS_ALERT.NONE ? "" : at;

  let parkRequest = null;
  if (alert === PROGRESS_ALERT.OPERATOR_REQUIRED) {
    if (L.operatorRequest?.status !== "OPEN") {
      const ai = cls.operatorRequest;
      const n = Math.max(c.churnStreak, c.blockerRepeat + 1, 1);
      const firstBlocker = strList(r?.blockers, 50, 600)[0] || "none reported";
      L.operatorRequest = {
        requestId: sanitizeId(`opreq-${L.missionKey}-${turnNo}`),
        ask: ai ? ai.ask : text(`The mission has not advanced for ${n} turns. Latest blocker: ${firstBlocker}. Provide the missing decision, access or file, or give a different instruction.`, 1000),
        why: ai ? (ai.why || alertReason) : text(`${alertReason}${current ? ` / ${current.title}` : ""}`, 1000),
        then: ai ? (ai.then || "") : (current ? `Resume stage ${current.id} using the operator answer.` : "Resume the mission using the operator answer."),
        options: ai ? ai.options : [], source: ai ? "AI" : "GREENFIELD", status: "OPEN",
        createdAt: at, turn: turnNo, answer: "", answeredAt: ""
      };
    }
    parkRequest = { operatorRequest: clone(L.operatorRequest) };
  }

  L.turnLog.push({
    turn: turnNo, at, verdict: cls.verdict, stageId: L.currentStageId, newIds: cls.newIds.length,
    deltaCount: cls.deltaCount, blockerSimilarity: Math.round(cls.blockerSimilarity * 1000) / 1000, reasons: reasons.map((x) => text(x, 200)).slice(0, 10)
  });
  L.turnLog = capNewest(L.turnLog, PROGRESS_LIMITS.maxTurnLog);
  L.updatedAt = at;
  return { ledger: L, classification: { ...cls, reasons }, alert, alertChanged: alert !== previousAlert, parkRequest };
}

// ---------------------------------------------------------------- operator

function resetCounters(L) {
  L.counters.churnStreak = 0; L.counters.blockerRepeat = 0;
  // An operator intervention gives the current stage a fresh turn budget;
  // otherwise the next turn would re-escalate on the old budget immediately.
  const current = L.stages.find((s) => s.id === L.currentStageId);
  if (current) current.turnsSpent = 0;
  L.alert = PROGRESS_ALERT.NONE; L.alertReason = "OPERATOR_ANSWERED"; L.alertSince = "";
}

export function recordOperatorAnswer(ledger, { answer, now = Date.now() } = {}) {
  const a = typeof answer === "string" ? answer.trim() : "";
  if (!a) throw new Error("OPERATOR_ANSWER_REQUIRED");
  const at = nowIso(now);
  const L = normalizeProgressLedger(clone(ledger), { missionKey: ledger?.missionKey, now });
  if (L.operatorRequest?.status === "OPEN") {
    L.operatorRequest.status = "ANSWERED"; L.operatorRequest.answer = text(a, 4000); L.operatorRequest.answeredAt = at;
  } else {
    L.operatorRequest = {
      requestId: sanitizeId(`opreq-${L.missionKey}-operator-${L.counters.turns}`), ask: "", why: "", then: "", options: [],
      source: "OPERATOR", status: "ANSWERED", createdAt: at, turn: L.counters.turns, answer: text(a, 4000), answeredAt: at
    };
  }
  resetCounters(L); L.updatedAt = at;
  return L;
}

export function cancelOperatorRequest(ledger, { now = Date.now() } = {}) {
  const at = nowIso(now);
  const L = normalizeProgressLedger(clone(ledger), { missionKey: ledger?.missionKey, now });
  if (L.operatorRequest) { L.operatorRequest.status = "CANCELLED"; L.operatorRequest.answeredAt = at; }
  resetCounters(L); L.alertReason = "OPERATOR_CANCELLED"; L.updatedAt = at;
  return L;
}

export function consumeOperatorAnswer(ledger) {
  const L = clone(ledger);
  if (L?.operatorRequest && (L.operatorRequest.status === "ANSWERED" || L.operatorRequest.status === "CANCELLED")) L.operatorRequest = null;
  return L;
}

// ---------------------------------------------------------------- prompt composition

function currentStageOf(ledger) {
  return arr(ledger?.stages).find((s) => s.id === ledger?.currentStageId) || null;
}

export function progressAlertInstruction(ledger) {
  const stage = currentStageOf(ledger);
  const reason = ledger?.alertReason || "UNSPECIFIED";
  const what = stage ? `stage ${stage.id}` : "the mission";
  switch (ledger?.alert) {
    case PROGRESS_ALERT.CHANGE_ROUTE:
      return text(`PROGRESS ALERT CHANGE_ROUTE (${reason}): the last turn produced no new verifiable deliverable for ${what}. Do not repeat the same attempt. Read progress.deadEnds, list at least three materially different routes, pick the best feasible one and deliver this turn.`, 700);
    case PROGRESS_ALERT.STRATEGY_SWITCH: {
      const others = arr(ledger.stages).filter((s) => s.id !== ledger.currentStageId && s.state !== STAGE_STATE.DONE && s.state !== STAGE_STATE.DROPPED).map((s) => s.id).slice(0, 8);
      return text(`PROGRESS ALERT STRATEGY_SWITCH (${reason}): the current route is not advancing. Do not continue it. This turn either complete a different stage that does not depend on it (${others.length ? others.join(", ") : "none planned"}) or return progress.operatorRequest with one concrete ask and status BLOCKED (omit sessionAction); Greenfield parks the mission and notifies the operator.`, 700);
    }
    case PROGRESS_ALERT.OPERATOR_REQUIRED:
      return "PROGRESS ALERT OPERATOR_REQUIRED: waiting for the operator. Return only progress.operatorRequest unless operatorAnswer is present.";
    default:
      return "";
  }
}

export function composeProgressObjective({ ledger, handoff = "" } = {}) {
  const h = typeof handoff === "string" ? handoff : "";
  const stage = currentStageOf(ledger);
  const stageLine = stage ? `Deliver stage ${stage.id} — ${stage.title}: ${stage.deliverable}. Acceptance: ${stage.acceptance}.` : "";
  const req = ledger?.operatorRequest;
  if (req?.status === "ANSWERED") {
    let s = `OPERATOR ANSWER: ${req.answer}\n(Your request was: ${req.ask})\nAct on this answer first, then continue stage ${stage?.id || "-"} — ${stage?.title || "the mission"}.`;
    if (h) s += `\nPrevious handoff: ${text(h, 1500)}`;
    return s;
  }
  switch (ledger?.alert) {
    case PROGRESS_ALERT.CHANGE_ROUTE:
      return `${progressAlertInstruction(ledger)}\nPrevious handoff (reference only, change the route): ${text(h, 1500)}`;
    case PROGRESS_ALERT.STRATEGY_SWITCH:
      return stageLine ? `${progressAlertInstruction(ledger)}\n${stageLine}` : progressAlertInstruction(ledger);
    case PROGRESS_ALERT.OPERATOR_REQUIRED:
      return progressAlertInstruction(ledger);
    default:
      return h || stageLine;
  }
}

const RESPONSE_FIELD = "Add `progress` to your JSON: {delta:[new verifiable results with ids], stageUpdate?:{id,state,evidence[]}, plan?:[{id,title,deliverable,acceptance,needsOperator?}], planChange?:{reason,stages[]}, deadEnds?:[{route,reason}], knownLimitations?:[{surface,code}], operatorRequest?:{ask,why,then,options?}, sideFindings?:[...]}.";

export function buildProgressCapsule(ledger, { now = Date.now() } = {}) {
  const L = normalizeProgressLedger(ledger, { missionKey: ledger?.missionKey, now });
  const stage = currentStageOf(L);
  const last = L.turnLog[L.turnLog.length - 1];
  const req = L.operatorRequest;
  const capsule = {
    schema: PROGRESS_CAPSULE_SCHEMA, rule: PROGRESS_DOCTRINE,
    stages: L.stages.map((s) => ({ id: s.id, title: s.title, state: s.state })),
    currentStage: stage ? { id: stage.id, title: stage.title, deliverable: stage.deliverable, acceptance: stage.acceptance, turnsSpent: stage.turnsSpent } : null,
    planRequired: L.stages.length === 0,
    acceptedEvidence: L.acceptedEvidence.slice(-8).map((e) => e.ref),
    deadEnds: L.deadEnds.slice(-8).map((d) => ({ route: d.route, reason: d.reason })),
    knownLimitations: L.knownLimitations.map((l) => `${l.surface}:${l.code}`),
    lastTurn: last ? { verdict: last.verdict, reasons: last.reasons } : null,
    lastHandoff: text(L.lastHandoff, 600),
    counters: {
      turns: L.counters.turns, advanced: L.counters.advanced, churnStreak: L.counters.churnStreak,
      blockerRepeat: L.counters.blockerRepeat, stagesDone: L.counters.stagesDone, stagesTotal: L.stages.length
    },
    alert: L.alert, alertInstruction: progressAlertInstruction(L),
    operatorAnswer: req?.status === "ANSWERED" ? { ask: req.ask, answer: req.answer } : null,
    responseField: RESPONSE_FIELD
  };
  const max = PROGRESS_LIMITS.capsuleMaxChars;
  const size = () => JSON.stringify(capsule).length;
  const trimmable = ["acceptedEvidence", "deadEnds", "knownLimitations", "stages"];
  while (size() > max) {
    const key = trimmable.filter((k) => capsule[k].length > 0).sort((a, b) => JSON.stringify(capsule[b]).length - JSON.stringify(capsule[a]).length)[0];
    if (key) { capsule[key].shift(); continue; }
    if (capsule.lastHandoff) { capsule.lastHandoff = ""; continue; }
    if (capsule.operatorAnswer) { capsule.operatorAnswer = { ask: text(capsule.operatorAnswer.ask, 200), answer: text(capsule.operatorAnswer.answer, 600) }; if (size() > max) capsule.operatorAnswer.ask = ""; if (size() > max) capsule.operatorAnswer.answer = text(capsule.operatorAnswer.answer, 200); break; }
    break;
  }
  return capsule;
}

export function progressSummaryForUi(ledger) {
  const L = normalizeProgressLedger(ledger, { missionKey: ledger?.missionKey });
  return {
    missionKey: L.missionKey, stages: L.stages.map((s) => ({ id: s.id, title: s.title, state: s.state })),
    currentStageId: L.currentStageId, alert: L.alert, alertReason: L.alertReason, counters: { ...L.counters },
    operatorRequest: L.operatorRequest ? clone(L.operatorRequest) : null,
    lastVerdicts: L.turnLog.slice(-6).map((t) => t.verdict),
    deadEnds: L.deadEnds.slice(-5).map((d) => ({ route: d.route, reason: d.reason })), updatedAt: L.updatedAt
  };
}
