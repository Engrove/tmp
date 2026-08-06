import test from "node:test";
import assert from "node:assert/strict";
import {
  NANO_ANALYSIS_MODES,
  NANO_CLAIM_LEASE_STATE,
  NANO_DECISION_SOURCE,
  NANO_REQUEST_MODE,
  NANO_REQUEST_STATUS,
  buildNanoDecisionPrompt,
  claimNanoRequestState,
  compactContextText,
  completeNanoRequestState,
  createNanoRequest,
  failNanoRequestState,
  nanoClaimLeaseState,
  nanoFallbackDue,
  updateNanoProgressState,
  validateNanoDecisionGrounding
} from "../lib/nano-pipeline.mjs";

function observation(overrides = {}) {
  return {
    responseHash: "resp-123",
    responseText: "Arbetet gäller WP25. Den aktuella blockeraren är summary-budgeten i lib/graph.mjs. Nästa effekt är en tvåfils patch och testlogg.",
    conversationExcerpt: "Användaren bad att slutföra WP25. Målsessionen har byggt en kandidat men ännu inte publicerat den.",
    targetResult: { valid: false, reason: "PROTOCOL_MISSING" },
    ...overrides
  };
}

function groundedTakeover(overrides = {}) {
  return {
    analysisMode: NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP,
    intent: "Slutför WP25 genom en verifierbar arbetsenhet åt gången.",
    action: "CONTINUE",
    progressDelta: 1,
    reason: "Målsessionens senaste svar identifierar en konkret tvåfils repair.",
    workUnit: "Reparera summary-budgeten utan att ändra publication-proof.",
    requestedAction: "Patcha lib/graph.mjs och tests/graph.test.mjs, kör fokustest och returnera exakt testlogg samt SHA-256.",
    requiredEvidence: ["Diff för två exakta filer", "Testkommando med exit status", "SHA-256 för patchen"],
    targetClaims: ["Målsessionen påstår att summary-budgeten överskrids av duplicerad metadata."],
    inferences: ["En tvåfils patch kan vara minsta verifierbara leverans."],
    evidenceAnchors: ["Senaste svaret namnger lib/graph.mjs och en tvåfils repair."],
    blockers: [],
    alternatives: ["Pausa om owner-readback motsäger den föreslagna filgränsen."],
    completionScope: "WORK_UNIT",
    completionConfirmed: false,
    pauseOrigin: "NONE",
    boundaryEvidence: "",
    ...overrides
  };
}

test("head-tail-komprimering bevarar load-bearing slutmarkörer", () => {
  const source = `START\n${"x".repeat(8000)}\nEIC_NEXT: patcha lib/graph.mjs\nEIC_AUTONOMY: CONTINUE`;
  const result = compactContextText(source, 1200, { label: "TEST" });
  assert.match(result.text, /START/);
  assert.match(result.text, /EIC_NEXT: patcha lib\/graph\.mjs/);
  assert.match(result.text, /EIC_AUTONOMY: CONTINUE/);
  assert.match(result.strategy, /HEAD_TAIL/);
});

test("takeover avvisar självskapad meta-loop från runtimeexporten", () => {
  const decision = groundedTakeover({
    requestedAction: "Läs target-sessionens påståenden",
    requiredEvidence: ["targetClaims"],
    targetClaims: [],
    inferences: [],
    evidenceAnchors: []
  });
  const result = validateNanoDecisionGrounding(decision, {
    analysisMode: NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP,
    continuityProjection: { intent: "", position: { workUnit: "" }, verifiedFacts: [], targetClaims: [], inferences: [] },
    observation: observation()
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("META_ONLY_ACTION"));
  assert.ok(result.errors.includes("TAKEOVER_CONTEXT_EMPTY"));
  assert.ok(result.errors.includes("NAKED_TARGETCLAIMS_EVIDENCE"));
});

test("groundad takeover med konkret fil, effekt och evidens passerar", () => {
  const result = validateNanoDecisionGrounding(groundedTakeover(), {
    analysisMode: NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP,
    continuityProjection: { intent: "", position: { workUnit: "" }, verifiedFacts: [], targetClaims: [], inferences: [] },
    observation: observation()
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test("tom takeover-observation failar stängt", () => {
  const result = validateNanoDecisionGrounding(groundedTakeover(), {
    analysisMode: NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP,
    continuityProjection: {},
    observation: observation({ responseText: "", conversationExcerpt: "" })
  });
  assert.ok(result.errors.includes("TAKEOVER_OBSERVATION_EMPTY"));
});

test("beslutsprompten använder kompakt router utan svarskopia eller konversationsutdrag", () => {
  const prompt = buildNanoDecisionPrompt({
    run: { runId: "run-1", state: "ASSESSING", turnIndex: 2, takeoverBootstrapRequired: true },
    request: { requestId: "req-1", mode: NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP, validationErrors: [] },
    observation: observation(),
    config: { targetMandate: "TARGET CORE" },
    continuityProjection: { intent: "", position: { workUnit: "" } }
  });
  assert.match(prompt, /REFERENCE_PLUS_DELTA/);
  assert.match(prompt, /REPAIR_ONLY.*EIC-AA\/5/i);
  assert.match(prompt, /"observationAnchors":\["RESPONSE_HASH: resp-123","TARGET_REASON: PROTOCOL_MISSING"\]/);
  assert.doesNotMatch(prompt, /RECENT CONVERSATION|LATEST COMPLETE TARGET RESPONSE/);
});

test("Nano-request kräver claim före prompting och completion", () => {
  const created = createNanoRequest({
    requestId: "req-1",
    observationId: "obs-1",
    mode: NANO_REQUEST_MODE.CONTINUATION,
    now: 1000
  });
  assert.equal(created.status, NANO_REQUEST_STATUS.PENDING);

  const unclaimedProgress = updateNanoProgressState(created, {
    claimId: "claim-1",
    outputChars: 1,
    chunkCount: 1,
    now: 1100
  });
  assert.equal(unclaimedProgress.ok, false);

  const claimed = claimNanoRequestState(created, { claimId: "claim-1", now: 1100, leaseMs: 5000 });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.request.status, NANO_REQUEST_STATUS.RUNNING);
  assert.equal(claimed.request.claimId, "claim-1");
  const wrongClaimCompletion = completeNanoRequestState(claimed.request, {
    claimId: "claim-other",
    source: NANO_DECISION_SOURCE.NANO,
    now: 1150
  });
  assert.equal(wrongClaimCompletion.ok, false);
  assert.equal(wrongClaimCompletion.reason, "CLAIM_ID_MISMATCH");
  const progressed = updateNanoProgressState(claimed.request, {
    claimId: "claim-1",
    outputChars: 350,
    chunkCount: 4,
    now: 1300,
    leaseMs: 5000
  });
  assert.equal(progressed.ok, true);
  assert.equal(progressed.request.outputChars, 350);
  assert.equal(progressed.request.chunkCount, 4);

  const completed = completeNanoRequestState(progressed.request, {
    claimId: "claim-1",
    source: NANO_DECISION_SOURCE.NANO,
    now: 1400
  });
  assert.equal(completed.ok, true);
  assert.equal(completed.request.decisionSource, NANO_DECISION_SOURCE.NANO);
});

test("takeover har aldrig deterministic fallback deadline", () => {
  const request = createNanoRequest({
    requestId: "req-takeover",
    observationId: "obs-1",
    mode: NANO_REQUEST_MODE.TAKEOVER_BOOTSTRAP,
    now: 1000
  });
  assert.equal(request.deadlineAt, null);
  assert.equal(nanoFallbackDue(request, { now: 999999999 }), false);
});


test("Nano-claim använder lease som korrekthetsgräns och avbryter inte en tyst modell efter 45 sekunder", () => {
  const created = createNanoRequest({
    requestId: "req-lease",
    observationId: "obs-lease",
    mode: NANO_REQUEST_MODE.CONTINUATION,
    now: 1000
  });
  const claimed = claimNanoRequestState(created, {
    claimId: "claim-lease",
    now: 2000,
    leaseMs: 120000
  });
  assert.equal(claimed.ok, true);
  assert.equal(nanoClaimLeaseState(claimed.request, {
    now: 48000
  }), NANO_CLAIM_LEASE_STATE.ACTIVE);
  assert.equal(nanoClaimLeaseState(claimed.request, {
    now: 121999
  }), NANO_CLAIM_LEASE_STATE.ACTIVE);
  assert.equal(nanoClaimLeaseState(claimed.request, {
    now: 122000
  }), NANO_CLAIM_LEASE_STATE.EXPIRED);
});

test("heartbeat förnyar claim-leasen och exakt claim kan slutföra", () => {
  const created = createNanoRequest({
    requestId: "req-renew",
    observationId: "obs-renew",
    mode: NANO_REQUEST_MODE.CONTINUATION,
    now: 1000
  });
  const claimed = claimNanoRequestState(created, {
    claimId: "claim-renew",
    now: 2000,
    leaseMs: 30000
  });
  const progressed = updateNanoProgressState(claimed.request, {
    claimId: "claim-renew",
    outputChars: 100,
    chunkCount: 1,
    now: 20000,
    leaseMs: 30000
  });
  assert.equal(progressed.ok, true);
  assert.equal(progressed.request.claimLeaseUntil, new Date(50000).toISOString());
  const completed = completeNanoRequestState(progressed.request, {
    claimId: "claim-renew",
    source: NANO_DECISION_SOURCE.NANO,
    now: 40000
  });
  assert.equal(completed.ok, true);
});

test("stale eller utgången claim avvisar progress, completion och failure", () => {
  const created = createNanoRequest({
    requestId: "req-stale",
    observationId: "obs-stale",
    mode: NANO_REQUEST_MODE.CONTINUATION,
    now: 1000
  });
  const claimed = claimNanoRequestState(created, {
    claimId: "claim-stale",
    now: 2000,
    leaseMs: 30000
  });
  for (const result of [
    updateNanoProgressState(claimed.request, {
      claimId: "claim-stale",
      outputChars: 5,
      chunkCount: 1,
      now: 32000
    }),
    completeNanoRequestState(claimed.request, {
      claimId: "claim-stale",
      source: NANO_DECISION_SOURCE.NANO,
      now: 32000
    }),
    failNanoRequestState(claimed.request, {
      claimId: "claim-stale",
      errorCode: "LATE",
      errorDetail: "stale panel",
      now: 32000
    })
  ]) {
    assert.equal(result.ok, false);
    assert.equal(result.reason, "CLAIM_LEASE_EXPIRED");
  }
  const wrongClaim = completeNanoRequestState(claimed.request, {
    claimId: "claim-other",
    source: NANO_DECISION_SOURCE.NANO,
    now: 3000
  });
  assert.equal(wrongClaim.ok, false);
  assert.equal(wrongClaim.reason, "CLAIM_ID_MISMATCH");
});

test("ordinarie Nano-request kan inte claimas efter deadline men takeover kan", () => {
  const ordinary = createNanoRequest({
    requestId: "req-late",
    observationId: "obs-late",
    mode: NANO_REQUEST_MODE.CONTINUATION,
    graceMs: 10000,
    now: 1000
  });
  const late = claimNanoRequestState(ordinary, {
    claimId: "claim-late",
    now: 11000
  });
  assert.equal(late.ok, false);
  assert.equal(late.reason, "REQUEST_DEADLINE_EXPIRED");

  const takeover = createNanoRequest({
    requestId: "req-takeover-late",
    observationId: "obs-takeover-late",
    mode: NANO_REQUEST_MODE.TAKEOVER_BOOTSTRAP,
    graceMs: 10000,
    now: 1000
  });
  const takeoverClaim = claimNanoRequestState(takeover, {
    claimId: "claim-takeover",
    now: 999999
  });
  assert.equal(takeoverClaim.ok, true);
});

test("deterministic fallback är endast tillåten när den är due och aldrig för takeover", () => {
  const ordinary = createNanoRequest({
    requestId: "req-fallback",
    observationId: "obs-fallback",
    mode: NANO_REQUEST_MODE.CONTINUATION,
    graceMs: 10000,
    now: 1000
  });
  const early = completeNanoRequestState(ordinary, {
    source: NANO_DECISION_SOURCE.DETERMINISTIC_FALLBACK,
    now: 5000
  });
  assert.equal(early.ok, false);
  assert.equal(early.reason, "FALLBACK_NOT_DUE");

  const due = completeNanoRequestState(ordinary, {
    source: NANO_DECISION_SOURCE.DETERMINISTIC_FALLBACK,
    now: 11000
  });
  assert.equal(due.ok, true);
  const duplicate = completeNanoRequestState(due.request, {
    source: NANO_DECISION_SOURCE.DETERMINISTIC_FALLBACK,
    now: 12000
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.reason, "FALLBACK_NOT_DUE");

  const takeover = createNanoRequest({
    requestId: "req-takeover-no-fallback",
    observationId: "obs-takeover-no-fallback",
    mode: NANO_REQUEST_MODE.TAKEOVER_BOOTSTRAP,
    now: 1000
  });
  const forbidden = completeNanoRequestState(takeover, {
    source: NANO_DECISION_SOURCE.DETERMINISTIC_FALLBACK,
    now: 999999
  });
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.reason, "FALLBACK_NOT_DUE");
});

test("beslutspromptens canonical groundingyta är contextRouter", () => {
  const prompt = buildNanoDecisionPrompt({
    run: { runId: "run-context", state: "ASSESSING", takeoverBootstrapRequired: true },
    request: { requestId: "req-context", mode: NANO_ANALYSIS_MODES.TAKEOVER_BOOTSTRAP },
    observation: observation(),
    config: { targetMandate: "TARGET CORE" },
    continuityProjection: { intent: "", position: { workUnit: "" } }
  });
  assert.match(prompt, /"contextRouter":\{"schema":"eic\.autonom\.context-router\.v1"/);
  assert.match(prompt, /OWNER_LIVE, OWNER_RECEIPT/);
});
