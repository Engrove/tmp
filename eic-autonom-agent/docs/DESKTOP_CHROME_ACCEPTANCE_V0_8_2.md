# Desktop Chrome acceptance — EIC Autonom Agent v0.8.2

## Installation

1. Extract the v0.8.2 installation ZIP to a new directory.
2. Open `chrome://extensions`.
3. Remove or reload the previous unpacked extension.
4. Load the extracted v0.8.2 directory.
5. Reload each ChatGPT target tab once.

## A. Window isolation

1. Open two Chrome windows.
2. Link one ChatGPT conversation in each window.
3. Start different stable tasks and export both states.
4. PASS only when each exported continuity has its own `scope.windowId`, conversation
   locator and intent, with no claims, blockers or decisions from the other window.

## B. Sticky ARCHAEOLOGY_LONG

1. Start ARCHAEOLOGY_LONG.
2. Pause and resume.
3. Stop the addon, then use Start/Continue on the same linked tab/conversation.
4. PASS only when the new run remains `ARCHAEOLOGY_LONG` and retains its research state and
   effect ceiling.
5. Select another tab/conversation and repeat Start/Continue.
6. PASS only when silent specialized-mode reuse is blocked.

## C. Locator promotion and intent ownership

1. Start a new ChatGPT session from the GPT root (`g:` locator).
2. Wait for promotion to a conversation (`c:` locator).
3. Confirm the continuity locator changes to the conversation locator.
4. PASS only when the original operator/start-analysis intent is unchanged and no takeover
   intent replaces it.

## D. Completion and Nano deadline

1. Produce a long assistant response with a temporarily stable intermediate DOM.
2. PASS only when ARCHAEOLOGY_LONG does not start Nano before strict completion or a valid
   protocol-completion override.
3. Exercise a deliberately stalled Nano stream.
4. PASS only when it aborts within 180 seconds and the run enters bounded recovery rather
   than remaining indefinitely occupied.

## E. Receipt reconciliation

1. Submit a start prompt and interrupt the original run before its prompt receipt is
   confirmed.
2. Allow the matching assistant reply to arrive.
3. PASS only when the stored receipt becomes `ACKED` with confirmation time and assistant
   hash.

## F. USER_PAUSE twins

- Emit twin: a valid explicit level-10 operator choice must enter HUMAN_REQUIRED.
- Block twin: an ordinary information gap or reversible level 1–9 action must not become
  USER_PAUSE.

Record extension version, Chrome version, exported run IDs, window IDs, conversation
locators and relevant audit event IDs for every result.
