import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("v1.8.2 version identity is coherent across executable package surfaces", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const pkg = JSON.parse(read("package.json"));
  const contracts = read("lib/contracts.mjs");
  const content = read("content.js");
  const sidepanel = read("sidepanel.html");
  assert.equal(read("VERSION").trim(), "1.8.2");
  assert.equal(manifest.version, "1.8.2");
  assert.equal(pkg.version, "1.8.2");
  assert.match(contracts, /APP_VERSION\s*=\s*"1\.8\.2"/);
  assert.match(content, /CONTENT_VERSION\s*=\s*"1\.8\.2"/);
  assert.match(sidepanel, /Greenfield\s*<span>v1\.8\.2<\/span>/);
});

test("v1.3.7 side panel exposes serial mission work queue and adjustable global parameters", () => {
  const html = read("sidepanel.html");
  const js = read("sidepanel.js");
  for (const id of [
    "queueSavedMissionSelect",
    "queueAddMission",
    "queueStart",
    "queueStop",
    "missionQueueList",
    "defaultMissionQuantumInteractions",
    "queuePriorityAgingSeconds",
    "queueSwitchDelaySeconds",
    "queueSwitchHardReload",
    "queueSwitchSettleSeconds",
    "saveQueueSettings"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /Uppdragskö/);
  assert.match(html, /queueSavedMissionSelect[^>]*multiple/);
  assert.match(js, /selectedOptions/);
  assert.match(js, /EIC_GF_QUEUE_START/);
  assert.match(js, /EIC_GF_QUEUE_STOP/);
  assert.match(js, /EIC_GF_QUEUE_MUTATE/);
  assert.match(js, /EIC_GF_SET_QUEUE_SETTINGS/);
  assert.match(js, /queueSwitchDelaySeconds/);
  assert.match(js, /MISSION_WORK_QUEUE_ACTIVE_QUANTUM_IMMUTABLE|data-queue-field="maxInteractions"/);
});

test("v1.3.7 background keeps multi-window scheduler while serializing missions inside one worker", () => {
  const background = read("background.js");
  assert.match(background, /requestGlobalTurnSlot/);
  assert.match(background, /DEFAULT_MAX_ACTIVE_SESSIONS/);
  assert.match(background, /async function activateQueueItem/);
  assert.match(background, /async function parkQueueMissionAfterAnalysis/);
  assert.match(background, /async function finalizeQueueTerminalAndMaybeAdvance/);
  assert.match(background, /QUEUE_STATUS\.DONE/);
  assert.match(background, /QUEUE_STATUS\.BLOCKED/);
  assert.match(background, /selectNextMissionItem/);
});

test("mission switch uses fresh-chat verification plus optional hard reload, not reload as isolation", () => {
  const background = read("background.js");
  assert.match(background, /chrome\.tabs\.update\(tab\.id,\s*\{\s*url:\s*gptRoot\s*\}\)/);
  assert.match(background, /Number\(page\.userCount\s*\|\|\s*0\)\s*===\s*0/);
  assert.match(background, /newChatVerified:\s*true/);
  assert.match(background, /chrome\.tabs\.reload\(tab\.id,\s*\{\s*bypassCache:\s*true\s*\}\)/);
  assert.match(background, /switchNotBeforeAtMs/);
  assert.match(background, /queueSwitchDelaySeconds/);
});

test("queue prompt contract checkpoint and explicit YIELD_TO_QUEUE control are wired end-to-end", () => {
  const a2a = read("lib/a2a.mjs");
  const responseContract = read("lib/response-contract.mjs");
  const sessionRotation = read("lib/session-rotation.mjs");
  const control = read("lib/greenfield-control.mjs");
  assert.match(a2a, /checkpointRequired=true/);
  assert.match(a2a, /persist/i);
  assert.match(a2a, /correct owner/i);
  assert.match(a2a, /YIELD_TO_QUEUE/);
  assert.match(responseContract, /YIELD_TO_QUEUE/);
  assert.match(sessionRotation, /YIELD_TO_QUEUE/);
  assert.match(control, /YIELD_TO_QUEUE/);
});
