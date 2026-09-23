import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseTargetResponse } from "../lib/response-contract.mjs";

const fixture = JSON.parse(
  fs.readFileSync(new URL("./fixtures/v1.1.3-live-parser-comma.json", import.meta.url), "utf8")
);

test("v1.1.3 live comma-followed quoted metadata reparses canonically", () => {
  const parsed = parseTargetResponse(fixture.assistantText);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.status, fixture.expected.status);
  assert.equal(parsed.parseMode, fixture.expected.parseMode);
  assert.equal(parsed.repairApplied, true);
  assert.equal(parsed.repairCount, fixture.expected.repairCount);
  for (const needle of fixture.expected.nextSuggestedActionContains) {
    assert.ok(parsed.value.nextSuggestedAction.includes(needle), needle);
  }
});
