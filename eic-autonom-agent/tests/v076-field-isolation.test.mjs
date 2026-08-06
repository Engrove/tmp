import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildTurnObject,
  sanitizeIsolatedTurnField
} from "../lib/prompt-contract.mjs";

const contaminated =
  'Skapa en initial sqlite databas i workbench och logga every fynd.”，“requestedAction":"Skapa en SQLite databas i workbench och logga every fynd.';

test("v0.7.6 rejects the exact reproduced embedded requestedAction fragment", () => {
  assert.throws(
    () => sanitizeIsolatedTurnField(contaminated, {
      fieldName: "workUnit",
      maxLength: 3000
    }),
    (error) => {
      assert.equal(error?.code, "FIELD_ISOLATION_VIOLATION");
      assert.equal(error?.fieldName, "workUnit");
      assert.equal(error?.embeddedField, "requestedAction");
      return true;
    }
  );
});

test("v0.7.6 buildTurnObject independently rejects a contaminated workUnit", async () => {
  await assert.rejects(
    buildTurnObject({
      turnId: "turn-regression-1",
      targetMandate: "Mandat",
      targetMandateVersion: "target-core-v2",
      taskIntent: "Fortsätt uppgiften.",
      workUnit: contaminated,
      requestedAction: "create_sqlite_database"
    }),
    (error) => {
      assert.equal(error?.code, "FIELD_ISOLATION_VIOLATION");
      assert.equal(error?.embeddedField, "requestedAction");
      return true;
    }
  );
});

test("v0.7.6 permits ordinary prose that names requestedAction without field syntax", () => {
  const prose = "Kontrollera requestedAction innan nästa steg.";
  assert.equal(
    sanitizeIsolatedTurnField(prose, {
      fieldName: "workUnit",
      maxLength: 3000
    }),
    prose
  );
});

test("v0.7.6 normalizeDecision uses the shared field-isolation guard", async () => {
  const sidepanel = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");
  assert.match(
    sidepanel,
    /workUnit:\s*sanitizeIsolatedTurnField\(value\?\.workUnit,\s*\{\s*fieldName:\s*"workUnit",\s*maxLength:\s*3000\s*\}\)/
  );
  assert.match(
    sidepanel,
    /import \{ sanitizeIsolatedTurnField \} from "\.\/lib\/prompt-contract\.mjs";/
  );
});
