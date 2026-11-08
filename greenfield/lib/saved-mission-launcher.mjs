// Editor projection only. The full goal text remains the saved/vault owner;
// no second record schema, GFW allocation or registry migration is introduced.
import { isGfwIdentity } from "./gfw-identity.mjs";
import { savedMissionKey, savedMissionProject } from "./saved-mission-catalog.mjs";

export const STANDARD_LAUNCHER_INSTRUCTION = "Resolve the active mission, highest active operator-owned terminal, open obligations and next restart-safe action from fresh owner state at every START/RESUME; this launcher is identity/continuity only and must never override current HUMAN_OPERATOR, Project, VTF, owner/effect or runtime state.";

export function newSavedMissionDraft() {
  return { mode: "STRUCTURED", projectId: "", projectName: "", gfId: "", instruction: STANDARD_LAUNCHER_INSTRUCTION };
}

export function savedMissionDraft(goal) {
  const source = String(goal ?? "");
  const end = source.indexOf("\n");
  const header = (end < 0 ? source : source.slice(0, end)).replace(/\r$/, "").trim();
  const instruction = end < 0 ? "" : source.slice(end + 1);
  const project = savedMissionProject(header);
  const gfId = savedMissionKey(header);
  // Require an explicit, complete Gf: suffix; a mention in a title is not
  // enough evidence to replace an operator's first line with a new header.
  const tagged = header.match(/\s[-–]\s*Gf\s*:\s*(\S+?)\s*\.?\s*$/i)?.[1]?.replace(/\.$/, "").toUpperCase();
  if (!project || !gfId || tagged !== gfId) {
    return { mode: "TEXT", projectId: "", projectName: "", gfId: "", instruction: source };
  }
  return { mode: "STRUCTURED", projectId: String(project.projectId), projectName: project.projectName, gfId, instruction };
}

export function composeSavedMissionLauncher(draft, { originalGoal = "" } = {}) {
  const projectId = String(draft?.projectId ?? "").trim();
  const projectName = String(draft?.projectName ?? "").trim();
  const gfId = String(draft?.gfId ?? "").trim().toUpperCase();
  const instruction = String(draft?.instruction ?? "");
  if (!/^[1-9]\d*$/.test(projectId) || !Number.isSafeInteger(Number(projectId))) {
    return { ok: false, error: "LAUNCHER_PROJECT_ID_REQUIRED", goal: "" };
  }
  if (!projectName || /[\r\n\u2028\u2029]/.test(projectName) || /\bGf\s*:/i.test(projectName)) {
    return { ok: false, error: "LAUNCHER_PROJECT_NAME_REQUIRED", goal: "" };
  }
  if (!isGfwIdentity(gfId)) return { ok: false, error: "LAUNCHER_GF_ID_INVALID", goal: "" };
  const previous = savedMissionDraft(originalGoal);
  // DOM textareas normalize CRLF to LF. An unchanged body must retain its
  // stored bytes even when the operator only edits the project name.
  const bodyUnchanged = previous.mode === "STRUCTURED" &&
    previous.instruction.replace(/\r\n?/g, "\n") === instruction.replace(/\r\n?/g, "\n");
  if (originalGoal && previous.mode === "STRUCTURED" && previous.projectId === projectId &&
      previous.projectName === projectName && previous.gfId === gfId && bodyUnchanged) {
    return { ok: true, error: "", goal: originalGoal };
  }
  const header = `Project: ${projectId} - ${projectName} - Gf: ${gfId}.`;
  const body = bodyUnchanged ? previous.instruction : instruction;
  const newline = bodyUnchanged && originalGoal.includes("\r\n") ? "\r\n" : "\n";
  return { ok: true, error: "", goal: body ? `${header}${newline}${body}` : header };
}

export function addStandardLauncherInstruction(instruction) {
  const source = String(instruction ?? "");
  if (source.startsWith(STANDARD_LAUNCHER_INSTRUCTION)) return source;
  return source ? `${STANDARD_LAUNCHER_INSTRUCTION}\n\n${source}` : STANDARD_LAUNCHER_INSTRUCTION;
}
