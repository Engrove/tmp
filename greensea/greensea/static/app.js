"use strict";
// GreenSea web interface. No framework, no build step.
// Rules: model output is only ever inserted as text (textContent), never as HTML.
// Live updates only touch display nodes; an input that has focus or an unsaved
// change (data-dirty) is never overwritten (lesson from Greenfield 1.9.0).

const $ = (id) => document.getElementById(id);

const S = {
  session: null,
  missions: new Map(),
  selected: null,
  detail: null,
  tab: "live",
  view: "missions",
  templates: [],
  selectedTemplate: null,
  settings: null,
  spec: null,
  llama: null,
  es: null,
  esMission: undefined,
  turnsOldest: null,
  turnCache: new Map(),
  expanded: new Set(),
  refreshTimer: null,
};

const PHASE = {
  DRAFT: ["Utkast", ""], SENDING: ["Skickar", "run"], GENERATING: ["Genererar", "run"],
  ANALYZING: ["Analyserar", "run"], ROTATING: ["Ny session", "run"], RECOVERING: ["Återhämtar", "wait"],
  PAUSED: ["Pausad", "wait"], NEEDS_OPERATOR: ["Väntar på dig", "wait"], DONE: ["Klar", "done"],
  STOPPED: ["Stoppad", "stop"],
};
const PRIO = { LOW: "Låg", NORMAL: "Normal", HIGH: "Hög", URGENT: "Brådskande" };
const WAITING = { LLAMA: "väntar på llama-server", CAPACITY: "väntar på ledig plats", REVIEW: "granskning pågår" };
const REASON = {
  MODEL_CONTINUE: "fortsätter", MODEL_DONE: "modellen: klart", MODEL_BLOCKED: "modellen behöver dig",
  PROTOCOL_REPAIR: "förra svaret saknade giltig JSON", PROTOCOL_FAILURES: "upprepade formatfel",
  REPLAN_REPETITION: "upprepning – nytt mål valt", REPLAN_EMPTY_NEXT_STEP: "tomt nästa steg – nytt mål valt",
  REPETITION: "fastnat i upprepning", TURN_BUDGET_EXHAUSTED: "turbudgeten är slut",
  DONE_DISPUTED: "granskaren bestrider att det är klart", REVIEW_REJECTED_DONE: "granskaren: inte klart än",
  REVIEW_REJECTED_BLOCKED: "granskaren: kan fortsätta själv", REVIEW_REDIRECTED: "granskaren styrde om",
  OPERATOR_PAUSE: "pausad av dig", MODEL_PAUSE: "modellen pausade", OPERATOR_STOP: "stoppad av dig",
  OPERATOR_RESUME: "återupptagen", OPERATOR_REOPEN: "öppnad igen", CONTEXT_TOO_SMALL: "kontexten räcker inte",
  LLAMA_REQUEST_REJECTED: "llama-server avvisade anropet", RUNNER_ERROR: "internt fel", N_CTX_UNKNOWN: "n_ctx okänd",
  RETRY: "nytt försök", PAUSE_ENDED: "pausen slut", RESTART_REDISPATCH: "omsändning efter omstart", START: "startar",
  CONTEXT_PRESSURE: "kontexten börjar bli full", CONTEXT_EXCEEDED: "kontexten var full", MISSION_START: "start",
  MODEL_REQUEST: "modellens begäran", OPERATOR: "din begäran", MISSION_UPDATED: "uppdraget ändrat",
  SESSION_TURN_LIMIT: "turgräns per session", NO_PENDING_TURN: "ingen förberedd tur",
  NOTHING_TO_ANALYZE: "inget svar att analysera", CONNECT: "llama-server nås inte",
  TIMEOUT_FIRST_TOKEN: "ingen första token i tid", STALL: "strömmen stannade", TIMEOUT_TURN: "turen tog för lång tid",
  HTTP: "HTTP-fel från llama-server", PROTOCOL: "oväntat svar från llama-server",
};
const EVENT = {
  MISSION_CREATED: "Uppdrag skapat", MISSION_STARTED: "Startat", SESSION_STARTED: "Session startad",
  SESSION_ROTATED: "Ny session (rotation)", TURN_DISPATCHED: "Prompt skickad", TURN_COMPLETED: "Svar mottaget",
  TURN_ANALYZED: "Svar analyserat", LLAMA_ERROR: "Fel från llama-server", CONTEXT_EXCEEDED: "Kontexten full",
  CONTEXT_PRESSURE: "Kontexttryck", CONTEXT_TOO_SMALL: "Kontexten räcker inte", RETRY: "Nytt försök",
  RETRY_NOW: "Försök nu", PAUSED: "Pausad", PAUSE_REQUESTED: "Paus begärd", PAUSE_ENDED: "Paus slut",
  RESUMED: "Återupptagen", STOPPED: "Stoppad", REOPENED: "Öppnad igen", ROTATION_REQUESTED: "Ny session begärd",
  INSTRUCTION_ADDED: "Instruktion tillagd", INSTRUCTION_DELETED: "Instruktion borttagen",
  MISSION_UPDATED: "Uppdrag ändrat", MISSION_DONE: "Klart", NEEDS_OPERATOR: "Väntar på operatör",
  REVIEW: "Granskning", RUNNER_ERROR: "Internt fel", RESTART_REDISPATCH: "Omsändning efter omstart",
  CHECKPOINT_TRIMMED: "Checkpoint förkortad", SETTINGS_UPDATED: "Inställningar ändrade",
  SETTINGS_RESET: "Inställningar återställda", SERVICE_STARTED: "Tjänsten startad",
  INVARIANT_VIOLATION: "Invariant bruten", N_CTX_UNKNOWN: "n_ctx okänd",
};
const SETTING_TEXT = {
  "generation.max_tokens": ["Max tokens per svar", "Övre gräns för ett svar. Långa leveranser byggs över flera turer med APPEND."],
  "generation.temperature": ["Temperatur", "Lägre = stabilare, mer förutsägbart arbete."],
  "generation.top_p": ["top_p", "Nucleus sampling."],
  "generation.structured_output": ["Strukturerat svar", "json_schema = grammatikbunden JSON (rekommenderas). json_object = fri JSON. off = bara instruktion + tolerant tolkning."],
  "generation.store_reasoning": ["Spara resonemang", "Sparar reasoning_content från resonerande modeller. Skickas aldrig tillbaka i kontexten."],
  "context.n_ctx": ["n_ctx (tokens)", "0 = läs per-slot n_ctx från llama-server /props."],
  "context.rotate_at": ["Rotera vid andel", "Ny session när prompten passerar denna andel av n_ctx."],
  "context.checkpoint_share": ["Checkpoint-andel", "Högsta andel av n_ctx som checkpointen i en ny session får ta."],
  "context.max_session_turns": ["Max turer per session", "0 = obegränsat; annars ny session efter så många turer."],
  "context.progress_log_items": ["Framstegslogg i checkpoint", "Antal senaste tursammanfattningar som följer med."],
  "context.artifact_read_chars": ["Läsfönster för artefakter", "Tecken per READ_ARTIFACT."],
  "scheduler.max_parallel": ["Max parallella anrop", "0 = llama-serverns total_slots."],
  "scheduler.aging_seconds": ["Åldring (s)", "Ett väntande uppdrag höjs en prioritetsnivå per intervall."],
  "timeouts.first_token_seconds": ["Första token (s)", "Max väntan på första token (inkluderar promptbearbetning)."],
  "timeouts.stall_seconds": ["Stopp i strömmen (s)", "Max tid utan data när genereringen har börjat."],
  "timeouts.turn_seconds": ["Max tid per tur (s)", "Total gräns för ett svar."],
  "timeouts.health_interval_seconds": ["Hälsokontroll (s)", "Intervall för GET /health."],
  "reviewer.mode": ["Granskare", "off = av. terminal = granskar påståenden om KLART/BLOCKERAD. every_turn = varje tur."],
  "reviewer.max_tokens": ["Granskarens max tokens", "Svarsgräns för granskaren."],
  "reviewer.max_rejections": ["Max avslag i rad", "Därefter avgör du."],
  "missions.default_max_turns": ["Standard max turer", "För nya uppdrag."],
  "missions.default_priority": ["Standardprioritet", "För nya uppdrag."],
};
const SECTION_TEXT = { generation: "Generering", context: "Kontext och sessioner", scheduler: "Schemaläggning",
  timeouts: "Tidsgränser", reviewer: "Granskare", missions: "Nya uppdrag" };
const ACTIVE_PHASES = new Set(["SENDING", "GENERATING", "ANALYZING", "ROTATING", "RECOVERING", "PAUSED", "NEEDS_OPERATOR", "DRAFT"]);

// ------------------------------------------------------------------ utilities

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function fmtTime(ts) {
  if (!ts) return "–";
  return new Date(ts * 1000).toLocaleString("sv-SE");
}
function fmtNum(n) {
  return n === null || n === undefined ? "–" : Number(n).toLocaleString("sv-SE");
}
function fmtDuration(seconds) {
  if (seconds === null || seconds === undefined) return "–";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}
function reasonText(code) {
  if (!code) return "";
  return REASON[code] || code;
}
function resetLive() {
  $("live-content").textContent = "";
  $("live-reasoning").textContent = "";
  $("live-reasoning-box").hidden = true;
  $("live-last").replaceChildren();
}

function replaceKids(node, ...children) {
  node.replaceChildren(...children.filter((c) => c !== null && c !== undefined && c !== false));
}

// Structured view of a worker response; falls back to the raw text.
function responseView(content) {
  const raw = (content || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  let obj = null;
  try { obj = JSON.parse(raw); } catch { obj = null; }
  const rawBox = el("details", {}, el("summary", { text: "Rå JSON / text" }), el("pre", { class: "msg", text: content || "(inget svar)" }));
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return el("div", {}, el("p", { class: "muted small", text: "Svaret är inte ett giltigt JSON-objekt; visas som text." }),
      el("pre", { class: "msg", text: content || "(inget svar)" }));
  }
  const ops = (list, fmt) => Array.isArray(list) && list.length ? el("ul", { class: "receipts" }, ...list.map((x) => el("li", { text: fmt(x) }))) : null;
  return el("div", { class: "response" },
    el("p", {}, el("strong", { text: `${obj.status || "?"} – ` }), obj.summary || ""),
    obj.output ? el("pre", { class: "doc", text: obj.output }) : null,
    obj.nextStep ? el("p", { class: "small" }, el("strong", { text: "Nästa steg: " }), obj.nextStep) : null,
    obj.question ? el("p", { class: "small" }, el("strong", { text: "Fråga: " }), obj.question) : null,
    ops(obj.artifacts, (a) => `artefakt ${a.op} ${a.name} (${(a.content || "").length} tecken)`),
    ops(obj.memory, (m) => `minne ${m.op} ${m.key}${m.op === "SET" ? " = " + String(m.value || "").slice(0, 120) : ""}`),
    ops(obj.control, (c) => `kontroll ${c.op} ${c.name || c.priority || c.seconds || ""}`),
    rawBox);
}

function compactJson(obj, limit = 320) {
  const s = JSON.stringify(obj ?? {});
  return s.length > limit ? s.slice(0, limit) + "…" : s;
}

let toastTimer = null;
function toast(message, isError = false) {
  const t = $("toast");
  t.textContent = message;
  t.className = "toast" + (isError ? " error" : "");
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 7000 : 3000);
}

async function api(method, path, body) {
  const opts = { method, headers: {}, credentials: "same-origin" };
  if (method !== "GET") opts.headers["X-GreenSea"] = "1";
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const resp = await fetch(path, opts);
  if (resp.status === 401 && path !== "/api/login") {
    showLogin();
    throw new Error("Inloggning krävs");
  }
  const type = resp.headers.get("Content-Type") || "";
  const data = type.includes("application/json") ? await resp.json() : await resp.text();
  if (!resp.ok) throw new Error((data && data.error) || `HTTP ${resp.status}`);
  return data;
}

async function guarded(fn) {
  try { return await fn(); } catch (e) { toast(e.message, true); return undefined; }
}

// Edit guard: never overwrite what the user is editing.
function setField(node, value) {
  if (document.activeElement === node || node.dataset.dirty === "1") return;
  if (node.type === "checkbox") node.checked = !!value;
  else node.value = value ?? "";
}
function forceField(node, value) {
  delete node.dataset.dirty;
  if (node.type === "checkbox") node.checked = !!value;
  else node.value = value ?? "";
}
function trackDirty(...nodes) {
  for (const n of nodes) {
    n.addEventListener("input", () => { n.dataset.dirty = "1"; });
    n.addEventListener("change", () => { n.dataset.dirty = "1"; });
  }
}
function clearDirty(...nodes) { for (const n of nodes) delete n.dataset.dirty; }

// ------------------------------------------------------------------ views

function showView(name) {
  S.view = name;
  for (const v of ["missions", "templates", "events", "settings"]) $(`view-${v}`).hidden = v !== name;
  $("view-login").hidden = true;
  for (const b of $("main-nav").querySelectorAll("button")) b.classList.toggle("active", b.dataset.view === name);
  if (name === "templates") loadTemplates();
  if (name === "events") loadGlobalEvents();
  if (name === "settings") loadSettings();
}

function showLogin() {
  for (const v of ["missions", "templates", "events", "settings"]) $(`view-${v}`).hidden = true;
  $("view-login").hidden = false;
  $("main-nav").hidden = true;
}

// ------------------------------------------------------------------ llama pill

function renderLlama(state) {
  if (!state) return;
  S.llama = state;
  const pill = $("llama-pill");
  pill.classList.toggle("ok", !!state.ok);
  pill.classList.toggle("bad", !state.ok);
  const parts = [];
  if (state.ok) {
    const model = (state.model || "").split("/").pop();
    parts.push(model || "llama-server");
    if (state.n_ctx_effective) parts.push(`n_ctx ${fmtNum(state.n_ctx_effective)}`);
    if (state.total_slots) parts.push(`${state.total_slots} slots`);
    if (state.sleeping) parts.push("sover");
  } else {
    parts.push(`llama-server: ${state.detail || "ej redo"}`);
  }
  $("llama-text").textContent = parts.join(" · ");
  pill.title = `${state.base_url || ""}\n${state.detail || ""}`;
  if (S.view === "settings") renderLlamaDetails();
}

function renderLlamaDetails() {
  const s = S.llama || {};
  const dl = $("llama-details");
  dl.replaceChildren();
  const rows = [["Adress", s.base_url], ["Status", s.ok ? "redo" : "ej redo"], ["Detalj", s.detail],
    ["Modell", s.model], ["Build", s.build], ["n_ctx (per slot)", fmtNum(s.n_ctx)],
    ["n_ctx som används", fmtNum(s.n_ctx_effective)], ["Slots", fmtNum(s.total_slots)],
    ["Kapacitet i GreenSea", fmtNum(s.capacity)], ["Sover", s.sleeping ? "ja" : "nej"],
    ["Senast kontrollerad", fmtTime(s.checked_at)], ["Senast redo", fmtTime(s.last_ok_at)]];
  for (const [k, v] of rows) dl.append(el("dt", { text: k }), el("dd", { text: v ?? "–" }));
}

// ------------------------------------------------------------------ mission list

function missionVisible(m) {
  const f = $("mission-filter").value;
  if (f === "all") return true;
  const ended = m.phase === "DONE" || m.phase === "STOPPED";
  return f === "ended" ? ended : !ended;
}

function renderMissionList() {
  const list = $("mission-list");
  const items = [...S.missions.values()].filter(missionVisible)
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  list.replaceChildren(...items.map((m) => {
    const [label, cls] = PHASE[m.phase] || [m.phase, ""];
    const fill = m.context_fill ? Math.min(100, Math.round(m.context_fill * 100)) : 0;
    const bar = el("div");
    bar.style.width = `${fill}%`;
    return el("li", { class: m.id === S.selected ? "selected" : "", onclick: () => selectMission(m.id) },
      el("div", { class: "t", text: m.title }),
      el("div", { class: "m" }, el("span", { class: `badge ${cls}`, text: label }),
        el("span", { text: `tur ${m.turn_count}/${m.max_turns}` }),
        el("span", { text: `s${m.session_seq}` }), el("span", { text: PRIO[m.priority] || m.priority })),
      el("div", { class: "mini-bar" }, bar));
  }));
  $("mission-list-empty").hidden = items.length > 0;
}

async function loadMissions() {
  const data = await guarded(() => api("GET", "/api/missions"));
  if (!data) return;
  S.missions = new Map(data.missions.map((m) => [m.id, m]));
  renderMissionList();
  if (S.selected && !S.missions.has(S.selected)) closeDetail();
}

async function loadStatus() {
  const data = await guarded(() => api("GET", "/api/status"));
  if (!data) return;
  $("app-version").textContent = `v${data.version}`;
  renderLlama(data.llama);
  renderCapacity(data.scheduler);
}

function renderCapacity(sched) {
  if (!sched) return;
  $("capacity-text").textContent = `aktiva anrop ${sched.active.length}/${sched.capacity}` +
    (sched.waiting.length ? ` · ${sched.waiting.length} väntar` : "");
}

// ------------------------------------------------------------------ mission detail

function closeDetail() {
  S.selected = null;
  S.detail = null;
  $("detail").hidden = true;
  $("detail-placeholder").hidden = false;
  connectStream();
  renderMissionList();
}

async function selectMission(id) {
  $("new-mission-form").hidden = true;
  if (S.selected !== id) {
    S.selected = id;
    S.turnCache.clear();
    S.expanded.clear();
    S.turnsOldest = null;
    forceField($("instr-text"), "");
    resetLive();
    $("artifact-view").hidden = true;
  }
  renderMissionList();
  connectStream();
  await loadDetail(true);
}

async function loadDetail(force = false) {
  if (!S.selected) return;
  const id = S.selected;
  const data = await guarded(() => api("GET", `/api/missions/${id}`));
  if (!data || S.selected !== id) return;
  S.detail = data;
  S.missions.set(id, data.mission);
  $("detail-placeholder").hidden = true;
  $("detail").hidden = false;
  renderSummary(data.mission);
  const m = data.mission;
  const fill = force ? forceField : setField;
  fill($("ed-title"), m.title);
  fill($("ed-goal"), m.goal);
  fill($("ed-max-turns"), m.max_turns);
  renderInstructions(data.instructions);
  renderMemory(data.memory);
  renderArtifacts(data.artifacts);
  renderSessions(data.sessions);
  if (data.live) {
    $("live-last").replaceChildren();
    $("live-content").textContent = data.live.content;
    $("live-reasoning").textContent = data.live.reasoning;
    $("live-reasoning-box").hidden = !data.live.reasoning;
  }
  renderLiveStatus();
  if (force) {
    if (S.tab === "turns") loadTurns(true);
    if (S.tab === "events") loadMissionEvents();
    if (S.tab === "live" && !data.live) showLastResponse();
  }
}

function renderSummary(m) {
  if (!m || m.id !== S.selected) return;
  $("d-title").textContent = m.title;
  const [label, cls] = PHASE[m.phase] || [m.phase, ""];
  const badge = $("d-phase");
  badge.textContent = label;
  badge.className = `badge ${cls}`;
  let reason = reasonText(m.phase_reason);
  if (m.pause_requested) reason = (reason ? reason + " · " : "") + "paus efter pågående tur";
  if (m.rotate_requested) reason = (reason ? reason + " · " : "") + "ny session vid nästa tur";
  $("d-reason").textContent = reason;
  $("d-question").hidden = !(m.phase === "NEEDS_OPERATOR" && m.question);
  $("d-question-text").textContent = m.question || "";
  $("d-turns").textContent = `${m.turn_count} / ${m.max_turns}`;
  $("d-session").textContent = m.session_seq ? `#${m.session_seq}` : "–";
  const fillPct = m.context_fill ? Math.min(100, m.context_fill * 100) : 0;
  const rotateAt = S.settings ? S.settings.context.rotate_at : 0.75;
  const fill = $("d-ctx-fill");
  fill.style.width = `${fillPct}%`;
  fill.classList.toggle("hot", fillPct >= rotateAt * 100 * 0.85);
  $("d-ctx-mark").style.left = `${rotateAt * 100}%`;
  $("d-ctx-text").textContent = m.n_ctx ? `${fmtNum(m.context_tokens)} / ${fmtNum(m.n_ctx)} tokens (${fillPct.toFixed(0)} %)` : "n_ctx okänd";
  setField($("d-priority"), m.priority);
  $("d-objective").textContent = m.objective || "–";
  let waiting = WAITING[m.waiting_for] || "";
  if (m.phase === "RECOVERING" && m.recovery && m.recovery.next_attempt_at) {
    waiting = `nytt försök om ${fmtDuration(m.recovery.next_attempt_at - Date.now() / 1000)} (${reasonText(m.recovery.reason)}, försök ${m.recovery.attempts})`;
  }
  if (m.phase === "PAUSED" && m.pause_until) waiting = `pausad till ${fmtTime(m.pause_until)}`;
  if (m.phase === "GENERATING") waiting = waiting || "modellen skriver";
  $("d-waiting").textContent = waiting || "–";
  updateActions(m);
}

function updateActions(m) {
  const p = m.phase;
  const can = {
    start: p === "DRAFT",
    pause: ["SENDING", "GENERATING", "ANALYZING", "ROTATING", "RECOVERING"].includes(p) && !m.pause_requested
      || (p === "PAUSED" && !!m.pause_until),
    resume: ["PAUSED", "NEEDS_OPERATOR", "RECOVERING"].includes(p),
    rotate: !["DRAFT", "DONE", "STOPPED"].includes(p) && !m.rotate_requested,
    stop: p !== "STOPPED",
    export: true,
    delete: ["DRAFT", "DONE", "STOPPED"].includes(p),
  };
  for (const b of $("d-actions").querySelectorAll("button")) {
    const act = b.dataset.act;
    b.hidden = !can[act];
    if (act === "resume") b.textContent = p === "RECOVERING" ? "Försök nu" : "Återuppta";
  }
  const ended = p === "DONE" || p === "STOPPED";
  $("instr-send").hidden = ended;
  $("reopen-btn").hidden = !ended;
  $("instr-resume").parentElement.hidden = ended;
}

function renderInstructions(list) {
  const pending = (list || []).filter((i) => i.consumed_turn === null);
  $("pending-instr").replaceChildren(...pending.map((i) =>
    el("li", {}, el("span", { text: i.text }),
      el("button", { class: "ghost small", title: "Ta bort", text: "✕",
        onclick: () => guarded(async () => {
          await api("DELETE", `/api/missions/${S.selected}/instructions/${i.id}`);
          await loadDetail();
        }) }))));
}

function renderMemory(rows) {
  const body = $("memory-body");
  body.replaceChildren(...(rows || []).map((r) =>
    el("tr", {}, el("td", { class: "mono", text: r.key }), el("td", { class: "value-cell", text: r.value }),
      el("td", { text: r.updated_turn }))));
  $("memory-empty").hidden = (rows || []).length > 0;
}

function renderArtifacts(rows) {
  const body = $("artifact-body");
  const mid = S.selected;
  body.replaceChildren(...(rows || []).map((r) => {
    const url = `/api/missions/${encodeURIComponent(mid)}/artifacts/${encodeURIComponent(r.name)}`;
    return el("tr", {},
      el("td", {}, el("a", { href: "#", text: r.name, onclick: (e) => { e.preventDefault(); viewArtifact(r.name); } })),
      el("td", { text: `${fmtNum(r.size)} B` }), el("td", { class: "mono", text: r.sha256.slice(0, 12) }),
      el("td", { text: r.updated_turn }),
      el("td", {}, el("a", { href: `${url}?download=1`, text: "Ladda ner" })));
  }));
  $("artifact-empty").hidden = (rows || []).length > 0;
}

async function viewArtifact(name) {
  const text = await guarded(() => api("GET", `/api/missions/${encodeURIComponent(S.selected)}/artifacts/${encodeURIComponent(name)}`));
  if (text === undefined) return;
  $("artifact-view").hidden = false;
  $("artifact-view-name").textContent = name;
  $("artifact-view-content").textContent = text;
}

function renderSessions(rows) {
  $("session-body").replaceChildren(...(rows || []).slice().reverse().map((s) =>
    el("tr", {}, el("td", { text: s.seq }), el("td", { text: reasonText(s.reason) }),
      el("td", { text: s.turn_count }), el("td", { text: fmtNum(s.n_ctx) }),
      el("td", { text: fmtTime(s.started_at) }), el("td", { text: s.ended_at ? fmtTime(s.ended_at) : "pågår" }))));
}

function renderLiveStatus() {
  const m = S.missions.get(S.selected);
  if (!m) return;
  const live = S.detail && S.detail.live;
  if (live || m.phase === "GENERATING") $("live-status").textContent = `Tur ${live ? live.turn : ""} genereras…`;
}

async function showLastResponse() {
  const id = S.selected;
  const data = await guarded(() => api("GET", `/api/missions/${id}/turns?limit=3`));
  if (!data || S.selected !== id) return;
  const done = data.turns.find((t) => t.state === "COMPLETED");
  if (!done) { $("live-status").textContent = "Inget svar ännu."; return; }
  const full = await guarded(() => api("GET", `/api/missions/${id}/turns/${done.number}`));
  if (!full || S.selected !== id) return;
  $("live-status").textContent = `Senaste svar (tur ${done.number}, ${fmtTime(done.completed_at)}):`;
  $("live-content").textContent = "";
  replaceKids($("live-last"), responseView(full.turn.assistant_content));
  $("live-reasoning").textContent = full.turn.reasoning_content || "";
  $("live-reasoning-box").hidden = !full.turn.reasoning_content;
}

// ------------------------------------------------------------------ turns

async function loadTurns(reset) {
  const id = S.selected;
  if (!id) return;
  const q = !reset && S.turnsOldest ? `?before=${S.turnsOldest}&limit=30` : "?limit=30";
  const data = await guarded(() => api("GET", `/api/missions/${id}/turns${q}`));
  if (!data || S.selected !== id) return;
  const list = $("turn-list");
  if (reset) list.replaceChildren();
  for (const t of data.turns) list.append(turnItem(t));
  if (data.turns.length) S.turnsOldest = data.turns[data.turns.length - 1].number;
  $("turns-more").hidden = data.turns.length < 30;
  for (const n of S.expanded) expandTurn(n, true);
}

function turnItem(t) {
  const p = t.parse || {};
  const status = p.status ? `${p.status}` : t.state;
  const tokens = t.prompt_tokens ? `${fmtNum(t.prompt_tokens)}+${fmtNum(t.completion_tokens)} tok` : "";
  const li = el("li", { dataset: { number: t.number } },
    el("div", { class: "turn-head", onclick: () => toggleTurn(t.number) },
      el("span", { class: "n", text: `#${t.number}` }),
      el("span", { class: "badge", text: t.message_type === "CONTINUATION" ? status : `${t.message_type} · ${status}` }),
      el("span", { class: "sum", text: p.summary || t.objective }),
      el("span", { class: "muted small", text: tokens })),
    el("div", { class: "turn-body", hidden: true }));
  return li;
}

function toggleTurn(n) {
  if (S.expanded.has(n)) {
    S.expanded.delete(n);
    const li = $("turn-list").querySelector(`li[data-number="${n}"]`);
    if (li) li.querySelector(".turn-body").hidden = true;
  } else {
    S.expanded.add(n);
    expandTurn(n, false);
  }
}

async function expandTurn(n, fromCache) {
  const id = S.selected;
  const li = $("turn-list").querySelector(`li[data-number="${n}"]`);
  if (!li) return;
  let t = fromCache ? S.turnCache.get(n) : null;
  if (!t) {
    const data = await guarded(() => api("GET", `/api/missions/${id}/turns/${n}`));
    if (!data || S.selected !== id) return;
    t = data.turn;
    if (t.state === "COMPLETED" && t.decision && Object.keys(t.decision).length) S.turnCache.set(n, t);
  }
  const body = li.querySelector(".turn-body");
  const d = t.decision || {};
  const p = t.parse || {};
  replaceKids(body,
    el("div", { class: "muted small", text:
      `${t.state} · försök ${t.attempts} · session-tur ${t.session_turn} · finish ${t.finish_reason || "–"} · ` +
      `tolkning ${p.mode || "–"}${(p.errors || []).length ? " (" + p.errors.join(", ") + ")" : ""}` +
      (t.timings && t.timings.elapsed_s ? ` · ${t.timings.elapsed_s} s` : "") +
      (t.cached_tokens ? ` · cache ${fmtNum(t.cached_tokens)}` : "") }),
    d.action ? el("div", { class: "small", text: `Beslut: ${d.action} – ${reasonText(d.reason)}` +
      (d.rotate ? ` · ny session (${reasonText(d.rotate)})` : "") +
      (d.review ? ` · granskning ${d.review}: ${(d.review_verdict || {}).verdict || "ej tillgänglig"}` : "") }) : null,
    t.error ? el("div", { class: "error small", text: t.error }) : null,
    el("h4", { text: "Mål" }), el("pre", { class: "msg", text: t.objective }),
    p.next_step ? el("h4", { text: "Föreslaget nästa steg" }) : null,
    p.next_step ? el("pre", { class: "msg", text: p.next_step }) : null,
    (t.receipts || []).length ? el("h4", { text: "Kvitton" }) : null,
    (t.receipts || []).length ? el("ul", { class: "receipts" }, ...t.receipts.map((r) =>
      el("li", { class: r.status, text: `${r.area} ${r.op} ${r.target || ""}: ${r.status}${r.reason ? " (" + r.reason + ")" : ""}` }))) : null,
    el("details", {}, el("summary", { text: "Prompt till modellen" }), el("pre", { class: "msg", text: t.user_content || "(inte renderad än)" })),
    t.reasoning_content ? el("details", {}, el("summary", { text: "Resonemang" }), el("pre", { class: "msg", text: t.reasoning_content })) : null,
    el("h4", { text: "Svar" }), responseView(t.assistant_content));
  body.hidden = false;
}

// ------------------------------------------------------------------ events

function eventRow(ev, withMission) {
  const mission = withMission ? (S.missions.get(ev.mission_id) || {}).title || ev.mission_id || "–" : null;
  return el("tr", {}, el("td", { text: fmtTime(ev.at) }),
    withMission ? el("td", { text: mission }) : null,
    el("td", { text: EVENT[ev.kind] || ev.kind }), el("td", { text: compactJson(ev.detail) }));
}

async function loadMissionEvents() {
  const id = S.selected;
  const data = await guarded(() => api("GET", `/api/missions/${id}/events?limit=200`));
  if (!data || S.selected !== id) return;
  $("mission-events").replaceChildren(...data.events.map((e) => eventRow(e, false)));
}

async function loadGlobalEvents() {
  const data = await guarded(() => api("GET", "/api/events?limit=300"));
  if (!data) return;
  $("global-events").replaceChildren(...data.events.map((e) => eventRow(e, true)));
}

// ------------------------------------------------------------------ live stream

function connectStream() {
  const want = S.selected || null;
  if (S.es && S.esMission === want) return;
  if (S.es) S.es.close();
  S.esMission = want;
  const es = new EventSource("/api/stream" + (want ? `?mission=${encodeURIComponent(want)}` : ""));
  S.es = es;
  es.onmessage = (msg) => {
    let data;
    try { data = JSON.parse(msg.data); } catch { return; }
    handleStream(data);
  };
}

function scheduleDetailRefresh() {
  clearTimeout(S.refreshTimer);
  S.refreshTimer = setTimeout(() => loadDetail(false), 400);
}

function handleStream(data) {
  switch (data.type) {
    case "hello":
      renderLlama(data.llama);
      loadMissions();
      if (S.selected) loadDetail(false);
      break;
    case "llama":
      renderLlama(data.llama);
      loadStatus();
      break;
    case "mission": {
      const m = data.mission;
      const prev = S.missions.get(m.id);
      S.missions.set(m.id, m);
      renderMissionList();
      if (m.id === S.selected) {
        renderSummary(m);
        if (prev && prev.phase !== m.phase && m.phase === "GENERATING") {
          resetLive();
          $("live-status").textContent = `Tur genereras…`;
        }
      }
      break;
    }
    case "mission_deleted":
      S.missions.delete(data.mission_id);
      if (data.mission_id === S.selected) closeDetail(); else renderMissionList();
      break;
    case "live":
      if (data.mission_id === S.selected) {
        $("live-last").replaceChildren();
        $("live-content").textContent = data.live.content;
        $("live-reasoning").textContent = data.live.reasoning;
        $("live-reasoning-box").hidden = !data.live.reasoning;
        $("live-status").textContent = `Tur ${data.live.turn} genereras…`;
      }
      break;
    case "delta":
      if (data.mission_id === S.selected) {
        if ($("live-last").childElementCount) resetLive();
        if (data.content) $("live-content").append(data.content);
        if (data.reasoning) {
          $("live-reasoning-box").hidden = false;
          $("live-reasoning").append(data.reasoning);
        }
        $("live-status").textContent = `Tur ${data.turn} genereras…`;
        const box = $("live-content");
        if (box.scrollHeight - box.scrollTop - box.clientHeight < 80) box.scrollTop = box.scrollHeight;
      }
      break;
    case "turn":
      if (data.mission_id === S.selected) {
        scheduleDetailRefresh();
        if (S.tab === "turns") loadTurns(true);
        if (S.tab === "live" && S.missions.get(S.selected)?.phase !== "GENERATING") showLastResponse();
      }
      break;
    case "event": {
      const ev = data.event;
      if (S.view === "events") $("global-events").prepend(eventRow(ev, true));
      if (ev.mission_id && ev.mission_id === S.selected && S.tab === "events") $("mission-events").prepend(eventRow(ev, false));
      if (["INSTRUCTION_ADDED", "INSTRUCTION_DELETED", "SESSION_ROTATED", "SESSION_STARTED"].includes(ev.kind)
          && ev.mission_id === S.selected) scheduleDetailRefresh();
      break;
    }
    case "settings":
      S.settings = data.settings;
      break;
    case "resync":
      S.es.close();
      S.es = null;
      connectStream();
      break;
  }
}

// ------------------------------------------------------------------ actions

async function missionAction(act) {
  const id = S.selected;
  const m = S.missions.get(id);
  if (!m) return;
  if (act === "export") {
    window.location.href = `/api/missions/${encodeURIComponent(id)}/export`;
    return;
  }
  if (act === "stop" && !confirm(`Stoppa "${m.title}"? En pågående generering avbryts.`)) return;
  if (act === "delete") {
    if (!confirm(`Ta bort "${m.title}" med alla turer, minne och artefakter? Detta går inte att ångra.`)) return;
    await guarded(async () => { await api("DELETE", `/api/missions/${id}`); closeDetail(); await loadMissions(); });
    return;
  }
  await guarded(async () => {
    const data = await api("POST", `/api/missions/${id}/${act}`);
    S.missions.set(id, data.mission);
    renderSummary(data.mission);
    renderMissionList();
    toast({ start: "Startat", pause: "Paus begärd", resume: "Återupptaget", stop: "Stoppat",
      rotate: "Ny session vid nästa tur" }[act] || "OK");
  });
}

async function sendInstruction(ev) {
  ev.preventDefault();
  const text = $("instr-text").value.trim();
  if (!text) { toast("Skriv en instruktion först.", true); return; }
  const ok = await guarded(() => api("POST", `/api/missions/${S.selected}/instructions`,
    { text, resume: $("instr-resume").checked }));
  if (ok) {
    forceField($("instr-text"), "");
    toast("Instruktionen går med i nästa prompt.");
    await loadDetail();
  }
}

async function reopenMission() {
  const text = $("instr-text").value.trim();
  if (!text) { toast("Skriv vad modellen ska göra när uppdraget öppnas igen.", true); return; }
  const ok = await guarded(() => api("POST", `/api/missions/${S.selected}/reopen`, { instruction: text }));
  if (ok) {
    forceField($("instr-text"), "");
    toast("Uppdraget öppnas igen i en ny session.");
    await loadDetail();
  }
}

async function changePriority() {
  const sel = $("d-priority");
  const ok = await guarded(() => api("PATCH", `/api/missions/${S.selected}`, { priority: sel.value }));
  clearDirty(sel);
  if (ok) toast(`Prioritet: ${PRIO[sel.value]}`);
}

async function saveEdit(ev) {
  ev.preventDefault();
  const m = S.detail && S.detail.mission;
  if (!m) return;
  const patch = {};
  const title = $("ed-title").value.trim();
  const goal = $("ed-goal").value.trim();
  const maxTurns = parseInt($("ed-max-turns").value, 10);
  if (title !== m.title) patch.title = title;
  if (goal !== m.goal) patch.goal = goal;
  if (maxTurns !== m.max_turns) patch.max_turns = maxTurns;
  if (!Object.keys(patch).length) { toast("Inga ändringar."); return; }
  const ok = await guarded(() => api("PATCH", `/api/missions/${S.selected}`, patch));
  if (ok) {
    clearDirty($("ed-title"), $("ed-goal"), $("ed-max-turns"));
    toast(patch.goal ? "Sparat. Ny uppdragstext gäller från nästa session." : "Sparat.");
    await loadDetail(true);
  }
}

async function saveAsTemplate(source) {
  const body = source === "edit"
    ? { label: $("ed-title").value, title: $("ed-title").value, goal: $("ed-goal").value,
        priority: S.detail.mission.priority, max_turns: parseInt($("ed-max-turns").value, 10) }
    : { label: $("nm-title").value, title: $("nm-title").value, goal: $("nm-goal").value,
        priority: $("nm-priority").value, max_turns: parseInt($("nm-max-turns").value, 10) };
  const ok = await guarded(() => api("POST", "/api/templates", body));
  if (ok) toast("Sparat som mall.");
}

// ------------------------------------------------------------------ new mission

async function openNewMission(template) {
  S.selected = null;
  renderMissionList();
  $("detail").hidden = true;
  $("detail-placeholder").hidden = true;
  $("new-mission-form").hidden = false;
  const data = await guarded(() => api("GET", "/api/templates"));
  S.templates = data ? data.templates : [];
  const sel = $("nm-template");
  sel.replaceChildren(el("option", { value: "", text: "— ingen —" }),
    ...S.templates.map((t) => el("option", { value: t.id, text: t.label })));
  const defaults = S.settings ? S.settings.missions : { default_max_turns: 200, default_priority: "NORMAL" };
  forceField($("nm-title"), template ? template.title : "");
  forceField($("nm-goal"), template ? template.goal : "");
  forceField($("nm-priority"), template ? template.priority : defaults.default_priority);
  forceField($("nm-max-turns"), template ? template.max_turns : defaults.default_max_turns);
  sel.value = template ? template.id : "";
  $("nm-goal").focus();
}

function applyTemplateToForm() {
  const t = S.templates.find((x) => x.id === $("nm-template").value);
  if (!t) return;
  forceField($("nm-title"), t.title);
  forceField($("nm-goal"), t.goal);
  forceField($("nm-priority"), t.priority);
  forceField($("nm-max-turns"), t.max_turns);
}

async function createMission(ev) {
  ev.preventDefault();
  const body = {
    title: $("nm-title").value.trim(), goal: $("nm-goal").value, priority: $("nm-priority").value,
    max_turns: parseInt($("nm-max-turns").value, 10) || undefined, start: $("nm-start").checked,
    template_id: $("nm-template").value || "",
  };
  if ($("nm-save-template").checked) await saveAsTemplate("new");
  const data = await guarded(() => api("POST", "/api/missions", body));
  if (!data) return;
  clearDirty($("nm-title"), $("nm-goal"), $("nm-priority"), $("nm-max-turns"));
  $("new-mission-form").hidden = true;
  S.missions.set(data.mission.id, data.mission);
  await selectMission(data.mission.id);
}

// ------------------------------------------------------------------ templates view

async function loadTemplates() {
  const data = await guarded(() => api("GET", "/api/templates"));
  if (!data) return;
  S.templates = data.templates;
  $("template-list").replaceChildren(...S.templates.map((t) =>
    el("li", { class: t.id === S.selectedTemplate ? "selected" : "", onclick: () => editTemplate(t.id) },
      el("div", { class: "t", text: t.label }),
      el("div", { class: "m", text: `${PRIO[t.priority]} · max ${t.max_turns} turer` }))));
  $("template-empty").hidden = S.templates.length > 0;
}

function editTemplate(id) {
  const t = S.templates.find((x) => x.id === id) || null;
  S.selectedTemplate = t ? t.id : null;
  $("template-form").hidden = false;
  $("template-placeholder").hidden = true;
  $("tf-heading").textContent = t ? "Redigera mall" : "Ny mall";
  forceField($("tf-label"), t ? t.label : "");
  forceField($("tf-title"), t ? t.title : "");
  forceField($("tf-goal"), t ? t.goal : "");
  forceField($("tf-priority"), t ? t.priority : "NORMAL");
  forceField($("tf-max-turns"), t ? t.max_turns : 200);
  $("tf-delete").hidden = !t;
  $("tf-use").hidden = !t;
  loadTemplates();
}

async function saveTemplate(ev) {
  ev.preventDefault();
  const body = { label: $("tf-label").value, title: $("tf-title").value, goal: $("tf-goal").value,
    priority: $("tf-priority").value, max_turns: parseInt($("tf-max-turns").value, 10) };
  const data = await guarded(() => S.selectedTemplate
    ? api("PUT", `/api/templates/${S.selectedTemplate}`, body)
    : api("POST", "/api/templates", body));
  if (!data) return;
  S.selectedTemplate = data.template.id;
  clearDirty($("tf-label"), $("tf-title"), $("tf-goal"), $("tf-priority"), $("tf-max-turns"));
  toast("Mallen sparad.");
  await loadTemplates();
  editTemplate(data.template.id);
}

// ------------------------------------------------------------------ settings view

async function loadSettings() {
  const data = await guarded(() => api("GET", "/api/settings"));
  if (!data) return;
  S.settings = data.settings;
  S.spec = data.spec;
  const root = $("settings-fields");
  if (!root.dataset.built) {
    root.replaceChildren();
    for (const [section, keys] of Object.entries(data.spec)) {
      const box = el("div", { class: "settings-section" }, el("h3", { text: SECTION_TEXT[section] || section }));
      for (const [key, spec] of Object.entries(keys)) {
        const id = `set-${section}-${key}`;
        const [label, help] = SETTING_TEXT[`${section}.${key}`] || [key, ""];
        let input;
        if (spec.kind === "choice") {
          input = el("select", { id }, ...spec.choices.map((c) => el("option", { value: c, text: c })));
        } else if (spec.kind === "bool") {
          input = el("input", { id, type: "checkbox" });
        } else {
          input = el("input", { id, type: "number", min: spec.min, max: spec.max, step: spec.kind === "float" ? "0.01" : "1" });
        }
        input.dataset.section = section;
        input.dataset.key = key;
        input.dataset.kind = spec.kind;
        trackDirty(input);
        box.append(el("div", { class: "setting" }, el("label", { for: id, text: label }), input,
          el("span", { class: "help", text: `${help} (standard ${spec.default}${spec.min !== undefined ? `, ${spec.min}–${spec.max}` : ""})` })));
      }
      root.append(box);
    }
    root.dataset.built = "1";
  }
  for (const input of root.querySelectorAll("[data-section]")) {
    setField(input, data.settings[input.dataset.section][input.dataset.key]);
  }
  renderLlamaDetails();
}

async function saveSettings(ev) {
  ev.preventDefault();
  const patch = {};
  for (const input of $("settings-fields").querySelectorAll("[data-section]")) {
    const { section, key, kind } = input.dataset;
    let value;
    if (kind === "bool") value = input.checked;
    else if (kind === "int") value = parseInt(input.value, 10);
    else if (kind === "float") value = parseFloat(input.value);
    else value = input.value;
    if (value !== S.settings[section][key]) (patch[section] ||= {})[key] = value;
  }
  if (!Object.keys(patch).length) { toast("Inga ändringar."); return; }
  const data = await guarded(() => api("PUT", "/api/settings", patch));
  if (!data) return;
  for (const input of $("settings-fields").querySelectorAll("[data-section]")) clearDirty(input);
  toast("Inställningarna är sparade.");
  await loadSettings();
}

// ------------------------------------------------------------------ init

function bind() {
  for (const b of $("main-nav").querySelectorAll("button")) b.addEventListener("click", () => showView(b.dataset.view));
  $("mission-filter").addEventListener("change", renderMissionList);
  $("new-mission-btn").addEventListener("click", () => openNewMission(null));
  $("nm-cancel").addEventListener("click", () => { $("new-mission-form").hidden = true; $("detail-placeholder").hidden = false; });
  $("nm-template").addEventListener("change", applyTemplateToForm);
  $("new-mission-form").addEventListener("submit", createMission);
  for (const b of $("d-actions").querySelectorAll("button")) b.addEventListener("click", () => missionAction(b.dataset.act));
  $("d-priority").addEventListener("change", changePriority);
  $("instruction-form").addEventListener("submit", sendInstruction);
  $("reopen-btn").addEventListener("click", reopenMission);
  $("edit-form").addEventListener("submit", saveEdit);
  $("ed-template").addEventListener("click", () => saveAsTemplate("edit"));
  $("turns-more").addEventListener("click", () => loadTurns(false));
  for (const b of $("detail-tabs").querySelectorAll("button")) {
    b.addEventListener("click", () => {
      S.tab = b.dataset.tab;
      for (const x of $("detail-tabs").querySelectorAll("button")) x.classList.toggle("active", x === b);
      for (const t of ["live", "turns", "memory", "artifacts", "sessions", "events", "mission"]) $(`tab-${t}`).hidden = t !== S.tab;
      if (S.tab === "turns") loadTurns(true);
      if (S.tab === "events") loadMissionEvents();
      if (S.tab === "live" && !(S.detail && S.detail.live)) showLastResponse();
    });
  }
  $("new-template-btn").addEventListener("click", () => editTemplate(null));
  $("template-form").addEventListener("submit", saveTemplate);
  $("tf-delete").addEventListener("click", async () => {
    if (!S.selectedTemplate || !confirm("Ta bort mallen?")) return;
    const ok = await guarded(() => api("DELETE", `/api/templates/${S.selectedTemplate}`));
    if (ok) { S.selectedTemplate = null; $("template-form").hidden = true; $("template-placeholder").hidden = false; loadTemplates(); }
  });
  $("tf-use").addEventListener("click", () => {
    const t = S.templates.find((x) => x.id === S.selectedTemplate);
    showView("missions");
    openNewMission(t);
  });
  $("settings-form").addEventListener("submit", saveSettings);
  $("settings-reset").addEventListener("click", async () => {
    if (!confirm("Återställ alla inställningar till konfigurationsfilens värden?")) return;
    const ok = await guarded(() => api("POST", "/api/settings/reset"));
    if (ok) {
      for (const input of $("settings-fields").querySelectorAll("[data-section]")) clearDirty(input);
      await loadSettings();
      toast("Återställt.");
    }
  });
  $("login-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      await api("POST", "/api/login", { token: $("login-token").value });
      $("login-token").value = "";
      $("main-nav").hidden = false;
      await start();
    } catch (e) {
      $("login-error").textContent = e.message;
      $("login-error").hidden = false;
    }
  });
  $("logout-btn").addEventListener("click", async () => {
    await guarded(() => api("POST", "/api/logout"));
    location.reload();
  });
  // The instruction box is never filled from the server, so it needs no edit guard.
  trackDirty($("ed-title"), $("ed-goal"), $("ed-max-turns"), $("d-priority"),
    $("nm-title"), $("nm-goal"), $("nm-priority"), $("nm-max-turns"),
    $("tf-label"), $("tf-title"), $("tf-goal"), $("tf-priority"), $("tf-max-turns"));
  setInterval(() => {
    const m = S.missions.get(S.selected);
    if (m && (m.phase === "RECOVERING" || m.phase === "PAUSED")) renderSummary(m);
  }, 1000);
  setInterval(loadStatus, 15000);
}

async function start() {
  showView("missions");
  await Promise.all([loadStatus(), loadMissions(), guarded(async () => {
    const data = await api("GET", "/api/settings");
    S.settings = data.settings;
  })]);
  connectStream();
}

async function init() {
  bind();
  S.session = await guarded(() => api("GET", "/api/session"));
  if (S.session) {
    $("app-version").textContent = `v${S.session.version}`;
    $("logout-btn").hidden = !S.session.auth_required;
    if (S.session.auth_required && !S.session.authenticated) { showLogin(); return; }
  }
  await start();
}

document.addEventListener("DOMContentLoaded", init);
