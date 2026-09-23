import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  MAX_RESPONSE_MISSION_DELEGATIONS,
  MISSION_DELEGATION_RELATION,
  MISSION_DELEGATION_STATE,
  claimPendingMissionDelegationForWorker,
  clampDelegatedPriority,
  loadMissionDelegationRegistry,
  markMissionDelegationApplied,
  markMissionDelegationCompleted,
  registerMissionDelegationRequests,
  releaseMissionDelegation,
  validateMissionDelegationRequests
} from "../lib/mission-delegation.mjs";
import {
  addMissionWorkItem,
  normalizeMissionWorkQueue,
  publicMissionWorkQueue,
  saveMissionWorkQueue
} from "../lib/mission-work-queue.mjs";
import { buildA2AEnvelope } from "../lib/a2a.mjs";
import { parseTargetResponse, validateTargetResponse } from "../lib/response-contract.mjs";

function storageMock(initial = {}) {
  const state = structuredClone(initial);
  return {
    state,
    async get(key) {
      if (key == null) return structuredClone(state);
      if (typeof key === "string") return { [key]: structuredClone(state[key]) };
      if (Array.isArray(key)) {
        return Object.fromEntries(key.map((entry) => [entry, structuredClone(state[entry])]));
      }
      return structuredClone(state);
    },
    async set(values) {
      Object.assign(state, structuredClone(values));
    }
  };
}

function response(status = "CONTINUE", patch = {}) {
  return {
    schema: "eic.a2a.response.v1",
    status,
    summary: "Continue supervisory work",
    workPerformed: ["Observed a durable follow-up need"],
    evidence: ["Owner evidence recorded"],
    blockers: [],
    nextSuggestedAction: "Continue the supervising mission normally.",
    ...patch
  };
}

const delegation = {
  requestId: "req-backend-fix-001",
  label: "Backend fix",
  mission: "Implement and verify the backend fix required by the supervising mission.",
  priority: "URGENT",
  relation: "SUPPORTS_CURRENT"
};

test("v1.4.0 mission delegation response contract is bounded, explicit and not compatible with DONE", () => {
  const valid = validateTargetResponse(response("CONTINUE", {
    missionDelegations: [delegation]
  }));
  assert.equal(valid.ok, true);

  const parsed = parseTargetResponse(JSON.stringify(response("CONTINUE", {
    missionDelegations: [delegation]
  })));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.missionDelegations.length, 1);
  assert.equal(parsed.value.missionDelegations[0].requestId, delegation.requestId);

  const done = validateTargetResponse(response("DONE", {
    missionDelegations: [delegation]
  }));
  assert.equal(done.ok, false);
  assert.ok(done.errors.includes("MISSION_DELEGATION_DONE_CONFLICT"));

  const missingPriority = validateMissionDelegationRequests([{
    requestId: "req-missing-priority",
    mission: delegation.mission,
    relation: "SUPPORTS_CURRENT"
  }]);
  assert.equal(missingPriority.ok, false);
  assert.ok(missingPriority.errors.some((entry) => entry.endsWith(":PRIORITY_REQUIRED")));

  const missingRelation = validateMissionDelegationRequests([{
    requestId: "req-missing-relation",
    mission: delegation.mission,
    priority: "NORMAL"
  }]);
  assert.equal(missingRelation.ok, false);
  assert.ok(missingRelation.errors.some((entry) => entry.endsWith(":RELATION_REQUIRED")));

  const tooMany = validateMissionDelegationRequests(
    Array.from({ length: MAX_RESPONSE_MISSION_DELEGATIONS + 1 }, (_, index) => ({
      ...delegation,
      requestId: `req-${index}`
    }))
  );
  assert.equal(tooMany.ok, false);
  assert.ok(tooMany.errors.includes("MISSION_DELEGATIONS_MAX_ITEMS"));
});

test("v1.4.0 queued A2A advertises delegation to another live worker while ordinary A2A does not", () => {
  const baseProcess = {
    processId: "source-process",
    runId: "source-run",
    generation: 1,
    turn: 3,
    goal: "Supervise the mission",
    queueContext: {
      schema: "eic.greenfield.queue-context.v1",
      queueId: "source-queue",
      itemId: "source-item",
      interactionCount: 1,
      maxInteractions: 5,
      priority: "HIGH",
      activatedAt: "2026-09-06T12:00:00.000Z"
    }
  };
  const queued = buildA2AEnvelope({ process: baseProcess, objective: "Continue supervising" });
  assert.ok(queued.responseContract.jsonSchema.properties.missionDelegations);
  assert.equal(queued.responseContract.missionDelegationControl.target, "ANOTHER_LIVE_QUEUE_MANAGED_GREENFIELD_WORKER");
  assert.equal(queued.responseContract.missionDelegationControl.supervisorSelfCreation, false);
  assert.equal(queued.responseContract.missionDelegationControl.sourceContinuesByDefault, true);
  assert.match(queued.responseContract.missionDelegationControl.temporaryWorkRule, /Temporary bounded work/i);
  assert.match(queued.responseContract.note, /never create that delegated mission in the supervising Chrome queue/i);
  assert.match(queued.responseContract.note, /another already-running queue-managed Greenfield worker/i);

  const ordinary = buildA2AEnvelope({
    process: { ...baseProcess, queueContext: null },
    objective: "Continue"
  });
  assert.equal("missionDelegations" in ordinary.responseContract.jsonSchema.properties, false);
  assert.equal("missionDelegationControl" in ordinary.responseContract, false);
});

test("v1.4.0 delegation registry never assigns a request back to the supervising window", async () => {
  const storage = storageMock();
  const registered = await registerMissionDelegationRequests([delegation], {
    sourceWindowId: 10,
    sourceQueueId: "source-q",
    sourceItemId: "source-item",
    sourceProcessId: "source-process",
    sourceRunId: "source-run",
    sourceResponseHash: "abc",
    sourcePriority: "HIGH"
  }, storage);

  assert.equal(registered.accepted.length, 1);
  assert.equal(registered.accepted[0].priority, "HIGH");
  assert.equal(clampDelegatedPriority("URGENT", "HIGH"), "HIGH");

  const selfClaim = await claimPendingMissionDelegationForWorker({
    targetWindowId: 10,
    targetQueueId: "source-q"
  }, storage);
  assert.equal(selfClaim.delegation, null);

  // A Chrome window id can change after restart/rebind. The stable source
  // queue identity must still prevent the supervising queue from consuming
  // its own delegation.
  const reboundSelfClaim = await claimPendingMissionDelegationForWorker({
    targetWindowId: 11,
    targetQueueId: "source-q"
  }, storage);
  assert.equal(reboundSelfClaim.delegation, null);

  const workerClaim = await claimPendingMissionDelegationForWorker({
    targetWindowId: 20,
    targetQueueId: "worker-q"
  }, storage);
  assert.equal(workerClaim.delegation.requestId, delegation.requestId);
  assert.equal(workerClaim.delegation.state, MISSION_DELEGATION_STATE.ASSIGNED);
  assert.equal(workerClaim.delegation.targetWindowId, 20);

  // Unknown-effect recovery: the same target worker can reconcile an ASSIGNED
  // request instead of another worker duplicating it.
  const sameWorkerReconcile = await claimPendingMissionDelegationForWorker({
    targetWindowId: 20,
    targetQueueId: "worker-q"
  }, storage);
  assert.equal(sameWorkerReconcile.delegation.requestId, delegation.requestId);
  assert.equal(sameWorkerReconcile.delegation.attempts, 1);

  const otherWorker = await claimPendingMissionDelegationForWorker({
    targetWindowId: 30,
    targetQueueId: "other-q"
  }, storage);
  assert.equal(otherWorker.delegation, null);
});

test("v1.4.0 delegation requestId is idempotent and conflicting reuse is rejected", async () => {
  const storage = storageMock();
  const source = {
    sourceWindowId: 10,
    sourceQueueId: "source-q",
    sourceItemId: "source-item",
    sourceProcessId: "source-process",
    sourceRunId: "source-run",
    sourceResponseHash: "abc",
    sourcePriority: "NORMAL"
  };
  const first = await registerMissionDelegationRequests([delegation], source, storage);
  assert.equal(first.accepted.length, 1);
  const duplicate = await registerMissionDelegationRequests([delegation], source, storage);
  assert.equal(duplicate.accepted.length, 0);
  assert.equal(duplicate.duplicates.length, 1);

  await assert.rejects(
    registerMissionDelegationRequests([{
      ...delegation,
      mission: "Different mission under the same request id."
    }], source, storage),
    /MISSION_DELEGATION_REQUEST_ID_CONFLICT/
  );
});

test("v1.4.0 delegated mission is created in worker queue with provenance and dedupes against history", async () => {
  const storage = storageMock();
  let queue = normalizeMissionWorkQueue({
    queueId: "worker-q",
    workerId: "worker-20",
    windowId: 20,
    enabled: true,
    activeItemId: "active",
    items: [{
      itemId: "active",
      goal: "Current worker mission",
      status: "ACTIVE",
      priority: "NORMAL"
    }]
  }, { windowId: 20 });
  await saveMissionWorkQueue(queue, storage);

  const meta = {
    requestId: delegation.requestId,
    relation: MISSION_DELEGATION_RELATION.SUPPORTS_CURRENT,
    sourceWindowId: 10,
    sourceQueueId: "source-q",
    sourceItemId: "source-item",
    sourceProcessId: "source-process",
    createdBy: "EIC_DELEGATED_FROM_OTHER_GFW",
    createdAt: "2026-09-06T12:00:00.000Z"
  };
  queue = await addMissionWorkItem(20, delegation.mission, {
    storage,
    workerId: "worker-20",
    priority: "HIGH",
    label: delegation.label,
    delegation: meta
  });
  const created = queue.items.find((item) => item.delegation?.requestId === delegation.requestId);
  assert.ok(created);
  assert.equal(created.status, "READY");
  assert.equal(created.delegation.sourceQueueId, "source-q");

  const publicQueue = publicMissionWorkQueue(queue);
  assert.equal(
    publicQueue.items.find((item) => item.itemId === created.itemId).delegation.createdBy,
    "EIC_DELEGATED_FROM_OTHER_GFW"
  );

  // Move the child to terminal history and prove the same request id is not
  // recreated after retries/version restarts.
  queue.items = queue.items.filter((item) => item.itemId !== created.itemId);
  queue.history.push({ ...created, status: "DONE", completedAt: "2026-09-06T12:10:00.000Z" });
  await saveMissionWorkQueue(queue, storage);
  const deduped = await addMissionWorkItem(20, delegation.mission, {
    storage,
    workerId: "worker-20",
    priority: "HIGH",
    label: delegation.label,
    delegation: meta
  });
  assert.equal(deduped.items.some((item) => item.delegation?.requestId === delegation.requestId), false);
  assert.equal(deduped.history.some((item) => item.delegation?.requestId === delegation.requestId), true);
});

test("v1.4.0 orphaned assignment can be reclaimed only after its target queue is no longer live", async () => {
  const storage = storageMock();
  await registerMissionDelegationRequests([delegation], {
    sourceWindowId: 10,
    sourceQueueId: "source-q",
    sourceItemId: "source-item",
    sourceProcessId: "source-process",
    sourceRunId: "source-run",
    sourceResponseHash: "abc",
    sourcePriority: "HIGH"
  }, storage);

  const first = await claimPendingMissionDelegationForWorker({
    targetWindowId: 20,
    targetQueueId: "worker-q"
  }, storage, { liveTargetQueueIds: ["source-q", "worker-q", "worker-q-2"] });
  assert.equal(first.delegation.targetQueueId, "worker-q");

  const stillLive = await claimPendingMissionDelegationForWorker({
    targetWindowId: 30,
    targetQueueId: "worker-q-2"
  }, storage, { liveTargetQueueIds: ["source-q", "worker-q", "worker-q-2"] });
  assert.equal(stillLive.delegation, null);

  const reclaimed = await claimPendingMissionDelegationForWorker({
    targetWindowId: 30,
    targetQueueId: "worker-q-2"
  }, storage, { liveTargetQueueIds: ["source-q", "worker-q-2"] });
  assert.equal(reclaimed.delegation.requestId, delegation.requestId);
  assert.equal(reclaimed.delegation.targetQueueId, "worker-q-2");
  assert.equal(reclaimed.delegation.attempts, 2);
});

test("v1.4.0 delegation lifecycle can recover, apply and complete durably", async () => {
  const storage = storageMock();
  await registerMissionDelegationRequests([{
    ...delegation,
    relation: MISSION_DELEGATION_RELATION.UNBLOCKS_CURRENT
  }], {
    sourceWindowId: 10,
    sourceQueueId: "source-q",
    sourceItemId: "source-item",
    sourceProcessId: "source-process",
    sourceRunId: "source-run",
    sourceResponseHash: "abc",
    sourcePriority: "HIGH"
  }, storage);

  const claim = await claimPendingMissionDelegationForWorker({
    targetWindowId: 20,
    targetQueueId: "worker-q"
  }, storage);
  assert.equal(claim.delegation.state, MISSION_DELEGATION_STATE.ASSIGNED);

  await releaseMissionDelegation(delegation.requestId, { code: "QUEUE_FULL" }, storage);
  let registry = await loadMissionDelegationRegistry(storage);
  assert.equal(registry.items[0].state, MISSION_DELEGATION_STATE.PENDING);
  assert.equal(registry.items[0].lastError.code, "QUEUE_FULL");

  await claimPendingMissionDelegationForWorker({
    targetWindowId: 30,
    targetQueueId: "worker-q-2"
  }, storage);
  await markMissionDelegationApplied(delegation.requestId, "target-item-1", storage);
  registry = await loadMissionDelegationRegistry(storage);
  assert.equal(registry.items[0].state, MISSION_DELEGATION_STATE.APPLIED);
  assert.equal(registry.items[0].targetItemId, "target-item-1");

  await markMissionDelegationCompleted(delegation.requestId, storage);
  registry = await loadMissionDelegationRegistry(storage);
  assert.equal(registry.items[0].state, MISSION_DELEGATION_STATE.COMPLETED);
  assert.ok(registry.items[0].completedAt);
});

test("v1.4.0 background source path persists only delegation requests; worker tick owns queue insertion", () => {
  const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  const sourceFn = background.match(/async function registerResponseMissionDelegations[\s\S]*?\n}\n\nasync function acceptPendingMissionDelegationForWorker/);
  assert.ok(sourceFn);
  assert.match(sourceFn[0], /registerMissionDelegationRequests/);
  assert.doesNotMatch(sourceFn[0], /addMissionWorkItem\(/);
  assert.match(background, /acceptPendingMissionDelegationForWorker\(process\)/);
  assert.match(background, /MISSION_DELEGATION_ACCEPTED_BY_WORKER/);
  assert.match(background, /createdBy: "EIC_DELEGATED_FROM_OTHER_GFW"/);
  assert.match(background, /MISSION_QUEUE_DELEGATED_UNBLOCKER_COMPLETED/);
});
