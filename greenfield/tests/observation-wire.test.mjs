import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const content = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
const stability = fs.readFileSync(new URL("../lib/response-stability.mjs", import.meta.url), "utf8");
const sendFence = fs.readFileSync(new URL("../lib/send-fence.mjs", import.meta.url), "utf8");
const causality = fs.readFileSync(new URL("../lib/turn-causality.mjs", import.meta.url), "utf8");
const a2a = fs.readFileSync(new URL("../lib/a2a.mjs", import.meta.url), "utf8");

test("response observation fields have producer and consumer ends", () => {
  const wires = [
    ["documentId", /documentId:\s*DOCUMENT_ID/, /state\.documentId/, /observation\?\.documentId/],
    ["lastAssistantId", /lastAssistantId:\s*lastAssistant\?\.id/, /state\.lastAssistantId/, /observation\?\.lastAssistantId/],
    ["lastAssistantOwnerKind", /lastAssistantOwnerKind:/, /state\.lastAssistantOwnerKind/, /observation\?\.lastAssistantOwnerKind/],
    ["lastAssistantOwnerTrusted", /lastAssistantOwnerTrusted:/, /state\.lastAssistantOwnerTrusted/, /observation\?\.lastAssistantOwnerTrusted/],
    ["assistantCount", /assistantCount:\s*assistants\.length/, /state\.assistantCount/, /observation\?\.assistantCount/],
    ["assistantTextLength", /assistantTextLength:\s*assistantText\.length/, /state\.assistantTextLength/, /textLength/],
    ["visibilityState", /visibilityState:\s*document\.visibilityState/, /state\.signals/, /visibilityState/]
  ];
  for (const [name, producer, transportConsumer, invariantConsumer] of wires) {
    assert.match(content, producer, `${name} producer missing`);
    assert.match(background, transportConsumer, `${name} background transport/consumer missing`);
    assert.match(stability, invariantConsumer, `${name} stability consumer missing`);
  }
  assert.match(sendFence, /page\.documentId/, "documentId exact-once consumer missing");
});

test("response candidate identity binds autonomous user pair + document + assistant + owner + hash + count", () => {
  assert.match(stability, /expectedUserTurnId/);
  assert.match(stability, /pairedUserTurnId/);
  assert.match(stability, /OBSERVATION_CAUSAL_PAIR_MISMATCH/);
  assert.match(stability, /documentId/);
  assert.match(stability, /messageId/);
  assert.match(stability, /assistantHash/);
  assert.match(stability, /assistantCount/);
  assert.match(stability, /identityKey/);
});

test("untrusted or causally unmatched observations are held before optional protocol parsing", () => {
  assert.match(stability, /OBSERVATION_OWNER_UNTRUSTED/);
  assert.match(stability, /OBSERVATION_CAUSAL_PAIR_MISMATCH/);
  assert.match(background, /RESPONSE_OBSERVATION_HELD/);
  const waitingStart = background.indexOf("async function tickWaiting");
  const held = background.indexOf("RESPONSE_OBSERVATION_HELD", waitingStart);
  const parse = background.indexOf("parseTargetResponse(responsePage.assistantText", waitingStart);
  assert.ok(held >= 0 && parse > held, "causal observation hold must precede protocol parsing");
});


test("content bridge version has both producer and verifier ends", () => {
  assert.match(content, /type === "EIC_GF_PING"/);
  assert.match(content, /version:\s*CONTENT_VERSION/);
  assert.match(background, /type:\s*"EIC_GF_PING"/);
  assert.match(background, /ensureContentBridgeVersion/);
  assert.match(background, /CONTENT_BRIDGE_VERSION_MISMATCH/);
  assert.match(background, /CONTENT_BRIDGE_VERSION_REFRESHED/);
  assert.match(background, /CONTENT_BRIDGE_START_VERIFIED/);
});

test("trusted response owner is a single-role structural boundary", () => {
  assert.match(content, /roles\.length === 1 && roles\[0\] === role/);
  assert.match(content, /ROLE_NODE_FALLBACK", ownerTrusted: false/);
});


test("autonomous user-turn causality has producer, transport, consumer and invariant ends", () => {
  assert.match(content, /expectedUserTurnId/);
  assert.match(content, /resolvedUserTurnId/);
  assert.match(content, /assistantId/);
  assert.match(background, /expectedUserTurnId:\s*expectedTurn\.id/);
  assert.match(background, /expectedUserIndex:\s*expectedTurn\.index/);
  assert.match(background, /page\.autonomousTurn/);
  assert.match(causality, /AUTONOMOUS_USER_TURN_ID_MISMATCH/);
  assert.match(causality, /pairedUserTurnId:\s*resolvedUserTurnId/);
  assert.match(stability, /OBSERVATION_CAUSAL_PAIR_MISMATCH/);
  assert.match(background, /EXTERNAL_TURN_INTERLEAVED/);
});


test("external manual interleave has producer, persisted transport, A2A consumer and deterministic fixture", () => {
  assert.match(causality, /externalAssistantInterleaveEvidence/);
  assert.match(background, /responseInterleave/);
  assert.match(background, /persistedForResponseEvidence:\s*true/);
  assert.match(background, /externalInterleave:/);
  assert.match(a2a, /externalInterleave:/);
  const fixture = fs.readFileSync(
    new URL("./fixtures/v1.1.8-deterministic-manual-interleave.json", import.meta.url),
    "utf8"
  );
  assert.match(fixture, /MANUAL_PAIR_BECOMES_LATEST/);
  assert.match(fixture, /MANUAL_PAIR_REMAINS_LATEST_WHILE_AUTONOMOUS_RESPONSE_RESTABILIZES/);
});

test("accepted response provenance is serialized into bounded A2A analysisEvidence", () => {
  for (const field of [
    "documentId", "messageId", "ownerKind", "ownerTrusted", "ownerAdmissionMode",
    "assistantReplicaCount", "expectedUserTurnId", "pairedUserTurnId", "pairedUserResolvedBy", "causalMatch",
    "visibilityState", "textLength", "assistantCount", "parseMode", "externalInterleave"
  ]) {
    assert.match(background, new RegExp(`${field}:`), `${field} runtime producer missing`);
    assert.match(a2a, new RegExp(`${field}:`), `${field} A2A sanitizer missing`);
  }
  assert.match(background, /responseObservation/);
  assert.match(a2a, /responseObservation/);
});

test("v1.2.1 owner fallback is a bounded causal exception, not a general trust promotion", () => {
  assert.match(stability, /CAUSAL_VISIBLE_FALLBACK/);
  assert.match(stability, /pairedUserResolvedBy === "USER_TURN_ID"/);
  assert.match(stability, /identity\.ownerKind === "ROLE_NODE_FALLBACK"/);
  assert.match(stability, /visibilityState \|\| "unknown"\) === "visible"/);
  assert.match(stability, /responseSlotClosed !== true/);
  assert.match(background, /RESPONSE_CAUSAL_FALLBACK_ADMITTED/);
  assert.match(content, /COHERENT_ROLE_REPLICA/);
});
