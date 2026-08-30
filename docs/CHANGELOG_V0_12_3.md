# v0.12.3 — Agent AI-session startup orientation

## Problem
AI sessions could misread EIC Autonom Agent as a GPT Action/tool/API and attempt to invoke internal labels such as `AUTONOM_AGENT_LOCAL_SESSION_STATE` instead of simply returning the startup response in the connected ChatGPT session. The deterministic bootstrap metadata also still named `eic.main-task-baseline.v2` while the active schema is v3. A self-referential baseline such as “validate the baseline” could then become post-READY work.

## Changes
- States explicitly that EIC Autonom Agent is the already-running local Chrome extension, not a callable GPT Action/tool/API/Workspace/owner route.
- States that the AI's ordinary reply in the connected ChatGPT session is how the Agent receives the response.
- Upgrades deterministic baseline metadata from v2 to v3.
- Prevents deterministic repair from converting the internal Agent owner label into an AI-side tool invocation.
- After the first rejected baseline, the one bounded correction prompt now includes a structured Agent identity/startup explanation before repeating the exact v3 response contract.
- The baseline prompt now requires `current.nextHighLeverageAction` to describe post-bootstrap work and explicitly rejects “validate baseline / finish init / call Agent” as the next mission action.

## Claim boundary
Source/package verification does not establish Desktop Chrome live acceptance.
