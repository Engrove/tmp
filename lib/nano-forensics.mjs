import { sanitizeText } from "./common.mjs";

export const NANO_FORENSIC_SEGMENT_CHARS = 700;
export const NANO_FORENSIC_MAX_SEGMENTS = 20;

function boundedText(value, maxLength) {
  return sanitizeText(value, Math.max(0, Number(maxLength || 0)));
}

export function segmentNanoOutputForAudit(text, {
  segmentChars = NANO_FORENSIC_SEGMENT_CHARS,
  maxSegments = NANO_FORENSIC_MAX_SEGMENTS
} = {}) {
  const source = String(text ?? "");
  const chars = Math.max(64, Math.min(760, Number(segmentChars || NANO_FORENSIC_SEGMENT_CHARS)));
  const count = Math.max(1, Math.min(20, Number(maxSegments || NANO_FORENSIC_MAX_SEGMENTS)));
  const capacity = chars * count;
  if (!source) return { segments: [], capturedChars: 0, omittedChars: 0, truncated: false };

  let selected = source;
  let truncated = false;
  if (source.length > capacity) {
    truncated = true;
    const marker = "\n...[FORENSIC_MIDDLE_OMITTED]...\n";
    const available = Math.max(0, capacity - marker.length);
    const head = Math.floor(available * 0.6);
    selected = `${source.slice(0, head)}${marker}${source.slice(-(available - head))}`;
  }

  const segments = [];
  for (let offset = 0; offset < selected.length && segments.length < count; offset += chars) {
    segments.push(selected.slice(offset, offset + chars));
  }
  return {
    segments,
    capturedChars: segments.reduce((sum, item) => sum + item.length, 0),
    omittedChars: Math.max(0, source.length - Math.min(source.length, capacity)),
    truncated
  };
}

export function buildNanoForensicEnvelope({
  outputText = "",
  outputSha256 = "",
  inputDigest = "",
  requestId = "",
  claimId = "",
  analysisMode = "",
  schemaId = "",
  durationMs = 0,
  outputChars = 0,
  chunkCount = 0,
  taskAttempt = 0,
  transport = "",
  firstTokenAt = null,
  overrunRecovered = "",
  earlyJsonCompleted = false,
  parseStage = "",
  parseError = "",
  validationErrors = [],
  baselineCandidatePresent = false,
  baselineResponseIdentity = "",
  sessionContextInitState = "",
  errorCode = "",
  errorDetail = ""
} = {}) {
  const segmented = segmentNanoOutputForAudit(outputText);
  return {
    schema: "eic.autonom.nano-forensics.v1",
    requestId: boundedText(requestId, 160),
    claimId: boundedText(claimId, 160),
    analysisMode: boundedText(analysisMode, 80),
    responseSchemaId: boundedText(schemaId, 120),
    inputDigest: boundedText(inputDigest, 128),
    outputSha256: boundedText(outputSha256, 128),
    outputChars: Math.max(0, Number(outputChars || outputText.length || 0)),
    chunkCount: Math.max(0, Number(chunkCount || 0)),
    durationMs: Math.max(0, Number(durationMs || 0)),
    taskAttempt: Math.max(0, Number(taskAttempt || 0)),
    transport: boundedText(transport, 120),
    firstTokenAt: firstTokenAt || null,
    overrunRecovered: boundedText(overrunRecovered, 800),
    earlyJsonCompleted: earlyJsonCompleted === true,
    parseStage: boundedText(parseStage, 80),
    parseError: boundedText(parseError, 800),
    validationErrors: (Array.isArray(validationErrors) ? validationErrors : [])
      .slice(0, 12).map((item) => boundedText(item, 300)),
    baselineCandidatePresent: baselineCandidatePresent === true,
    baselineResponseIdentity: boundedText(baselineResponseIdentity, 180),
    sessionContextInitState: boundedText(sessionContextInitState, 80),
    errorCode: boundedText(errorCode, 120),
    errorDetail: boundedText(errorDetail, 800),
    nanoOutputSegments: segmented.segments,
    nanoOutputCapturedChars: segmented.capturedChars,
    nanoOutputOmittedChars: segmented.omittedChars,
    nanoOutputTruncated: segmented.truncated
  };
}
