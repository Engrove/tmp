import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  NANO_CORE_PROFILES,
  TARGET_CORE_PROFILES,
  findCoreProfile
} from "../lib/core-profiles.mjs";
import {
  contentAddressedMandateVersion,
  registerMandateVersion
} from "../lib/task-integrity.mjs";

function activeProfiles(collection) {
  return collection.filter((profile) => profile.id !== "CUSTOM");
}

test("all active Nano and target profiles bind one non-empty immutable version to one mandate", async () => {
  for (const [surface, collection] of [
    ["NANO", NANO_CORE_PROFILES],
    ["TARGET", TARGET_CORE_PROFILES]
  ]) {
    const versions = new Map();
    let registry = null;
    for (const profile of activeProfiles(collection)) {
      assert.ok(profile.version, `${surface}:${profile.id} version`);
      assert.ok(profile.mandate, `${surface}:${profile.id} mandate`);
      assert.equal(versions.has(profile.version), false, `${surface}:${profile.version} unique`);
      versions.set(profile.version, profile.id);
      const registered = await registerMandateVersion(registry, {
        surface,
        version: profile.version,
        text: profile.mandate
      });
      registry = registered.registry;
    }
    assert.equal(Object.keys(registry.entries).length, activeProfiles(collection).length);
  }
});

test("the v0.9.3 failure is reproduced when a Nano profile changes text but keeps nano-core-v4", async () => {
  const standard = findCoreProfile(NANO_CORE_PROFILES, "STANDARD_DELIVERY");
  const workspace = findCoreProfile(NANO_CORE_PROFILES, "WORKSPACE_AWARE_GENERAL");
  const first = await registerMandateVersion(null, {
    surface: "NANO",
    version: standard.version,
    text: standard.mandate
  });
  await assert.rejects(
    registerMandateVersion(first.registry, {
      surface: "NANO",
      version: standard.version,
      text: workspace.mandate
    }),
    /MANDATE_VERSION_HASH_CONFLICT/
  );
});

test("profile switches pass when the profile version travels atomically with its mandate", async () => {
  const standard = findCoreProfile(NANO_CORE_PROFILES, "STANDARD_DELIVERY");
  const workspace = findCoreProfile(NANO_CORE_PROFILES, "WORKSPACE_AWARE_GENERAL");
  const first = await registerMandateVersion(null, {
    surface: "NANO",
    version: standard.version,
    text: standard.mandate
  });
  const second = await registerMandateVersion(first.registry, {
    surface: "NANO",
    version: workspace.version,
    text: workspace.mandate
  });
  assert.equal(second.entry.version, "nano-core-workspace-v3");
  assert.equal(second.reused, false);
});

test("custom mandate versions are deterministic and content-addressed", async () => {
  const first = await contentAddressedMandateVersion("NANO", "Mandat A");
  const repeat = await contentAddressedMandateVersion("NANO", "Mandat A");
  const changed = await contentAddressedMandateVersion("NANO", "Mandat B");
  assert.match(first, /^nano-custom-[a-f0-9]{16}$/u);
  assert.equal(repeat, first);
  assert.notEqual(changed, first);
});

test("sidepanel carries Nano mandate version through profile apply, render and save", async () => {
  const source = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../sidepanel.html", import.meta.url), "utf8");
  assert.match(html, /id="nanoMandateVersion"/u);
  assert.match(source, /elements\.nanoMandateVersion\.value = profile\.version;/u);
  assert.match(source, /nanoMandateVersion: elements\.nanoMandateVersion\.value \|\| "nano-core-v7"/u);
  assert.match(source, /elements\.nanoMandateVersion\.value = config\.nanoMandateVersion \|\| "nano-core-v7";/u);
});

test("manual mandate edits receive a new content-addressed version before save", async () => {
  const source = await readFile(new URL("../sidepanel.js", import.meta.url), "utf8");
  assert.match(source, /contentAddressedMandateVersion\("nano", elements\.nanoMandate\.value\)/u);
  assert.match(source, /contentAddressedMandateVersion\("target", elements\.targetMandate\.value\)/u);
  assert.match(source, /await Promise\.all\(\[\s*state\.nanoMandateBindingPromise,\s*state\.targetMandateBindingPromise\s*\]\);/u);
});

test("saveConfig persists the current config contract and current mandate fallbacks", async () => {
  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  assert.match(source, /current\.version = CONFIG_VERSION;/u);
  assert.doesNotMatch(source, /nano-core-v4/u);
  assert.doesNotMatch(source, /target-core-v3/u);
});
