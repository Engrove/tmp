import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  NANO_HOST_CREATE_TIMEOUT_MS,
  NANO_HOST_PROGRESS_STALL_TIMEOUT_MS,
  NANO_HOST_STATUS,
  NanoHostExternalModelAssetBlockerError,
  createNanoDownloadProgressState,
  missionStartAllowed,
  nanoDownloadBlockerKind,
  nanoDownloadProgressStalled,
  nanoHostUiProjection,
  recordNanoDownloadProgress
} from "../lib/nano-host-admission.mjs";

test("v0.9.8 material-progress boundary is exactly 1200 seconds", () => {
  assert.equal(NANO_HOST_PROGRESS_STALL_TIMEOUT_MS, 1_200_000);
  assert.ok(
    NANO_HOST_CREATE_TIMEOUT_MS > NANO_HOST_PROGRESS_STALL_TIMEOUT_MS,
    "outer create watchdog must not pre-empt material-progress classification"
  );
  assert.equal(NANO_HOST_CREATE_TIMEOUT_MS, 1_500_000);
});

test("v0.9.8 zero progress is asset preparation, not material download progress", () => {
  const start = Date.UTC(2026, 7, 5, 10, 0, 0);
  const observed = recordNanoDownloadProgress(
    createNanoDownloadProgressState({ now: start }),
    { progress: 0, now: start }
  );
  assert.equal(observed.material, false);
  assert.equal(observed.state.progress, 0);
  assert.equal(observed.state.lastMaterialProgressAt, null);
  assert.equal(
    Date.parse(observed.state.stallDeadlineAt) - start,
    NANO_HOST_PROGRESS_STALL_TIMEOUT_MS
  );
});

test("v0.9.8 duplicate zero progress does not extend the 1200-second deadline", () => {
  const start = Date.UTC(2026, 7, 5, 10, 0, 0);
  const first = recordNanoDownloadProgress(
    createNanoDownloadProgressState({ now: start }),
    { progress: 0, now: start }
  );
  const duplicate = recordNanoDownloadProgress(first.state, {
    progress: 0,
    now: start + 600_000
  });
  assert.equal(duplicate.material, false);
  assert.equal(duplicate.state.stallDeadlineAt, first.state.stallDeadlineAt);
});

test("v0.9.8 first positive progress begins DOWNLOADING semantics and resets deadline", () => {
  const start = Date.UTC(2026, 7, 5, 10, 0, 0);
  const prepared = recordNanoDownloadProgress(
    createNanoDownloadProgressState({ now: start }),
    { progress: 0, now: start }
  );
  const advanced = recordNanoDownloadProgress(prepared.state, {
    progress: 0.01,
    now: start + 600_000
  });
  assert.equal(advanced.material, true);
  assert.equal(advanced.state.progress, 0.01);
  assert.ok(advanced.state.lastMaterialProgressAt);
  assert.equal(
    Date.parse(advanced.state.stallDeadlineAt),
    start + 600_000 + NANO_HOST_PROGRESS_STALL_TIMEOUT_MS
  );
});

test("v0.9.8 PREPARING_ASSETS expires into external model asset blocker", () => {
  const start = Date.UTC(2026, 7, 5, 10, 0, 0);
  const state = recordNanoDownloadProgress(
    createNanoDownloadProgressState({ now: start }),
    { progress: 0, now: start }
  ).state;
  assert.equal(nanoDownloadProgressStalled(state, {
    now: start + NANO_HOST_PROGRESS_STALL_TIMEOUT_MS,
    status: NANO_HOST_STATUS.PREPARING_ASSETS
  }), true);
  assert.equal(nanoDownloadBlockerKind(state), "EXTERNAL_MODEL_ASSET_BLOCKER");
});

test("v0.9.8 stalled positive download remains distinct from external asset blocker", () => {
  const start = Date.UTC(2026, 7, 5, 10, 0, 0);
  const state = recordNanoDownloadProgress(
    createNanoDownloadProgressState({ now: start }),
    { progress: 0.25, now: start }
  ).state;
  assert.equal(nanoDownloadBlockerKind(state), "DOWNLOAD_STALLED");
});

test("v0.9.8 external asset blocker has a distinct machine identity", () => {
  const error = new NanoHostExternalModelAssetBlockerError(1_200_000);
  assert.equal(error.name, "NanoHostExternalModelAssetBlockerError");
  assert.equal(error.timeoutMs, 1_200_000);
  assert.equal(error.reasonCode, "EXTERNAL_MODEL_ASSET_BLOCKER");
  assert.match(error.message, /ingen faktisk nedladdningsprogress/u);
});

test("v0.9.8 PREPARING_ASSETS is indeterminate and does not claim download progress", () => {
  const projection = nanoHostUiProjection({
    status: NANO_HOST_STATUS.PREPARING_ASSETS,
    availability: NANO_HOST_STATUS.DOWNLOADING,
    progress: 0
  });
  assert.equal(projection.label, "FÖRBEREDER ASSETS");
  assert.equal(projection.indeterminate, true);
  assert.equal(projection.progress, null);
  assert.match(projection.progressText, /modellassets/u);
  assert.doesNotMatch(projection.detail, /laddar ned/u);
});

test("v0.9.8 external asset blocker is terminal for mission admission", () => {
  const projection = nanoHostUiProjection({
    status: NANO_HOST_STATUS.EXTERNAL_MODEL_ASSET_BLOCKER
  });
  assert.equal(projection.label, "BROWSERBLOCKERARE");
  assert.equal(projection.tone, "blocked");
  assert.equal(missionStartAllowed({
    requiresNanoHost: true,
    session: {},
    status: NANO_HOST_STATUS.EXTERNAL_MODEL_ASSET_BLOCKER,
    busy: false,
    stale: false
  }), false);
});

test("v0.9.8 sidepanel binds asset preparation and external blocker without auto retry", async () => {
  const source = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../sidepanel.html", import.meta.url), "utf8");
  assert.match(source, /NANO_HOST_STATUS\.PREPARING_ASSETS/u);
  assert.match(source, /NanoHostExternalModelAssetBlockerError/u);
  assert.match(source, /EXTERNAL_MODEL_ASSET_BLOCKER/u);
  assert.match(source, /Automatisk retry är spärrad/u);
  assert.match(source, /external-model-asset-blocker/u);
  assert.match(source, /nanoHostReportChain/u);
  assert.match(source, /nanoHostReportedPhases/u);
  assert.match(html, /Chrome on-device LanguageModel/u);
  assert.doesNotMatch(html, /Chrome Nano/u);
});

test("v0.9.8 application log covers the complete bounded admission chain", async () => {
  const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
  for (const event of [
    "admission-started",
    "availability",
    "assets-preparing",
    "download-progress",
    "loading",
    "available",
    "external-model-asset-blocker",
    "settled"
  ]) {
    assert.match(background, new RegExp(event, "u"), event);
  }
  assert.match(background, /Chrome on-device LanguageModel/u);
});

test("v0.9.8 current docs codify forward-only asset admission", async () => {
  const eic = await readFile(new URL("../EIC.md", import.meta.url), "utf8");
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.match(eic, /1,200 seconds/u);
  assert.match(eic, /EXTERNAL_MODEL_ASSET_BLOCKER/u);
  assert.match(eic, /automatic retry is forbidden/u);
  assert.match(readme, /v0\.9\.11/u);
  assert.match(readme, /1,200-second/u);
});
