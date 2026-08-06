import { sanitizeText, sha256Hex } from "./common.mjs";

export const START_RESPONSE_CONTRACTS = Object.freeze({
  TURN_BOUND_5: "TURN_BOUND_5",
  TURNLESS_4: "TURNLESS_4",
  UNBOUND: "UNBOUND"
});

export function canonicalStartPrompt(value, maxLength = 120_000) {
  if (typeof value !== "string") throw new TypeError("Startprompten måste vara text.");
  if (!value.trim()) throw new Error("Engångsstartprompten är tom.");
  if (value.includes("\u0000")) throw new Error("Startprompten innehåller NUL och kan inte levereras säkert.");
  if (value.length > maxLength) throw new Error(`Startprompten överskrider ${maxLength} tecken.`);
  // Preserve the operator text byte-for-byte in JavaScript's UTF-16 string domain.
  // No trim, whitespace normalization or protocol wrapping is performed.
  return value;
}

export function inspectStartPromptContract(text) {
  const source = String(text ?? "");
  const protocol = /(?:EIC-AA\/5|EIC-AA%2F5)/i.test(source);
  const fieldTurn = source.match(/EIC_FIELD:turnId=([^\s>]+)/i)?.[1] || "";
  const decodedFieldTurn = fieldTurn ? decodeURIComponent(fieldTurn) : "";
  const directTurn = [...source.matchAll(/EIC_TURN:\s*(turn-[A-Za-z0-9_-]+)/gi)].map((match) => match[1])[0] || "";
  const jsonTurn = source.match(/"turnEcho"\s*:\s*"EIC_TURN:\s*(turn-[A-Za-z0-9_-]+)"/i)?.[1] || "";
  const expectedTurnId = sanitizeText(decodedFieldTurn || directTurn || jsonTurn, 180);
  const hasTurnEcho = Boolean(expectedTurnId);
  const hasNext = /EIC_NEXT:/i.test(source);
  const hasEvidence = /EIC_COMPLETION_EVIDENCE:/i.test(source);
  const hasNextActor = /EIC_NEXT_ACTOR:/i.test(source);
  const hasAutonomy = /EIC_AUTONOMY:/i.test(source);
  const markerCount = [hasNext, hasEvidence, hasNextActor, hasAutonomy].filter(Boolean).length;
  let responseContract = START_RESPONSE_CONTRACTS.UNBOUND;
  if (hasTurnEcho && markerCount === 4) responseContract = START_RESPONSE_CONTRACTS.TURN_BOUND_5;
  else if (markerCount === 4) responseContract = START_RESPONSE_CONTRACTS.TURNLESS_4;
  return {
    protocolDetected: protocol,
    responseContract,
    expectedTurnId,
    hasTurnEcho,
    hasNext,
    hasEvidence,
    hasNextActor,
    hasAutonomy
  };
}

function stringList(value, maxItems, maxLength) {
  return (Array.isArray(value) ? value : [])
    .map((item) => sanitizeText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function validateStartAnalysis(value, { expectedDigest = "", expectedChunks = null } = {}) {
  const analysis = {
    summary: sanitizeText(value?.summary, 6000),
    taskIntent: sanitizeText(value?.taskIntent, 8000),
    firstWorkUnit: sanitizeText(value?.firstWorkUnit, 5000),
    constraints: stringList(value?.constraints, 20, 1200),
    risks: stringList(value?.risks, 12, 1200),
    requiredEvidence: stringList(value?.requiredEvidence, 12, 1200),
    promptDigest: sanitizeText(value?.promptDigest, 128),
    chunksRead: Math.max(0, Number(value?.chunksRead || 0))
  };
  const errors = [];
  if (!analysis.summary) errors.push("START_SUMMARY_EMPTY");
  if (!analysis.taskIntent) errors.push("START_TASK_INTENT_EMPTY");
  if (!analysis.firstWorkUnit) errors.push("START_WORK_UNIT_EMPTY");
  const workUnit = analysis.firstWorkUnit.toLowerCase();
  if (/^(?:read|review|inspect|analyse|analyze|follow|läs|granska|analysera|följ)\b/.test(workUnit) &&
      /(?:prompt|instruction|instruktion|startprompt)/.test(workUnit)) {
    errors.push("START_WORK_UNIT_META_ONLY");
  }
  if (/\b(?:u\d+|step\s*\d+|steg\s*\d+)\s*[-–—]\s*(?:u\d+|step\s*\d+|steg\s*\d+)\b/i.test(analysis.firstWorkUnit)) {
    errors.push("START_WORK_UNIT_NOT_ATOMIC");
  }
  if (!analysis.constraints.length) errors.push("START_CONSTRAINTS_EMPTY");
  if (!analysis.requiredEvidence.length) errors.push("START_REQUIRED_EVIDENCE_EMPTY");
  if (expectedDigest && analysis.promptDigest !== expectedDigest) errors.push("START_DIGEST_MISMATCH");
  if (expectedChunks !== null && analysis.chunksRead !== Number(expectedChunks)) errors.push("START_CHUNK_COUNT_MISMATCH");
  return { valid: errors.length === 0, errors, analysis };
}

export async function buildStartPromptRecord(text, analysis) {
  const exactText = canonicalStartPrompt(text);
  const digest = await sha256Hex(exactText);
  const contract = inspectStartPromptContract(exactText);
  const validation = validateStartAnalysis({ ...analysis, promptDigest: analysis?.promptDigest || digest }, {
    expectedDigest: digest,
    expectedChunks: analysis?.chunksRead ?? null
  });
  if (!validation.valid) {
    throw new Error(`START_ANALYSIS_INVALID:${validation.errors.join(",")}`);
  }
  return {
    text: exactText,
    digest,
    length: exactText.length,
    contract,
    analysis: validation.analysis
  };
}
