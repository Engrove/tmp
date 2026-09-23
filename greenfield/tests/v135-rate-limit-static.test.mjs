import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
const content = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
const panel = fs.readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
const panelHtml = fs.readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");

test("v1.3.5 wires a profile-global rate-limit circuit breaker into sending", () => {
  assert.match(background, /markGlobalRateLimitWarning/);
  assert.match(background, /registerGlobalRateLimitWarning/);
  assert.match(background, /GLOBAL_RATE_LIMIT_WARNING_DETECTED/);
  assert.match(background, /executeRateLimitRecoveryPreflight/);
  assert.match(background, /markGlobalRateLimitPreflightComplete/);
  assert.match(background, /PROMPT_DISPATCH_ABORTED_BEFORE_EFFECT/);
  assert.match(background, /prompt-send-result/);
});

test("v1.3.5 recovery prefers a structurally safe acknowledgement and otherwise uses Ctrl-F5 equivalent reload", () => {
  assert.match(content, /STRUCTURAL_MULTILINGUAL_THROTTLE_MODAL_V1/);
  assert.match(content, /structurallySafeAcknowledgementButton/);
  assert.match(content, /actions\.length !== 1/);
  assert.match(content, /EIC_GF_RATE_LIMIT_RECOVERY_PREFLIGHT/);
  assert.match(content, /DISMISSED_SAFE/);
  assert.match(content, /RELOAD_REQUIRED/);
  assert.doesNotMatch(content, /Jag förstår|I understand/i);

  assert.match(background, /EIC_GF_RATE_LIMIT_RECOVERY_PREFLIGHT/);
  assert.match(background, /chrome\.tabs\.reload\(process\.tabId, \{ bypassCache: true \}\)/);
  assert.match(background, /GLOBAL_RATE_LIMIT_CTRL_F5_VERIFIED/);
  assert.match(background, /SAFE_STRUCTURAL_ACK/);
});

test("v1.3.5 warning detection is language-tolerant but does not use acknowledgement text as the selector", () => {
  assert.match(content, /RATE_LIMIT_REQUEST_SIGNAL/);
  assert.match(content, /RATE_LIMIT_THROTTLE_SIGNAL/);
  assert.match(content, /role='alertdialog'/);
  assert.match(content, /aria-modal='true'/);
  assert.match(content, /safeAcknowledgeAvailable/);
  assert.match(background, /acknowledgementTextUsedAsSelector: false/);
  assert.match(background, /literalButtonTextSelectorUsed: false/);
});

test("v1.3.5 exposes 0..300 second normal spacing and rate-limit recovery state in UI", () => {
  assert.match(panelHtml, /id="postDelay"[^>]*max="300"/);
  assert.match(panel, /Rate-limit cooldown/);
  assert.match(panel, /Seriell recovery/);
  assert.match(panel, /serialSuccessCount/);
});
