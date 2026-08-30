import { sanitizeText } from "./common.mjs";

export const AGENT_AI_SESSION_GUIDE_SCHEMA = "eic.autonom.agent-ai-session-guide.v1";

export const AGENT_AI_SESSION_IDENTITY = Object.freeze({
  schema: AGENT_AI_SESSION_GUIDE_SCHEMA,
  actor: "AGENT",
  product: "EIC Autonom Agent",
  runtime: "LOCAL_CHROME_EXTENSION",
  interactionSurface: "CONNECTED_CHATGPT_SESSION",
  invocationRequired: false,
  notA: Object.freeze([
    "GPT_ACTION",
    "CHATGPT_TOOL",
    "API_ENDPOINT",
    "EIC_BACKEND_OWNER_ROUTE",
    "WORKSPACE_COMMAND",
    "SEPARATELY_LAUNCHED_ASSISTANT"
  ])
});

export const AGENT_AI_SESSION_EXPLANATION = `EIC AUTONOM AGENT — AI SESSION ORIENTATION

WHAT THE AGENT IS
- EIC Autonom Agent is the local Chrome-extension runtime already active in this browser target.
- It observes the connected ChatGPT conversation and maintains its own local Agent state.

WHAT THE AGENT IS NOT
- It is NOT a GPT Action.
- It is NOT a ChatGPT tool/function you should discover or call.
- It is NOT an API endpoint, Workspace command, EIC Backend owner route, or separate assistant you must launch.

HOW YOU INTERACT WITH IT
- Your reply in THIS ChatGPT session is the input.
- When the Agent asks you to "svara med" a JSON object, EIC-AA/5 trailer, or other response, RETURN THAT RESPONSE DIRECTLY HERE.
- The already-running browser extension observes the rendered reply and continues.
- Do NOT replace the requested answer with tool discovery, route probing, or instructions telling AGENT to call an internal route.

IMPORTANT ACTOR BOUNDARY
- EIC_AI_SESSION = the AI answering in this ChatGPT conversation.
- AGENT = the local Chrome extension runtime.
- AGENT may own internal state/routes that are intentionally NOT exposed as tools to EIC_AI_SESSION.
- Missing AI access to an AUTONOM_AGENT_* internal route is therefore NOT a blocker to answering the Agent.

STARTUP
- A fresh Agent target may require generic CONTROL bootstrap before normal MISSION input.
- SESSION_CONTEXT_BASELINE_REQUEST is normal Agent bootstrap.
- Satisfy the requested bootstrap response in chat; do not try to start or invoke the Agent.

MISSION BASELINE RULE
- current.nextHighLeverageAction must describe what should happen AFTER bootstrap is complete.
- Never set it to "validate the baseline", "finish session init", "call AGENT", or "read AUTONOM_AGENT_LOCAL_SESSION_STATE".
- For a neutral bootstrap whose purpose is only to await later user input, use: "Invänta nästa användarinput."`;

export function buildAgentStartupCorrectionPrompt({
  baselineRequestPrompt = "",
  reason = "",
  violations = []
} = {}) {
  const boundedReason = sanitizeText(reason, 900);
  const boundedViolations = (Array.isArray(violations) ? violations : [])
    .map((value) => sanitizeText(value, 260))
    .filter(Boolean)
    .slice(0, 6);
  const diagnostic = [
    boundedReason ? `WHY THIS EXPLANATION WAS SENT\n- Previous startup response was not accepted: ${boundedReason}` : "",
    boundedViolations.length
      ? `- Validation details: ${boundedViolations.join("; ")}`
      : "",
    "REQUIRED ACTION NOW",
    "- Do not call, search for, or hand off to EIC Autonom Agent.",
    "- Do not probe AUTONOM_AGENT_LOCAL_SESSION_STATE, GPT Actions, tools, APIs, or Workspace to make the Agent receive this.",
    "- Answer the startup request directly in this ChatGPT session.",
    "- Return the exact requested baseline JSON and exact EIC-AA/5 trailer.",
    "- After bootstrap, the baseline nextHighLeverageAction must be post-bootstrap work; for a neutral target use \"Invänta nästa användarinput.\""
  ].filter(Boolean).join("\n");

  return `${AGENT_AI_SESSION_EXPLANATION}\n\n${diagnostic}\n\nSTARTUP RESPONSE CONTRACT\n${String(baselineRequestPrompt || "").trim()}`.trim();
}
