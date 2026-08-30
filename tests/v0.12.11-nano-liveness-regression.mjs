import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href + `?v01211=${Date.now()}-${Math.random()}`);

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

const liveness = await imp("lib/nano-owner-liveness.mjs");
const contracts = await imp("lib/contracts.mjs");
const nanoPipeline = await imp("lib/nano-pipeline.mjs");
const side = fs.readFileSync(path.join(ROOT, "sidepanel.js"), "utf8");
const background = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");

await test("ordinary continuation has bounded 180 second mode deadline", () => {
  assert.equal(liveness.NANO_CONTINUATION_ANALYSIS_DEADLINE_MS, 180_000);
  assert.equal(contracts.NANO_WALL_TIMEOUT_MS, 1_800_000);
});


await test("owner request deadline is absolute and heartbeat cannot extend past it", () => {
  const now = 1_000_000;
  const request = nanoPipeline.createNanoRequest({
    requestId: "r1",
    observationId: "o1",
    mode: nanoPipeline.NANO_ANALYSIS_MODES.CONTINUATION_ANALYSIS,
    graceMs: 180_000,
    now
  });
  const claimed = nanoPipeline.claimNanoRequestState(request, {
    claimId: "c1",
    leaseMs: 1_800_000,
    now
  });
  assert.equal(claimed.ok, true);
  assert.equal(Date.parse(claimed.request.claimLeaseUntil), now + 180_000);
  const progress = nanoPipeline.updateNanoProgressState(claimed.request, {
    claimId: "c1",
    outputChars: 123,
    leaseMs: 1_800_000,
    now: now + 179_000
  });
  assert.equal(progress.ok, true);
  assert.equal(Date.parse(progress.request.claimLeaseUntil), now + 180_000);
  const expired = nanoPipeline.updateNanoProgressState(progress.request, {
    claimId: "c1",
    outputChars: 124,
    leaseMs: 1_800_000,
    now: now + 180_000
  });
  assert.equal(expired.ok, false);
  assert.equal(expired.reason, "REQUEST_DEADLINE_EXPIRED");
  assert.equal(nanoPipeline.nanoClaimLeaseState(progress.request, { now: now + 180_000 }),
    nanoPipeline.NANO_CLAIM_LEASE_STATE.EXPIRED);
});

await test("background creates and rearms continuation requests with the 180 second owner deadline", () => {
  assert.match(background, /function nanoRequestGraceMs\(mode\)[\s\S]{0,180}NANO_CONTINUATION_ANALYSIS_DEADLINE_MS/);
  assert.match(background, /graceMs:\s*nanoRequestGraceMs\(analysisMode\)/);
  assert.match(background, /function renewNanoRequestDeadline\(request, now = Date\.now\(\)\)/);
  assert.doesNotMatch(background, /deadlineAt = nowIso\(now \+ NANO_CLAIM_GRACE_MS\)/);
});

await test("background hard deadline fails the running request instead of requeueing it", () => {
  assert.match(background, /const absoluteDeadlineExpired = Number\.isFinite\(absoluteDeadline\) && now >= absoluteDeadline/);
  assert.match(background, /if \(absoluteDeadlineExpired \|\| Number\(request\.attempts \|\| 0\) >= NANO_MAX_ATTEMPTS\)/);
  assert.match(background, /absoluta modedeadline gick ut; samma request får inte återköas/);
});

await test("new structured owner invalidation is recognized", () => {
  const result = liveness.classifyNanoOwnerHeartbeatFailure(
    new Error("NANO_OWNER_INVALIDATED:NO_ACTIVE_ASSESSING_REQUEST")
  );
  assert.equal(result.invalidated, true);
  assert.equal(result.code, "NANO_OWNER_INVALIDATED");
});

await test("v0.12.10 no-active heartbeat rejection is recognized for upgrade continuity", () => {
  const result = liveness.classifyNanoOwnerHeartbeatFailure(
    new Error("Nano heartbeat saknar aktiv request.")
  );
  assert.equal(result.invalidated, true);
});

await test("owner invalidation survives transport error code plus owner message", () => {
  const result = liveness.classifyNanoOwnerHeartbeatFailure({
    code: "UI_COMMAND_FAILED",
    message: "NANO_OWNER_INVALIDATED:NO_ACTIVE_ASSESSING_REQUEST"
  });
  assert.equal(result.invalidated, true);
  assert.match(result.reason, /NO_ACTIVE_ASSESSING_REQUEST/);
});

await test("stale terminal decision rejection is recognized as owner invalidation", () => {
  const result = liveness.classifyNanoOwnerHeartbeatFailure(
    new Error("Ingen ASSESSING-körning väntar på Nano.")
  );
  assert.equal(result.invalidated, true);
});

await test("transient transport failure is not misclassified as owner invalidation", () => {
  const result = liveness.classifyNanoOwnerHeartbeatFailure(
    new Error("Could not establish connection. Receiving end does not exist.")
  );
  assert.equal(result.invalidated, false);
  assert.equal(result.code, "NANO_HEARTBEAT_TRANSIENT");
});

await test("owner-abort wrapper preserves normal result", async () => {
  const controller = new AbortController();
  const value = await liveness.withNanoOwnerAbort(Promise.resolve("ok"), controller.signal);
  assert.equal(value, "ok");
});

await test("owner-abort wrapper terminates pending provider work", async () => {
  const controller = new AbortController();
  const pending = new Promise((resolve) => setTimeout(() => resolve("late"), 500));
  const wrapped = liveness.withNanoOwnerAbort(pending, controller.signal);
  controller.abort(new liveness.NanoOwnerInvalidatedError("TEST_OWNER_CHANGED"));
  await assert.rejects(wrapped, (error) =>
    error instanceof liveness.NanoOwnerInvalidatedError &&
    error.code === "NANO_OWNER_INVALIDATED" &&
    /TEST_OWNER_CHANGED/.test(error.message)
  );
});

await test("ordinary main and format-repair inference use 180 second mode deadline", () => {
  const occurrences = [...side.matchAll(/NANO_CONTINUATION_ANALYSIS_DEADLINE_MS/g)].length;
  assert.ok(occurrences >= 3, `occurrences=${occurrences}`);
  assert.doesNotMatch(side, /modeDeadlineMs:\s*baselineAnalysisRequest\s*\?\s*BASELINE_ANALYSIS_DEADLINE_MS\s*:\s*null/);
});

await test("Mission Control exposes active per-mode deadline instead of only the 1800 second global wall", () => {
  assert.match(side, /Nano mode \$\{Math\.round\(activeNanoModeWallMs \/ 1000\)\} s · global \$\{Math\.round\(globalNanoWallMs \/ 1000\)\} s/);
});

await test("request-level owner AbortSignal is passed into Nano provider calls", () => {
  assert.match(side, /const ownerAbortController = typeof AbortController === "function" \? new AbortController\(\) : null/);
  assert.match(side, /abortSignal:\s*ownerAbortController\?\.signal \|\| null/);
  assert.match(side, /withNanoOwnerAbort\(withNanoWallDeadline\(/);
});

await test("authoritative heartbeat rejection aborts exact local request", () => {
  assert.match(side, /const ownerFailure = classifyNanoOwnerHeartbeatFailure\(heartbeatError\)/);
  assert.match(side, /if \(ownerFailure\.invalidated\) \{/);
  assert.match(side, /ownerAbortController\?\.abort\?\.\(ownerInvalidationError\)/);
  assert.match(side, /throw ownerInvalidationError/);
});

await test("heartbeat cadence bounds owner invalidation detection to about 10 seconds", () => {
  assert.match(side, /state\.nanoHeartbeatTimer = setInterval\(\(\) => \{[\s\S]*?\}, 10_000\)/);
});

await test("owner invalidation never emits stale NANO_FAILURE receipt", () => {
  const start = side.indexOf("} catch (error) {", side.indexOf("async function processPendingNano"));
  const failure = side.indexOf('await command("NANO_FAILURE"', start);
  assert.ok(start >= 0 && failure > start);
  const ownerBranch = side.slice(start, failure);
  assert.match(ownerBranch, /error instanceof NanoOwnerInvalidatedError/);
  assert.match(ownerBranch, /Owner ändrad · lokal Nano avbruten/);
  const branchIndex = ownerBranch.indexOf("error instanceof NanoOwnerInvalidatedError");
  const returnIndex = ownerBranch.indexOf("return;", branchIndex);
  assert.ok(returnIndex > branchIndex, `branch=${branchIndex} return=${returnIndex}`);
});

await test("terminal owner rejection bypasses NANO_DECISION retry", () => {
  const marker = 'response = await command("NANO_DECISION", terminalDecisionPayload);';
  const first = side.indexOf(marker);
  assert.ok(first >= 0);
  const block = side.slice(first, first + 2800);
  const classify = block.indexOf("classifyNanoOwnerHeartbeatFailure(terminalTransportError)");
  const retry = block.indexOf(marker, marker.length);
  assert.ok(classify > 0 && retry > classify, `classify=${classify} retry=${retry}`);
  assert.match(block.slice(0, retry), /if \(terminalOwnerFailure\.invalidated\)[\s\S]*?throw ownerInvalidationError/);
});

await test("background heartbeat emits structured owner-invalidated errors", () => {
  assert.match(background, /NANO_OWNER_INVALIDATED:NO_ACTIVE_ASSESSING_REQUEST/);
  assert.match(background, /NANO_OWNER_INVALIDATED:STALE_OR_MISCLAIMED_REQUEST/);
  assert.match(background, /NANO_OWNER_INVALIDATED:\$\{progressResult\.reason\}/);
});

await test("foreground target generation retires running ordinary Nano before wait transition", () => {
  const start = background.indexOf("if (pageClassification.state === CHATGPT_RESPONSE_STATES.GENERATING_FOREGROUND)");
  assert.ok(start >= 0);
  const block = background.slice(start, start + 5000);
  const clear = block.indexOf("run.pendingNanoRequest = null;");
  const transition = block.indexOf("STATES.WAITING_FOREGROUND", clear);
  assert.ok(clear >= 0 && transition > clear, `clear=${clear} transition=${transition}`);
  assert.match(block, /run\.pendingNanoRequest\?\.sessionContextBaselineAnalysis !== true/);
  assert.match(block, /lastError: "NANO_OWNER_INVALIDATED:TARGET_GENERATING_FOREGROUND"/);
});

await test("baseline Nano is excluded from ordinary foreground supersession branch", () => {
  const start = background.indexOf("if (pageClassification.state === CHATGPT_RESPONSE_STATES.GENERATING_FOREGROUND)");
  const block = background.slice(start, start + 2600);
  assert.match(block, /sessionContextBaselineAnalysis !== true/);
});

await test("complete-JSON early stop and hard output caps remain active", () => {
  assert.match(side, /extractFirstCompleteNanoJsonObject/);
  assert.match(side, /stopOnCompleteJson/);
  assert.match(side, /NANO_DECISION_HARD_OUTPUT_CHARS/);
  assert.match(side, /NANO_RAW_CHUNK_SAFETY_CAP/);
});

await test("streaming while-loop is bounded by idle, owner, wall and output guards", () => {
  const loopStart = side.indexOf("while (true) {", side.indexOf("async function promptNano"));
  assert.ok(loopStart >= 0);
  const block = side.slice(loopStart, loopStart + 7000);
  assert.match(block, /NANO_STREAM_IDLE_TIMEOUT_MS/);
  assert.match(block, /classifyNanoOutputBounds/);
  assert.match(block, /extractFirstCompleteNanoJsonObject/);
  assert.match(side.slice(Math.max(0, loopStart - 1200), loopStart + 7600), /withNanoOwnerAbort\(withNanoWallDeadline/);
});

await test("quota retry loop is bounded by the three-step degrade ladder", async () => {
  const budget = await imp("lib/nano-input-budget.mjs");
  assert.equal(budget.nanoBudgetExhausted(0), false);
  assert.equal(budget.nanoBudgetExhausted(2), false);
  assert.equal(budget.nanoBudgetExhausted(3), true);
  const loopStart = side.indexOf("for (;;) {", side.indexOf("async function processPendingNano"));
  assert.ok(loopStart >= 0);
  const block = side.slice(loopStart, loopStart + 4200);
  assert.match(block, /nanoBudgetExhausted\(degradeAttempt \+ 1\)/);
  assert.match(block, /degradeAttempt \+= 1/);
});

await test("owner-abort listener is removed and owned task session is destroyed", () => {
  assert.match(side, /ownerAbortSignal\?\.removeEventListener\?\.\("abort", ownerAbortForwarder\)/);
  assert.match(side, /if \(task\?\.owned\) \{\s*try \{ task\.session\?\.destroy\?\.\(\); \} catch \{\}\s*\}/);
});

console.log(JSON.stringify({
  suite: "v0.12.11-nano-liveness-regression",
  total: results.length,
  passed,
  failed: results.length - passed,
  results
}, null, 2));
if (passed !== results.length) process.exit(1);
