import { MAX_NEXT_INSTRUCTION_CHARS } from "./contracts.mjs";
import { normalizeText, nowIso, randomId } from "./common.mjs";

const PREFIX = "eic.gf.next-instruction.process.";

export function instructionKey(processId) {
  return `${PREFIX}${String(processId || "")}`;
}

export async function readNextInstruction(processId) {
  if (!processId) return null;
  const key = instructionKey(processId);
  const result = await chrome.storage.local.get(key);
  const value = result[key] || null;
  if (!value || value.processId !== processId || !value.instructionId) return null;
  return value;
}

export async function writeNextInstruction(process, value) {
  if (!process?.processId || !process?.runId) throw new Error("INSTRUCTION_PROCESS_REQUIRED");
  const instructionText = normalizeText(value);
  if (!instructionText) throw new Error("NEXT_INSTRUCTION_REQUIRED");
  if (instructionText.length > MAX_NEXT_INSTRUCTION_CHARS) throw new Error("NEXT_INSTRUCTION_TOO_LARGE");

  const record = {
    schema: "eic.greenfield.next-instruction.v1",
    instructionId: randomId("instruction"),
    processId: process.processId,
    runId: process.runId,
    generationAtQueue: process.generation,
    text: instructionText,
    createdAt: nowIso()
  };
  await chrome.storage.local.set({ [instructionKey(process.processId)]: record });
  return record;
}

export async function clearNextInstruction(processId, expectedInstructionId = null) {
  const current = await readNextInstruction(processId);
  if (!current) return { cleared: false, current: null };
  if (expectedInstructionId && current.instructionId !== expectedInstructionId) {
    return { cleared: false, current };
  }
  await chrome.storage.local.remove(instructionKey(processId));
  return { cleared: true, current };
}
