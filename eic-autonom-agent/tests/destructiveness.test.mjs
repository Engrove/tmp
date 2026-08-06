import test from "node:test";
import assert from "node:assert/strict";
import {
  DESTRUCTIVENESS_LADDER,
  classifyDestructiveness,
  resolveAutonomousPause,
  runHjalmarMentalControl
} from "../lib/destructiveness.mjs";

test("nivåstegen har exakt tio ordnade nivåer", () => {
  assert.equal(DESTRUCTIVENESS_LADDER.length, 10);
  assert.deepEqual(DESTRUCTIVENESS_LADDER.map((item) => item.level), [1,2,3,4,5,6,7,8,9,10]);
  assert.equal(DESTRUCTIVENESS_LADDER.at(-1).humanDecision, true);
  assert.equal(DESTRUCTIVENESS_LADDER.slice(0, 9).some((item) => item.humanDecision), false);
});

test("owner-read är nivå 1", () => {
  assert.equal(classifyDestructiveness({ proposedAction: "Läs aktuell owner-state" }).level, 1);
});

test("lokal refresh/recovery är nivå 3", () => {
  assert.equal(classifyDestructiveness({ proposedAction: "Reload selected tab and reconnect content bridge" }).level, 3);
});

test("rena Workbench- och work-package-effekter är högst nivå 5", () => {
  for (const proposedAction of [
    "Delete temporary Workbench workspace candidate",
    "Release ephemeral workspace lock and rebuild package"
  ]) {
    const result = classifyDestructiveness({ proposedAction });
    assert.ok(result.level <= 5, `${proposedAction} => ${result.level}`);
    assert.equal(result.workbenchCapped, true);
  }
});

test("kritiska effekter sänks aldrig av ett Workbench-ord", () => {
  for (const proposedAction of [
    "Force push candidate branch for work package publication recovery",
    "Merge to main package",
    "Deploy production package",
    "Run schema migration in workspace",
    "Restart service after lease"
  ]) {
    const result = classifyDestructiveness({ proposedAction });
    assert.ok(result.level >= 7, `${proposedAction} => ${result.level}`);
    assert.equal(result.hjalmarMentalControlRequired, true);
    assert.equal(result.workbenchCapped, false);
  }
});

test("EIC backend core admin är nivå 6", () => {
  assert.equal(classifyDestructiveness({ proposedAction: "Update EIC backend core admin setting" }).level, 6);
});

test("EIC backend restart är nivå 7", () => {
  assert.equal(classifyDestructiveness({ proposedAction: "Restart EIC backend core service" }).level, 7);
});

test("core schema migration är nivå 8", () => {
  assert.equal(classifyDestructiveness({ proposedAction: "Run database schema migration for EIC core" }).level, 8);
});

test("merge release deploy och permissions är nivå 9, inte mänsklig paus", () => {
  for (const proposedAction of [
    "Merge branch to main",
    "Create production release",
    "Deploy production",
    "Change repository permission"
  ]) {
    const result = classifyDestructiveness({ proposedAction });
    assert.equal(result.level, 9, proposedAction);
    assert.equal(result.humanDecisionRequired, false);
    assert.equal(result.hjalmarMentalControlRequired, true);
  }
});

test("auth secrets permanent deletion och unknown blast radius är nivå 10", () => {
  for (const proposedAction of [
    "Solve CAPTCHA",
    "Enter login password",
    "Read private key secret",
    "Permanently delete production data with no rollback",
    "Apply change with unknown blast radius"
  ]) {
    const result = classifyDestructiveness({ proposedAction });
    assert.equal(result.level, 10, proposedAction);
    assert.equal(result.humanDecisionRequired, true);
  }
});

test("Hjalmar mental kontroll krävs bara över nivå 5 och kan begära owner-read", () => {
  const assessment = classifyDestructiveness({ proposedAction: "Restart EIC backend core service" });
  const missing = runHjalmarMentalControl({
    assessment,
    exactTarget: "service:eic-backend",
    ownerRoute: "runtime owner",
    mandate: "user mandate",
    rollbackPath: "",
    readbackPlan: "",
    materialAmbiguity: "UNKNOWN"
  });
  assert.equal(missing.verdict, "READ_REQUIRED");

  const complete = runHjalmarMentalControl({
    assessment,
    exactTarget: "service:eic-backend",
    ownerRoute: "runtime owner",
    mandate: "user mandate",
    rollbackPath: "restart previous revision",
    readbackPlan: "read service health and revision",
    materialAmbiguity: "NONE"
  });
  assert.equal(complete.verdict, "PASS");
  assert.match(complete.evidenceLimit, /not an external Hjalmar owner verdict/i);
});

test("PAUSE under nivå 10 omvandlas till CONTINUE", () => {
  const assessment = classifyDestructiveness({
    proposedAction: "Låt ägande trusted session terminalisera och läs om work package"
  });
  const control = runHjalmarMentalControl({ assessment });
  const disposition = resolveAutonomousPause({
    decision: { action: "PAUSE", requestedAction: "" },
    targetResult: {
      valid: true,
      status: "CONTINUE",
      next: "Låt ägande trusted session terminalisera; läs därefter om lock och work package."
    },
    assessment,
    control
  });
  assert.equal(disposition.action, "CONTINUE");
  assert.match(disposition.requestedAction, /trusted session terminalisera/i);
});

test("nivå 10 behåller verklig PAUS", () => {
  const assessment = classifyDestructiveness({ proposedAction: "Solve CAPTCHA" });
  const control = runHjalmarMentalControl({ assessment });
  const disposition = resolveAutonomousPause({
    decision: { action: "PAUSE" },
    assessment,
    control
  });
  assert.equal(disposition.action, "PAUSE");
  assert.equal(disposition.humanRequired, true);
});
