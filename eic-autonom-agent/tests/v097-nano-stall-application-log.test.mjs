import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  APPLICATION_LOG_MAX_SEGMENTS,
  appendApplicationLog,
  applicationLogForExport,
  createApplicationLog,
  ensureApplicationLogSession,
  sanitizeApplicationLogData
} from "../lib/application-log.mjs";
import {
  NANO_HOST_PROGRESS_STALL_TIMEOUT_MS,
  NANO_HOST_STATUS,
  NanoHostDownloadStallError,
  createNanoDownloadProgressState,
  nanoDownloadProgressStalled,
  recordNanoDownloadProgress
} from "../lib/nano-host-admission.mjs";

function ids(index = 1) {
  return {
    entryId: `entry-${index}`,
    nextSegmentId: `segment-${index + 1}`
  };
}

test("current zero progress arms the material-progress deadline without claiming progress", () => {
  const start = Date.UTC(2026, 7, 5, 10, 0, 0);
  const initial = createNanoDownloadProgressState({
    now: start,
    timeoutMs: NANO_HOST_PROGRESS_STALL_TIMEOUT_MS
  });
  const observed = recordNanoDownloadProgress(initial, {
    progress: 0,
    now: start
  });
  assert.equal(observed.material, false);
  assert.equal(observed.state.progress, 0);
  assert.equal(
    Date.parse(observed.state.stallDeadlineAt) - start,
    NANO_HOST_PROGRESS_STALL_TIMEOUT_MS
  );
});

test("v0.9.7 duplicate zero events do not extend the stall deadline", () => {
  const start = Date.UTC(2026, 7, 5, 10, 0, 0);
  const first = recordNanoDownloadProgress(
    createNanoDownloadProgressState({ now: start }),
    { progress: 0, now: start }
  );
  const duplicate = recordNanoDownloadProgress(first.state, {
    progress: 0,
    now: start + 120_000
  });
  assert.equal(duplicate.material, false);
  assert.equal(duplicate.state.stallDeadlineAt, first.state.stallDeadlineAt);
});

test("v0.9.7 material progress resets the stall deadline", () => {
  const start = Date.UTC(2026, 7, 5, 10, 0, 0);
  const first = recordNanoDownloadProgress(
    createNanoDownloadProgressState({ now: start }),
    { progress: 0, now: start }
  );
  const advanced = recordNanoDownloadProgress(first.state, {
    progress: 0.25,
    now: start + 120_000
  });
  assert.equal(advanced.material, true);
  assert.equal(
    Date.parse(advanced.state.stallDeadlineAt),
    start + 120_000 + NANO_HOST_PROGRESS_STALL_TIMEOUT_MS
  );
});

test("v0.9.7 download block twin detects expired no-progress state", () => {
  const start = Date.UTC(2026, 7, 5, 10, 0, 0);
  const observed = recordNanoDownloadProgress(
    createNanoDownloadProgressState({ now: start }),
    { progress: 0, now: start }
  );
  assert.equal(nanoDownloadProgressStalled(observed.state, {
    now: start + NANO_HOST_PROGRESS_STALL_TIMEOUT_MS - 1,
    status: NANO_HOST_STATUS.DOWNLOADING
  }), false);
  assert.equal(nanoDownloadProgressStalled(observed.state, {
    now: start + NANO_HOST_PROGRESS_STALL_TIMEOUT_MS,
    status: NANO_HOST_STATUS.DOWNLOADING
  }), true);
});

test("v0.9.7 loading and completed downloads are never download-stalled", () => {
  const start = Date.UTC(2026, 7, 5, 10, 0, 0);
  const complete = recordNanoDownloadProgress(
    createNanoDownloadProgressState({ now: start }),
    { progress: 1, now: start }
  );
  assert.equal(complete.state.stallDeadlineAt, null);
  assert.equal(nanoDownloadProgressStalled(complete.state, {
    now: start + 999_999,
    status: NANO_HOST_STATUS.LOADING
  }), false);
});

test("v0.9.7 stall error has a distinct machine identity", () => {
  const error = new NanoHostDownloadStallError(180_000);
  assert.equal(error.name, "NanoHostDownloadStallError");
  assert.equal(error.timeoutMs, 180_000);
  assert.match(error.message, /ingen materiell progress/u);
});

test("v0.9.7 application log creates an explicit application session", () => {
  const log = createApplicationLog({
    appVersion: "0.9.7",
    sessionId: "app-session-a",
    segmentId: "segment-a",
    now: 1
  });
  assert.equal(log.currentSessionId, "app-session-a");
  assert.equal(log.sessions[0].appVersion, "0.9.7");
  assert.equal(log.segments[0].sessionId, "app-session-a");
});

test("v0.9.7 recent service-worker restart reuses the application session", () => {
  const log = createApplicationLog({
    appVersion: "0.9.7",
    sessionId: "app-session-a",
    segmentId: "segment-a",
    now: 1_000
  });
  const ensured = ensureApplicationLogSession(log, {
    appVersion: "0.9.7",
    sessionId: "app-session-b",
    segmentId: "segment-b",
    now: 2_000
  });
  assert.equal(ensured.sessionStarted, false);
  assert.equal(ensured.log.currentSessionId, "app-session-a");
});

test("v0.9.7 idle or version boundary starts a new application session", () => {
  const log = createApplicationLog({
    appVersion: "0.9.7",
    sessionId: "app-session-a",
    segmentId: "segment-a",
    now: 1_000
  });
  const ensured = ensureApplicationLogSession(log, {
    appVersion: "0.10.1",
    sessionId: "app-session-b",
    segmentId: "segment-b",
    now: 2_000
  });
  assert.equal(ensured.sessionStarted, true);
  assert.equal(ensured.log.currentSessionId, "app-session-b");
  assert.ok(ensured.log.sessions[0].endedAt);
});

test("v0.9.7 log entries carry session, host, window, run and mission identity", () => {
  const log = createApplicationLog({
    appVersion: "0.9.7",
    sessionId: "app-session-a",
    segmentId: "segment-a",
    now: 1_000
  });
  const result = appendApplicationLog(log, {
    event: "nano.host.create-started",
    hostId: "panel-a",
    windowId: 7,
    runId: "run-a",
    missionId: "mission-a",
    correlationId: "create-a"
  }, { ...ids(), now: 2_000 });
  const entry = result.entry;
  assert.equal(entry.appSessionId, "app-session-a");
  assert.equal(entry.hostId, "panel-a");
  assert.equal(entry.windowId, 7);
  assert.equal(entry.runId, "run-a");
  assert.equal(entry.missionId, "mission-a");
});

test("v0.9.7 application log redacts transport secrets and prompt bodies", () => {
  const sanitized = sanitizeApplicationLogData({
    sessionLocator: "eicsl1.secret.signature",
    authorization: "Bearer abc.def",
    prompt: "do not store",
    detail: "Bearer abc.def"
  });
  assert.equal(sanitized.sessionLocator, "[REDACTED]");
  assert.equal(sanitized.authorization, "[REDACTED]");
  assert.equal(sanitized.prompt, "[REDACTED]");
  assert.equal(sanitized.detail, "[REDACTED_TRANSPORT_SECRET]");
});

test("v0.9.7 application log rotates entry segments and drops the oldest", () => {
  let log = createApplicationLog({
    appVersion: "0.9.7",
    sessionId: "app-session-a",
    segmentId: "segment-0",
    now: 1_000
  });
  for (let index = 0; index < 8; index += 1) {
    log = appendApplicationLog(log, {
      event: `event-${index}`,
      data: { index }
    }, {
      entryId: `entry-${index}`,
      nextSegmentId: `segment-${index + 1}`,
      now: 2_000 + index,
      maxEntriesPerSegment: 1,
      maxSegments: 3,
      maxSegmentBytes: 64 * 1024
    }).log;
  }
  assert.equal(log.segments.length, 3);
  assert.ok(log.droppedSegments > 0);
  assert.ok(log.droppedEntries > 0);
});

test("v0.9.7 window export contains global and matching entries only", () => {
  let log = createApplicationLog({
    appVersion: "0.9.7",
    sessionId: "app-session-a",
    segmentId: "segment-0",
    now: 1_000
  });
  for (const [index, windowId] of [[1, null], [2, 7], [3, 8]]) {
    log = appendApplicationLog(log, {
      event: `event-${index}`,
      windowId
    }, {
      entryId: `entry-${index}`,
      nextSegmentId: `segment-${index}`,
      now: 2_000 + index
    }).log;
  }
  const exported = applicationLogForExport(log, { windowId: 7 });
  const entries = exported.segments.flatMap((segment) => segment.entries);
  assert.deepEqual(entries.map((entry) => entry.windowId), [null, 7]);
});



test("v0.9.7 unscoped export preserves entries from every window", () => {
  let log = createApplicationLog({
    appVersion: "0.9.7",
    sessionId: "app-session-all",
    segmentId: "segment-all",
    now: 1_000
  });
  for (const [index, windowId] of [[1, null], [2, 7], [3, 8]]) {
    log = appendApplicationLog(log, {
      event: `all-event-${index}`,
      windowId
    }, {
      entryId: `all-entry-${index}`,
      nextSegmentId: `all-segment-${index}`,
      now: 2_000 + index
    }).log;
  }
  const exported = applicationLogForExport(log);
  const entries = exported.segments.flatMap((segment) => segment.entries);
  assert.deepEqual(entries.map((entry) => entry.windowId), [null, 7, 8]);
});

test("v0.9.7 sidepanel has a distinct progress-stall abort path", async () => {
  const source = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");
  assert.match(source, /NANO_HOST_PROGRESS_STALL_TIMEOUT_MS/u);
  assert.match(source, /function armNanoProgressStallWatchdog/u);
  assert.match(source, /NanoHostDownloadStallError/u);
  assert.match(source, /NANO_HOST_DOWNLOAD_STALLED/u);
  assert.match(source, /DOWNLOAD_STALLED/u);
});

test("v0.9.7 owner telemetry and export include stall and application-log state", async () => {
  const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
  const panel = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");
  const contracts = await readFile(new URL("../lib/contracts.mjs", import.meta.url), "utf8");
  for (const token of [
    "progressStallDeadlineAt",
    "progressStallTimeoutMs",
    "lastProgressValue",
    "lastProgressEventAt",
    "applicationLog"
  ]) {
    assert.match(background + panel, new RegExp(token, "u"), token);
  }
  assert.match(contracts, /APPLICATION_LOG/u);
  assert.match(panel, /GET_APPLICATION_LOG/u);
  assert.match(panel, /applicationLog: applicationLogResult\?\.applicationLog/u);
});

test("v0.9.7 self-rotation remains bounded by the canonical segment ceiling", () => {
  assert.equal(APPLICATION_LOG_MAX_SEGMENTS, 6);
});
