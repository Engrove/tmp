import test from "node:test";
import assert from "node:assert/strict";
import { conversationKeyFromUrl } from "../lib/common.mjs";
import { upgradeConversationLocators } from "../lib/conversation-locator.mjs";

const customConversation =
  "https://chatgpt.com/g/g-69e0b4be34308191aa6c05db1908be1b-eic/c/6a6b29c0-e65c-83eb-9f4e-3b883735cf9c";

test("Custom GPT URL använder exakt conversation-id, inte GPT-id", () => {
  assert.equal(
    conversationKeyFromUrl(customConversation),
    "chatgpt.com:c:6a6b29c0-e65c-83eb-9f4e-3b883735cf9c"
  );
});

test("GPT-landningssida utan conversation behåller GPT-locator", () => {
  assert.equal(
    conversationKeyFromUrl("https://chatgpt.com/g/g-example"),
    "chatgpt.com:g:g-example"
  );
});

test("vanlig /c/-session får exakt conversation-locator", () => {
  assert.equal(
    conversationKeyFromUrl("https://chatgpt.com/c/conversation-123"),
    "chatgpt.com:c:conversation-123"
  );
});

test("legacy runtime och continuity migreras från sparad target-URL", () => {
  const legacy = "chatgpt.com:g-69e0b4be34308191aa6c05db1908be1b-eic";
  const runtime = {
    windows: {
      "10": {
        linkedTabs: {
          "20": {
            tabId: 20,
            url: customConversation,
            conversationKey: legacy
          }
        },
        run: {
          targetTabId: 20,
          conversationKey: legacy,
          takeoverBootstrapRequired: false
        }
      }
    }
  };
  const continuity = { position: { conversationKey: legacy } };
  const result = upgradeConversationLocators(runtime, continuity);
  const exact = "chatgpt.com:c:6a6b29c0-e65c-83eb-9f4e-3b883735cf9c";
  assert.equal(result.changed, true);
  assert.equal(result.runtime.windows["10"].linkedTabs["20"].conversationKey, exact);
  assert.equal(result.runtime.windows["10"].run.conversationKey, exact);
  assert.equal(result.runtime.windows["10"].run.takeoverBootstrapRequired, true);
  assert.equal(result.continuity.position.conversationKey, exact);
});

test("tvetydig legacy continuity-locator skrivs inte om", () => {
  const legacy = "chatgpt.com:g:shared";
  const runtime = {
    windows: {
      "1": {
        linkedTabs: {
          "2": { tabId: 2, url: "https://chatgpt.com/g/shared/c/a", conversationKey: legacy },
          "3": { tabId: 3, url: "https://chatgpt.com/g/shared/c/b", conversationKey: legacy }
        },
        run: null
      }
    }
  };
  const continuity = { position: { conversationKey: legacy } };
  const result = upgradeConversationLocators(runtime, continuity);
  assert.equal(result.ambiguousContinuityLocator, true);
  assert.equal(result.continuity.position.conversationKey, legacy);
});
