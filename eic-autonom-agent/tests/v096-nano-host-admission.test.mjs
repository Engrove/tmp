import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  NANO_HOST_CREATE_TIMEOUT_MS,
  NANO_HOST_STATUS,
  NanoHostCreateTimeoutError,
  buildNanoActivationBinding,
  missionStartAllowed,
  nanoDownloadFraction,
  nanoHostReady,
  nanoHostUiProjection,
  normalizeNanoAvailability,
  withNanoHostCreateDeadline
} from "../lib/nano-host-admission.mjs";

test("v0.9.8 accepts only current Prompt API availability states", () => {
  for (const state of ["available", "downloadable", "downloading", "unavailable"]) {
    assert.equal(normalizeNanoAvailability(state), state);
  }
  assert.equal(normalizeNanoAvailability("readily"), "unknown");
  assert.equal(normalizeNanoAvailability("after-download"), "unknown");
  assert.equal(normalizeNanoAvailability(""), "unknown");
});

test("v0.9.8 download progress is clamped and supports fractional and byte totals", () => {
  assert.equal(nanoDownloadFraction({ loaded: 0.25 }), 0.25);
  assert.equal(nanoDownloadFraction({ loaded: 25, total: 100 }), 0.25);
  assert.equal(nanoDownloadFraction({ loaded: 2 }), 1);
  assert.equal(nanoDownloadFraction({ loaded: -1 }), null);
  assert.equal(nanoDownloadFraction({}), null);
});

test("v0.9.8 ready emit twin requires a real non-stale session", () => {
  const session = {};
  assert.equal(nanoHostReady({
    session,
    status: NANO_HOST_STATUS.AVAILABLE,
    busy: false,
    stale: false
  }), true);
  assert.equal(missionStartAllowed({
    requiresNanoHost: true,
    session,
    status: NANO_HOST_STATUS.AVAILABLE,
    busy: false,
    stale: false
  }), true);
});

test("v0.9.8 block twins reject telemetry-only, busy and stale hosts", () => {
  assert.equal(nanoHostReady({
    session: null,
    status: NANO_HOST_STATUS.AVAILABLE
  }), false, "stale available telemetry is not a session");
  assert.equal(nanoHostReady({
    session: {},
    status: NANO_HOST_STATUS.DOWNLOADING
  }), false);
  assert.equal(nanoHostReady({
    session: {},
    status: NANO_HOST_STATUS.AVAILABLE,
    busy: true
  }), false);
  assert.equal(nanoHostReady({
    session: {},
    status: NANO_HOST_STATUS.AVAILABLE,
    stale: true
  }), false);
});

test("v0.9.8 loading after 100 percent is indeterminate", () => {
  const downloading = nanoHostUiProjection({
    status: NANO_HOST_STATUS.DOWNLOADING,
    progress: 0.42
  });
  assert.equal(downloading.progress, 0.42);
  assert.equal(downloading.progressText, "42 %");
  assert.equal(downloading.indeterminate, false);

  const loading = nanoHostUiProjection({
    status: NANO_HOST_STATUS.LOADING,
    progress: 1
  });
  assert.equal(loading.indeterminate, true);
  assert.equal(loading.progress, null);
  assert.match(loading.progressText, /Extraherar/u);
});

test("v0.9.8 timeout and abort are distinct visible states", () => {
  const timeout = nanoHostUiProjection({ status: NANO_HOST_STATUS.TIMEOUT });
  const aborted = nanoHostUiProjection({ status: NANO_HOST_STATUS.ABORTED });
  assert.equal(timeout.label, "TIMEOUT");
  assert.equal(aborted.label, "AVBRUTEN");
});

test("v0.9.8 activation binding changes with version, mandate or system prompt", () => {
  const base = {
    trustedSession: "window:1|host:a",
    version: "0.10.12",
    modelKind: "LanguageModel",
    languages: ["en"],
    mandateVersion: "nano-core-v4",
    systemPrompt: "A"
  };
  const first = buildNanoActivationBinding(base);
  assert.equal(first, buildNanoActivationBinding(base));
  assert.notEqual(first, buildNanoActivationBinding({ ...base, version: "0.9.12" }));
  assert.notEqual(first, buildNanoActivationBinding({ ...base, mandateVersion: "nano-core-v7" }));
  assert.notEqual(first, buildNanoActivationBinding({ ...base, systemPrompt: "B" }));
});

test("v0.9.8 watchdog aborts and rejects bounded host creation", async () => {
  const abortController = new AbortController();
  await assert.rejects(
    withNanoHostCreateDeadline(new Promise(() => {}), {
      timeoutMs: 10,
      abortController
    }),
    NanoHostCreateTimeoutError
  );
  assert.equal(abortController.signal.aborted, true);
});

test("v0.9.8 host-create watchdog remains above the 1200-second material-progress boundary", () => {
  assert.equal(NANO_HOST_CREATE_TIMEOUT_MS, 1_500_000);
});

test("v0.9.8 create is invoked synchronously before every await", async () => {
  const source = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");
  const start = source.indexOf("function beginNanoCreateFromGesture()");
  const create = source.indexOf("createCall = startOfficialLanguageModelCreate", start);
  assert.ok(start >= 0 && create > start);
  const prefix = source.slice(start, create)
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/\/\/.*$/gmu, "");
  assert.doesNotMatch(prefix, /\bawait\b/u);
});

test("v0.9.8 duplicate activation reuses one in-flight create promise", async () => {
  const source = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");
  const start = source.indexOf("function beginNanoCreateFromGesture()");
  const end = source.indexOf("function abortNanoHostCreate", start);
  const body = source.slice(start, end);
  assert.match(body, /if \(state\.modelCreatePromise\) return state\.modelCreatePromise;/u);
  assert.match(body, /state\.modelCreatePromise = operation;/u);
});

test("v0.9.8 create is abortable and watchdog-protected", async () => {
  const source = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");
  assert.match(source, /signal: abortController\.signal/u);
  assert.match(source, /withNanoHostCreateDeadline/u);
  assert.match(source, /function abortNanoHostCreate/u);
  assert.match(source, /Avbryt LanguageModel-aktivering/u);
});

test("v0.9.8 mission controls are disabled until the host is truly ready", async () => {
  const source = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");
  const start = source.indexOf("function renderControls");
  const end = source.indexOf("function renderSnapshot", start);
  const body = source.slice(start, end);
  assert.match(body, /missionModeRequiresNanoHost/u);
  assert.match(body, /missionStartAllowed/u);
  assert.match(body, /startWaitingButton\.disabled/u);
  assert.match(body, /Aktivera LanguageModel och vänta tills status är KLAR/u);
});

test("v0.9.8 owner telemetry persists admission stage and timestamps", async () => {
  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  for (const token of [
    "eic.autonom.nano-host-telemetry.v4",
    "availability",
    "progress",
    "busy",
    "createStartedAt",
    "createDeadlineAt",
    "lastProgressAt"
  ]) assert.match(source, new RegExp(token, "u"), token);
});

test("v0.9.8 manifest pins one stable unpacked extension identity", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../manifest.json", import.meta.url), "utf8")
  );
  assert.equal(manifest.version, "0.10.12");
  assert.equal(typeof manifest.key, "string");
  assert.ok(manifest.key.length > 300);
  assert.match(manifest.key, /^[A-Za-z0-9+/=]+$/u);
});
