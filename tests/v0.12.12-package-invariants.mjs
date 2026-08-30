import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
const results = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    results.push({ name, status: "PASS" });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: "FAIL", error: String(error?.stack || error) });
    console.error(`FAIL ${name}\n${error?.stack || error}`);
  }
}
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
const files = walk(ROOT);
const jsFiles = files.filter((p) => /\.(?:m?js)$/u.test(p));
const moduleFiles = jsFiles.filter((p) => p.endsWith(".mjs") || /\b(?:import|export)\b/u.test(fs.readFileSync(p, "utf8")));

function resolveRelative(from, spec) {
  let candidate = path.resolve(path.dirname(from), spec);
  const candidates = [candidate, candidate + ".mjs", candidate + ".js"];
  return candidates.find((p) => fs.existsSync(p)) || null;
}
const importSpecRe = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["'](\.[^"']+)["']/gu;
const namedImportRe = /import\s*\{([\s\S]*?)\}\s*from\s*["'](\.[^"']+)["']/gu;
const exportDeclRe = /export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gu;
const exportListRe = /export\s*\{([\s\S]*?)\}(?:\s*from\s*["'][^"']+["'])?\s*;?/gu;

await test("release identity agrees across manifest/contracts/content", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const contracts = fs.readFileSync(path.join(ROOT, "lib/contracts.mjs"), "utf8");
  const content = fs.readFileSync(path.join(ROOT, "content.js"), "utf8");
  assert.equal(manifest.version, "0.12.12");
  assert.match(contracts, /APP_VERSION = "0\.12\.12"/u);
  assert.match(contracts, /CONTENT_SCRIPT_VERSION = "0\.12\.12"/u);
  assert.match(content, /VERSION = "0\.12\.12"/u);
});

await test("manifest entry points and icon files exist", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const refs = [
    manifest.background?.service_worker,
    manifest.side_panel?.default_path,
    ...(manifest.content_scripts || []).flatMap((x) => x.js || []),
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {})
  ].filter(Boolean);
  for (const ref of refs) {
    assert.ok(fs.existsSync(path.join(ROOT, ref)), ref);
  }
});

await test("manifest declares Chrome API permissions used by privileged paths", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const granted = new Set(manifest.permissions || []);
  for (const required of ["sidePanel", "storage", "tabs", "scripting", "alarms", "debugger"]) {
    assert.ok(granted.has(required), required);
  }
  assert.ok((manifest.host_permissions || []).includes("https://chatgpt.com/*"));
  assert.ok((manifest.optional_host_permissions || []).includes("https://*/*"));
});

await test("all JS/MJS files pass node --check", () => {
  const failures = [];
  for (const file of jsFiles) {
    const result = childProcess.spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) failures.push({ file: path.relative(ROOT, file), stderr: result.stderr });
  }
  assert.deepEqual(failures, []);
});

await test("all relative imports resolve", () => {
  const missing = [];
  for (const file of moduleFiles) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(importSpecRe)) {
      if (!resolveRelative(file, match[1])) missing.push([path.relative(ROOT, file), match[1]]);
    }
  }
  assert.deepEqual(missing, []);
});

await test("all local named imports resolve to exported bindings", () => {
  const missing = [];
  for (const file of moduleFiles) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(namedImportRe)) {
      const target = resolveRelative(file, match[2]);
      if (!target) continue;
      const targetText = fs.readFileSync(target, "utf8");
      const exports = new Set([...targetText.matchAll(exportDeclRe)].map((m) => m[1]));
      for (const block of targetText.matchAll(exportListRe)) {
        for (const raw of block[1].split(",")) {
          const m = raw.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?/u);
          if (m) exports.add(m[2] || m[1]);
        }
      }
      for (const raw of match[1].split(",")) {
        const m = raw.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?/u);
        if (m && !exports.has(m[1])) {
          missing.push([path.relative(ROOT, file), match[2], m[1]]);
        }
      }
    }
  }
  assert.deepEqual(missing, []);
});

await test("local ESM import graph is acyclic", () => {
  const nodes = new Set(moduleFiles.map((p) => path.resolve(p)));
  const graph = new Map();
  for (const file of moduleFiles) {
    const deps = [];
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(importSpecRe)) {
      const resolved = resolveRelative(file, match[1]);
      if (resolved && nodes.has(path.resolve(resolved))) deps.push(path.resolve(resolved));
    }
    graph.set(path.resolve(file), deps);
  }
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const cycles = [];
  function visit(node) {
    if (visiting.has(node)) {
      const at = stack.indexOf(node);
      cycles.push(stack.slice(at).concat(node).map((x) => path.relative(ROOT, x)));
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    stack.push(node);
    for (const dep of graph.get(node) || []) visit(dep);
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }
  for (const node of nodes) visit(node);
  assert.deepEqual(cycles, []);
});

await test("all lib modules evaluate without top-level exception", async () => {
  const libFiles = fs.readdirSync(path.join(ROOT, "lib")).filter((f) => f.endsWith(".mjs")).sort();
  const failures = [];
  for (const file of libFiles) {
    try {
      await import(pathToFileURL(path.join(ROOT, "lib", file)).href + `?pkg=${Date.now()}-${Math.random()}`);
    } catch (error) {
      failures.push([file, String(error?.stack || error)]);
    }
  }
  assert.deepEqual(failures, []);
});

await test("nullable identity coercion trap remains absent", () => {
  const hits = [];
  for (const file of jsFiles) {
    const rel = path.relative(ROOT, file);
    if (rel.startsWith(`tests${path.sep}`)) continue;
    if (fs.readFileSync(file, "utf8").includes("Number.isInteger(Number(")) hits.push(rel);
  }
  assert.deepEqual(hits, []);
});

await test("ordinary Nano does not inherit an unbounded/null mode deadline", () => {
  const side = fs.readFileSync(path.join(ROOT, "sidepanel.js"), "utf8");
  assert.doesNotMatch(side, /modeDeadlineMs\s*:\s*null/u);
  assert.match(side, /NANO_CONTINUATION_ANALYSIS_DEADLINE_MS/u);
});

await test("owner-invalidated Nano cannot fall through to stale failure receipt", () => {
  const side = fs.readFileSync(path.join(ROOT, "sidepanel.js"), "utf8");
  const marker = 'if (error instanceof NanoOwnerInvalidatedError';
  const owner = side.indexOf(marker);
  const failure = side.indexOf('await command("NANO_FAILURE"', owner);
  assert.ok(owner >= 0 && failure > owner);
  const segment = side.slice(owner, failure);
  assert.match(segment, /return;/u);
});

await test("product source has no executable-string code generation", () => {
  const hits = [];
  for (const file of jsFiles) {
    const rel = path.relative(ROOT, file);
    if (rel.startsWith(`tests${path.sep}`)) continue;
    const text = fs.readFileSync(file, "utf8");
    if (/\beval\s*\(/u.test(text) || /\bnew\s+Function\b/u.test(text)) hits.push(rel);
  }
  assert.deepEqual(hits, []);
});

await test("product source has no arbitrary remote network client", () => {
  const hits = [];
  for (const file of jsFiles) {
    const rel = path.relative(ROOT, file);
    if (rel.startsWith(`tests${path.sep}`)) continue;
    const text = fs.readFileSync(file, "utf8");
    if (/\bXMLHttpRequest\b|\bWebSocket\b/u.test(text)) hits.push(rel);
    for (const match of text.matchAll(/\bfetch\s*\(([^\n]{0,240})/gu)) {
      if (!/chrome\.runtime\.getURL\(["']build-info\.json["']\)/u.test(match[1])) {
        hits.push(`${rel}:fetch`);
      }
    }
  }
  assert.deepEqual(hits, []);
});

await test("all recurring sidepanel timers have explicit cleanup", () => {
  const side = fs.readFileSync(path.join(ROOT, "sidepanel.js"), "utf8");
  const timerNames = [...side.matchAll(/state\.([A-Za-z_$][\w$]*)\s*=\s*setInterval\s*\(/gu)]
    .map((m) => m[1]);
  assert.ok(timerNames.length > 0);
  for (const name of timerNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    assert.match(side, new RegExp(`clearInterval\\(state\\.${escaped}\\)`, "u"), name);
  }
});

await test("background has no unbound bare calls to exported lib helpers", () => {
  const backgroundPath = path.join(ROOT, "background.js");
  const background = fs.readFileSync(backgroundPath, "utf8");
  const imports = new Set();
  for (const match of background.matchAll(namedImportRe)) {
    for (const raw of match[1].split(",")) {
      const m = raw.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?/u);
      if (m) imports.add(m[2] || m[1]);
    }
  }
  const locals = new Set([
    ...[...background.matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gu)].map((m) => m[1]),
    ...[...background.matchAll(/\b(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/gu)].map((m) => m[1])
  ]);
  const exported = new Set();
  for (const file of fs.readdirSync(path.join(ROOT, "lib")).filter((f) => f.endsWith(".mjs"))) {
    const text = fs.readFileSync(path.join(ROOT, "lib", file), "utf8");
    for (const m of text.matchAll(exportDeclRe)) exported.add(m[1]);
    for (const block of text.matchAll(exportListRe)) {
      for (const raw of block[1].split(",")) {
        const m = raw.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?/u);
        if (m) exported.add(m[2] || m[1]);
      }
    }
  }
  const unbound = [];
  for (const name of exported) {
    if (imports.has(name) || locals.has(name)) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const re = new RegExp("(?<![\\w$.])" + escaped + "\\s*\\(", "u");
    if (re.test(background)) unbound.push(name);
  }
  assert.deepEqual(unbound, []);
});

console.log(JSON.stringify({
  suite: "v0.12.12-package-invariants",
  total: results.length,
  passed,
  failed: results.length - passed,
  jsFiles: jsFiles.length,
  results
}, null, 2));
if (passed !== results.length) process.exit(1);
