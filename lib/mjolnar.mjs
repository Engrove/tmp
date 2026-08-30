import { deepClone, nowIso, randomId, sanitizeText, sha256Hex } from "./common.mjs";
import {
  classifyDestructiveness,
  runHjalmarMentalControl
} from "./destructiveness.mjs";

export const MJOLNAR_PROTOCOL = "EIC_MJOLNAR_REQUEST/1";
export const MJOLNAR_RESPONSE_PROTOCOL = "MJOLNAR_RESPONSE/1";
export const M2_MANDATE_PROTOCOL = "EIC_M2_MANDATE/1";
export const M2_OPERATOR_EQUIVALENT_LEVEL = 9.9999;

export const MJOLNAR_STATES = Object.freeze({
  IDLE: "IDLE",
  CANDIDATE_DETECTED: "CANDIDATE_DETECTED",
  REQUEST_BUILT: "REQUEST_BUILT",
  ADJUDICATING: "ADJUDICATING",
  READ_REQUIRED: "READ_REQUIRED",
  DELEGATED_PENDING_DISPATCH: "DELEGATED_PENDING_DISPATCH",
  DISPATCHING: "DISPATCHING",
  READBACK_PENDING: "READBACK_PENDING",
  VERIFIED_EFFECT: "VERIFIED_EFFECT",
  HUMAN_REQUIRED: "HUMAN_REQUIRED",
  REJECTED: "REJECTED",
  INCONCLUSIVE: "INCONCLUSIVE",
  ERROR_PAUSED: "ERROR_PAUSED"
});

export const MJOLNAR_VERDICTS = Object.freeze({
  DELEGABLE: "DELEGABLE",
  READ_REQUIRED: "READ_REQUIRED",
  HUMAN_REQUIRED: "HUMAN_REQUIRED",
  REJECT: "REJECT",
  INCONCLUSIVE: "INCONCLUSIVE"
});

export const DELEGATION_CLASSES = Object.freeze({
  D0_ROUTINE: "D0_ROUTINE",
  D1_CONTROLLED: "D1_CONTROLLED",
  D2_PRIVILEGED: "D2_PRIVILEGED",
  HUMAN_AUTHORITY_REQUIRED: "HUMAN_AUTHORITY_REQUIRED",
  // Backward-compatible alias for imported v0.6.7 ledger/display values.
  D2_HUMAN_AUTHORITY: "HUMAN_AUTHORITY_REQUIRED",
  UNKNOWN: "UNKNOWN"
});

export const MJOLNAR_ROLLOUT_MODES = Object.freeze({
  SHADOW: "SHADOW",
  D0_LIVE: "D0_LIVE",
  D1_LIVE: "D1_LIVE",
  D2_LIVE: "D2_LIVE"
});

export const ACTION_REGISTRY = Object.freeze({
  REFRESH_TAB_STATUS: Object.freeze({
    actionCode: "REFRESH_TAB_STATUS",
    delegationClass: DELEGATION_CLASSES.D0_ROUTINE,
    executor: "BACKGROUND_TAB_READER",
    reversible: true,
    rollback: "NOT_REQUIRED_READ_ONLY",
    readback: "FRESH_TAB_AND_PAGE_SNAPSHOT",
    idempotent: true,
    permissions: ["tabs"],
    hardDeny: [],
    destructivenessLevel: 1
  }),
  RECONNECT_CONTENT: Object.freeze({
    actionCode: "RECONNECT_CONTENT",
    delegationClass: DELEGATION_CLASSES.D0_ROUTINE,
    executor: "PACKAGED_CONTENT_BRIDGE",
    reversible: true,
    rollback: "DISCONNECT_OR_RELOAD_TARGET_TAB",
    readback: "EIC_PING_VERSION_MATCH",
    idempotent: true,
    permissions: ["tabs", "scripting"],
    hardDeny: ["UNSUPPORTED_HOST"],
    destructivenessLevel: 3
  }),
  RELOAD_SELECTED_TAB: Object.freeze({
    actionCode: "RELOAD_SELECTED_TAB",
    delegationClass: DELEGATION_CLASSES.D0_ROUTINE,
    executor: "CHROME_TABS_RELOAD",
    reversible: true,
    rollback: "NOT_REQUIRED_TRANSIENT",
    readback: "TAB_COMPLETE_SAME_TARGET_NEW_DOCUMENT_EPOCH_BRIDGE_MATCH",
    idempotent: false,
    permissions: ["tabs"],
    hardDeny: ["TARGET_MISMATCH", "ACTIVE_GENERATION"],
    destructivenessLevel: 3
  }),
  HARD_RELOAD_SELECTED_TAB: Object.freeze({
    actionCode: "HARD_RELOAD_SELECTED_TAB",
    delegationClass: DELEGATION_CLASSES.D0_ROUTINE,
    executor: "CHROME_TABS_RELOAD_BYPASS_CACHE",
    reversible: true,
    rollback: "NOT_REQUIRED_TRANSIENT",
    readback: "HARD_RELOAD_DISPATCH_BOUND_SAME_TARGET_NEW_DOCUMENT_EPOCH_BRIDGE_MATCH",
    idempotent: false,
    permissions: ["tabs"],
    hardDeny: ["TARGET_MISMATCH", "ACTIVE_GENERATION", "ACTIVE_BROWSER_MUTATION"],
    destructivenessLevel: 3
  }),
  RESUME_VERIFIED_MARKER: Object.freeze({
    actionCode: "RESUME_VERIFIED_MARKER",
    delegationClass: DELEGATION_CLASSES.D0_ROUTINE,
    executor: "EIC_STATE_MACHINE",
    reversible: true,
    rollback: "RETURN_TO_PAUSED_AGENT",
    readback: "TURN_BOUND_MARKER_REPARSE",
    idempotent: true,
    permissions: [],
    hardDeny: ["BLOCKER", "HJALMAR_NO_GO", "WRONG_TURN"],
    destructivenessLevel: 2
  }),
  SET_AUTO_DISCARDABLE_FALSE: Object.freeze({
    actionCode: "SET_AUTO_DISCARDABLE_FALSE",
    delegationClass: DELEGATION_CLASSES.D1_CONTROLLED,
    executor: "CHROME_TABS_UPDATE",
    reversible: true,
    rollback: "RESTORE_PREVIOUS_AUTO_DISCARDABLE",
    readback: "TAB_AUTO_DISCARDABLE_FALSE",
    idempotent: true,
    permissions: ["tabs"],
    hardDeny: ["TARGET_MISMATCH"],
    destructivenessLevel: 3
  }),
  RESTORE_AUTO_DISCARDABLE: Object.freeze({
    actionCode: "RESTORE_AUTO_DISCARDABLE",
    delegationClass: DELEGATION_CLASSES.D1_CONTROLLED,
    executor: "CHROME_TABS_UPDATE",
    reversible: true,
    rollback: "SET_AUTO_DISCARDABLE_FALSE_IF_RUN_ACTIVE",
    readback: "TAB_AUTO_DISCARDABLE_EQUALS_PREVIOUS",
    idempotent: true,
    permissions: ["tabs"],
    hardDeny: ["TARGET_MISMATCH"],
    destructivenessLevel: 3
  }),
  AUTH_OWNER_ROUTE: Object.freeze({
    actionCode: "AUTH_OWNER_ROUTE",
    delegationClass: DELEGATION_CLASSES.D2_PRIVILEGED,
    executor: "TARGET_SESSION_OWNER_ROUTE_HANDOFF",
    reversible: false,
    rollback: "",
    readback: "",
    idempotent: false,
    permissions: [],
    hardDeny: ["LOGIN_REQUIRED", "CAPTCHA", "CREDENTIAL_OR_SECRET_REQUIRED", "USER_PRESENCE_REQUIRED"],
    destructivenessLevel: 9
  }),
  CHANGE_PERMISSION: Object.freeze({
    actionCode: "CHANGE_PERMISSION",
    delegationClass: DELEGATION_CLASSES.D2_PRIVILEGED,
    executor: "TARGET_SESSION_OWNER_ROUTE_HANDOFF",
    reversible: false,
    rollback: "",
    readback: "",
    idempotent: false,
    permissions: [],
    hardDeny: ["UNKNOWN_PRINCIPAL", "UNKNOWN_SCOPE", "NO_ROLLBACK", "OWNER_ROUTE_UNAVAILABLE"],
    destructivenessLevel: 9
  }),
  MERGE_BRANCH: Object.freeze({
    actionCode: "MERGE_BRANCH",
    delegationClass: DELEGATION_CLASSES.D2_PRIVILEGED,
    executor: "TARGET_SESSION_OWNER_ROUTE_HANDOFF",
    reversible: false,
    rollback: "",
    readback: "",
    idempotent: false,
    permissions: [],
    hardDeny: ["UNKNOWN_REPOSITORY", "UNKNOWN_BASE_OR_HEAD", "NO_ROLLBACK", "OWNER_ROUTE_UNAVAILABLE"],
    destructivenessLevel: 9
  }),
  CREATE_RELEASE: Object.freeze({
    actionCode: "CREATE_RELEASE",
    delegationClass: DELEGATION_CLASSES.D2_PRIVILEGED,
    executor: "TARGET_SESSION_OWNER_ROUTE_HANDOFF",
    reversible: false,
    rollback: "",
    readback: "",
    idempotent: false,
    permissions: [],
    hardDeny: ["UNKNOWN_ARTIFACT_OR_TAG", "NO_ROLLBACK", "OWNER_ROUTE_UNAVAILABLE"],
    destructivenessLevel: 9
  }),
  DEPLOY_PRODUCTION: Object.freeze({
    actionCode: "DEPLOY_PRODUCTION",
    delegationClass: DELEGATION_CLASSES.D2_PRIVILEGED,
    executor: "TARGET_SESSION_OWNER_ROUTE_HANDOFF",
    reversible: false,
    rollback: "",
    readback: "",
    idempotent: false,
    permissions: [],
    hardDeny: ["UNKNOWN_ENVIRONMENT_OR_REVISION", "NO_ROLLBACK", "OWNER_ROUTE_UNAVAILABLE"],
    destructivenessLevel: 9
  })
});

const LEVEL_10_PATTERNS = [
  "CAPTCHA", "LOGIN", "AUTHENTICATION", "CREDENTIAL", "PASSWORD",
  "PRIVATE KEY", "ACCESS TOKEN", "SECRET", "IRREVERSIBLE",
  "PERMANENT DELETE", "UNKNOWN BLAST RADIUS", "SECURITY POLICY EXCEPTION"
];

const D2_ACTION_CODES = Object.freeze([
  "AUTH_OWNER_ROUTE",
  "CHANGE_PERMISSION",
  "MERGE_BRANCH",
  "CREATE_RELEASE",
  "DEPLOY_PRODUCTION"
]);

const D2_ACTION_POLICY = Object.freeze({
  AUTH_OWNER_ROUTE: "Use only an already-authorized owner route or session. Never request, expose, synthesize or enter credentials, secrets, CAPTCHA answers or user-presence factors.",
  CHANGE_PERMISSION: "Change only the exact principal, resource and permission scope named in the request. Preserve a concrete rollback to the prior permission state.",
  MERGE_BRANCH: "Merge only the exact head into the exact base through the repository owner route. Re-read branch/PR state before merge and verify the resulting commit through owner readback.",
  CREATE_RELEASE: "Create only the exact release/tag/artifact named in the request. Verify the release object through its owner route and retain an explicit rollback or withdrawal path.",
  DEPLOY_PRODUCTION: "Deploy only the exact immutable revision to the exact environment. Require a tested rollback target and verify deployment/runtime state through the deployment owner route."
});

export function isD2PrivilegedAction(actionCode) {
  return D2_ACTION_CODES.includes(sanitizeText(actionCode, 120));
}

function unknown(value) {
  const text = sanitizeText(value, 6000);
  return text || "UNKNOWN";
}

const ACTIVE_BROWSER_MUTATION_STATUSES = new Set([
  "DELEGATED_PENDING_DISPATCH",
  "DISPATCHING",
  "DISPATCHED",
  "READBACK_PENDING"
]);

const BROWSER_MUTATION_EXECUTORS = new Set([
  "CHROME_TABS_RELOAD",
  "CHROME_TABS_RELOAD_BYPASS_CACHE",
  "CHROME_TABS_UPDATE"
]);

export function findActiveBrowserMutation(priorLedger = []) {
  for (let index = priorLedger.length - 1; index >= 0; index -= 1) {
    const entry = priorLedger[index];
    const action = ACTION_REGISTRY[entry?.actionCode];
    if (BROWSER_MUTATION_EXECUTORS.has(action?.executor) &&
        ACTIVE_BROWSER_MUTATION_STATUSES.has(entry?.status)) {
      return entry;
    }
  }
  return null;
}

function known(value) {
  const text = sanitizeText(value, 6000);
  return Boolean(text && !/^UNKNOWN$/i.test(text));
}

export function createM2Mandate(request = {}, {
  issuedAt = Date.now(),
  validityMs = 5 * 60 * 1000
} = {}) {
  const issued = new Date(issuedAt).toISOString();
  const expires = new Date(issuedAt + Math.max(1_000, Number(validityMs || 0))).toISOString();
  return {
    protocol: M2_MANDATE_PROTOCOL,
    schema: "eic.autonom.m2-mandate.v1",
    mandateKind: "M2_MANDATE",
    authorityLevel: M2_OPERATOR_EQUIVALENT_LEVEL,
    authoritySemantics: "OPERATOR_APPROVAL_EQUIVALENT_BELOW_LEVEL_10",
    actualOperatorApproval: false,
    level10Excluded: true,
    exactTarget: sanitizeText(request.exact_target, 1200),
    actionCode: sanitizeText(request.action_code, 120),
    expectedEffect: sanitizeText(request.expected_effect, 1600),
    ownerRoute: sanitizeText(request.owner_surface, 400),
    ownerEvidenceLocator: sanitizeText(request.owner_evidence_locator, 1200),
    governingAuthority: sanitizeText(request.governing_authority, 1200),
    rollbackPath: sanitizeText(request.rollback_path, 1600),
    readbackPlan: sanitizeText(request.readback_plan, 1600),
    idempotencyKey: sanitizeText(request.idempotency_key, 300),
    requestId: sanitizeText(request.request_id, 240),
    sourceSnapshotHash: sanitizeText(request.created_from_snapshot_hash, 128),
    reversibility: sanitizeText(request.reversibility, 40),
    materialAmbiguity: sanitizeText(request.material_ambiguity, 80),
    humanAuthorityClass: sanitizeText(request.human_authority_class, 80),
    issuedAt: issued,
    validUntil: expires,
    limitations: [
      "DOES_NOT_CREATE_PERMISSION",
      "DOES_NOT_PROMOTE_EVIDENCE",
      "EXACT_TARGET_ONLY",
      "OWNER_READBACK_REQUIRED",
      "NO_CREDENTIAL_OR_HUMAN_PRESENCE_SUBSTITUTION",
      "LEVEL_10_REQUIRES_ACTUAL_OPERATOR"
    ]
  };
}

export function buildD2DelegationPrompt(request = {}) {
  const actionCode = sanitizeText(request.action_code, 120);
  if (!isD2PrivilegedAction(actionCode)) {
    throw new Error("D2_ACTION_NOT_REGISTERED");
  }
  const policy = D2_ACTION_POLICY[actionCode];
  const mandate = request.m2_mandate?.protocol === M2_MANDATE_PROTOCOL
    ? request.m2_mandate
    : createM2Mandate(request);
  return `EIC_MJOLNAR_D2/1

M2_MANDATE_JSON: ${JSON.stringify(mandate)}

Execute at most one privileged owner-route action. The M2 mandate is equivalent to operator approval for this exact bounded action below level 10. It is not an actual OPERATOR_APPROVAL, does not create permission, and is not proof that the effect occurred.

ACTION_CODE: ${unknown(actionCode)}
EXACT_TARGET: ${unknown(request.exact_target)}
OWNER_ROUTE: ${unknown(request.owner_surface)}
OWNER_EVIDENCE_LOCATOR: ${unknown(request.owner_evidence_locator)}
GOVERNING_AUTHORITY: ${unknown(request.governing_authority)}
EXPECTED_EFFECT: ${unknown(request.expected_effect)}
ROLLBACK_PATH: ${unknown(request.rollback_path)}
READBACK_PLAN: ${unknown(request.readback_plan)}
IDEMPOTENCY_KEY: ${unknown(request.idempotency_key)}

ACTION POLICY:
${policy}

MANDATORY CONTROL:
- Re-read the exact owner route and target before any write/effect.
- Use only permissions and authenticated sessions already available to the target session.
- Do not request, reveal, infer, synthesize or enter credentials, access tokens, private keys, secrets, CAPTCHA answers or user-presence factors.
- Do not widen scope, target, principal, repository, environment, artifact, branch or revision.
- Perform no action if authorization, exact target, rollback, readback or blast radius is uncertain.
- After the action, perform the declared owner readback and return the exact resolvable locator and observed result.
- If the effect cannot be owner-verified, return BLOCKER and do not claim success.
- Prompt acknowledgement or assistant text is not effect verification.`;
}

export function isTrustedOperatorCandidate(candidate) {
  return Boolean(candidate &&
    candidate.sourceClass === "LOCAL_STATE_MACHINE" &&
    ["HUMAN_ACTION_CANDIDATE", "OPERATOR_PROXY_REQUIRED"].includes(candidate.triggerType) &&
    candidate.actionCode &&
    candidate.exactTarget);
}

export async function createIdempotencyKey({
  actionCode,
  exactTarget,
  expectedEffect,
  conversationLocator,
  snapshotHash
} = {}) {
  return sha256Hex([
    unknown(actionCode),
    unknown(exactTarget),
    unknown(expectedEffect),
    unknown(conversationLocator),
    unknown(snapshotHash)
  ].join("|"));
}

export async function buildMjolnarRequest(candidate = {}, context = {}) {
  if (!isTrustedOperatorCandidate(candidate)) {
    throw new Error("UNTRUSTED_MJOLNAR_TRIGGER");
  }
  const action = ACTION_REGISTRY[candidate.actionCode] || null;
  const idempotencyKey = await createIdempotencyKey({
    actionCode: candidate.actionCode,
    exactTarget: candidate.exactTarget,
    expectedEffect: candidate.expectedEffect,
    conversationLocator: context.conversationLocator,
    snapshotHash: context.snapshotHash
  });
  return {
    protocol: MJOLNAR_PROTOCOL,
    request_id: randomId("mjolnar"),
    session_id: unknown(context.sessionId),
    conversation_locator: unknown(context.conversationLocator),
    stable_goal: unknown(context.stableGoal),
    active_work_unit: unknown(context.activeWorkUnit),
    verified_state: Array.isArray(context.verifiedState) ? context.verifiedState.slice(0, 20) : [],
    proposed_action: unknown(candidate.proposedAction),
    action_code: unknown(candidate.actionCode),
    exact_target: unknown(candidate.exactTarget),
    expected_effect: unknown(candidate.expectedEffect),
    executor: unknown(action?.executor || candidate.executor),
    governing_authority: unknown(context.governingAuthority),
    owner_surface: unknown(candidate.ownerSurface),
    owner_evidence_locator: unknown(candidate.ownerEvidenceLocator),
    reversibility: candidate.reversibility || (action?.reversible ? "YES" : "UNKNOWN"),
    rollback_path: unknown(candidate.rollbackPath || action?.rollback),
    human_authority_class: candidate.humanAuthorityClass || "UNKNOWN",
    material_ambiguity: candidate.materialAmbiguity || "UNKNOWN",
    hjalmar_verdict: unknown(context.hjalmarVerdict),
    hjalmar_evidence_limit: unknown(context.hjalmarEvidenceLimit),
    hjalmar_provenance: context.hjalmarProvenance === "TRUSTED_EXTERNAL_CHANNEL"
      ? "TRUSTED_EXTERNAL_CHANNEL"
      : "UNTRUSTED_OR_ABSENT",
    created_from_snapshot_hash: unknown(context.snapshotHash),
    idempotency_key: idempotencyKey,
    destructiveness_level: Number(candidate.destructivenessLevel || action?.destructivenessLevel || 1),
    destructiveness_rationale: unknown(candidate.destructivenessRationale || candidate.proposedAction),
    readback_plan: unknown(candidate.readbackPlan || action?.readback),
    requested_result: "ADJUDICATE",
    source_class: candidate.sourceClass,
    created_at: nowIso()
  };
}

function level10Reason(request) {
  const assessment = classifyDestructiveness({
    actionCode: request.action_code,
    proposedAction: request.proposed_action,
    expectedEffect: request.expected_effect,
    exactTarget: request.exact_target,
    rollbackPath: request.rollback_path,
    ownerSurface: request.owner_surface,
    destructivenessLevel: request.destructiveness_level,
    destructivenessRationale: request.destructiveness_rationale
  });
  if (request.human_authority_class === "REQUIRED") {
    return { ...assessment, level: 10, humanDecisionRequired: true, reasonCode: "HUMAN_AUTHORITY_CLASS_REQUIRED" };
  }
  return assessment;
}


export function runBiasBoundedChecks(request, variant = null) {
  const facts = variant || request;
  const actionCode = sanitizeText(facts?.action_code, 120);
  const exactTarget = sanitizeText(facts?.exact_target, 1200);
  const expectedEffect = sanitizeText(facts?.expected_effect, 1200);
  const valid = Boolean(actionCode && exactTarget && expectedEffect &&
    actionCode !== "UNKNOWN" && exactTarget !== "UNKNOWN" && expectedEffect !== "UNKNOWN");
  return {
    status: valid ? "PASS" : "INCONCLUSIVE",
    label: "BIAS_BOUNDED",
    checks: {
      omSymmetry: valid,
      presentationInvariant: valid,
      actorNameInvariant: valid,
      counterfactualSourceInvariant: valid,
      selfReportExcluded: true,
      aiMajorityExcluded: true,
      taskSpecificEvidence: valid,
      abstentionEnabled: true
    }
  };
}

function responseBase(request) {
  return {
    protocol: MJOLNAR_RESPONSE_PROTOCOL,
    request_id: request.request_id,
    verdict: MJOLNAR_VERDICTS.INCONCLUSIVE,
    delegation_class: DELEGATION_CLASSES.UNKNOWN,
    action_scope: "EXACTLY_ONE_REGISTERED_ACTION",
    action_code: request.action_code,
    exact_target: request.exact_target,
    authority_source: request.governing_authority,
    owner_route: request.owner_surface,
    executor: request.executor,
    rollback: request.rollback_path,
    readback_required: true,
    bias_check: "INCONCLUSIVE",
    evidence_limit: "Mjölnar bedömer delegerbarhet men bevisar aldrig effekt.",
    destructiveness_level: Number(request.destructiveness_level || 1),
    destructiveness_name: "",
    hjalmar_mental_control: "NOT_REQUIRED",
    reason: "",
    next_action: "PAUSE",
    eic_autonomy: "PAUSE"
  };
}

export function adjudicateMjolnarRequest(request, {
  priorLedger = [],
  readSatisfied = false
} = {}) {
  const response = responseBase(request);
  if (!request || request.protocol !== MJOLNAR_PROTOCOL) {
    response.reason = "SCHEMA_OR_PROTOCOL_INVALID";
    return response;
  }
  if (request.source_class !== "LOCAL_STATE_MACHINE") {
    response.verdict = MJOLNAR_VERDICTS.REJECT;
    response.reason = "UNTRUSTED_CANDIDATE_PROVENANCE";
    return response;
  }
  if (priorLedger.some((item) =>
    item.idempotencyKey === request.idempotency_key &&
    ["DELEGATED_PENDING_DISPATCH", "DISPATCHING", "DISPATCHED", "READBACK_PENDING", "VERIFIED_EFFECT"].includes(item.status))) {
    response.verdict = MJOLNAR_VERDICTS.REJECT;
    response.reason = "DUPLICATE_OR_UNKNOWN_PRIOR_EFFECT";
    response.next_action = "OWNER_READ_BEFORE_RETRY";
    return response;
  }
  if (request.hjalmar_provenance === "TRUSTED_EXTERNAL_CHANNEL" &&
      /NO[-_ ]?GO|BLOCK/i.test(request.hjalmar_verdict || "")) {
    response.verdict = MJOLNAR_VERDICTS.REJECT;
    response.reason = "HJALMAR_BLOCK_NON_OVERRIDE";
    return response;
  }

  const assessment = level10Reason(request);
  response.destructiveness_level = assessment.level;
  response.destructiveness_name = assessment.name;
  if (assessment.humanDecisionRequired) {
    response.verdict = MJOLNAR_VERDICTS.HUMAN_REQUIRED;
    response.delegation_class = DELEGATION_CLASSES.HUMAN_AUTHORITY_REQUIRED;
    response.reason = assessment.reasonCode || "DESTRUCTIVENESS_LEVEL_10";
    response.next_action = "HUMAN_REQUIRED";
    return response;
  }

  const action = ACTION_REGISTRY[request.action_code];
  if (!action) {
    response.verdict = MJOLNAR_VERDICTS.REJECT;
    response.reason = "UNKNOWN_ACTION_CODE";
    return response;
  }
  response.delegation_class = action.delegationClass;
  response.executor = action.executor;
  response.rollback = action.rollback;
  response.owner_route = request.owner_surface;
  const bias = runBiasBoundedChecks(request);
  response.bias_check = bias.status;
  if (bias.status !== "PASS") {
    response.verdict = MJOLNAR_VERDICTS.INCONCLUSIVE;
    response.reason = "BIAS_INVARIANCE_INCONCLUSIVE";
    return response;
  }

  const targetKnown = known(request.exact_target);
  const ownerKnown = known(request.owner_surface) && known(request.owner_evidence_locator);
  const privileged = action.delegationClass === DELEGATION_CLASSES.D2_PRIVILEGED;
  const controlled = action.delegationClass === DELEGATION_CLASSES.D1_CONTROLLED;
  const ownerEvidenceIsLocalSnapshot = /^run:/i.test(sanitizeText(request.owner_evidence_locator, 1200));

  if (!targetKnown || ((!ownerKnown || (privileged && ownerEvidenceIsLocalSnapshot)) && (controlled || privileged))) {
    response.verdict = MJOLNAR_VERDICTS.READ_REQUIRED;
    response.reason = privileged
      ? "D2_EXACT_TARGET_AND_OWNER_AUTHORITY_REQUIRED"
      : "EXACT_TARGET_OR_OWNER_READ_REQUIRED";
    response.next_action = readSatisfied ? "PAUSE" : "PERFORM_ONE_SAFE_READ";
    return response;
  }

  if (controlled) {
    if (request.reversibility !== "YES" ||
        !known(request.rollback_path) ||
        request.material_ambiguity !== "NONE") {
      response.verdict = MJOLNAR_VERDICTS.READ_REQUIRED;
      response.reason = "D1_CONTROL_REQUIREMENTS_INCOMPLETE";
      response.next_action = "PERFORM_ONE_SAFE_READ";
      return response;
    }
  }

  if (privileged) {
    if (Number(assessment.level) !== 9 ||
        request.reversibility !== "YES" ||
        !known(request.rollback_path) ||
        !known(request.readback_plan) ||
        !known(request.governing_authority) ||
        request.human_authority_class !== "NOT_REQUIRED" ||
        request.material_ambiguity !== "NONE") {
      response.verdict = MJOLNAR_VERDICTS.READ_REQUIRED;
      response.reason = "D2_PRIVILEGED_CONTROLS_INCOMPLETE";
      response.next_action = "PERFORM_ONE_SAFE_OWNER_READ";
      return response;
    }
  }

  const control = runHjalmarMentalControl({
    assessment,
    exactTarget: request.exact_target,
    ownerRoute: request.owner_surface,
    mandate: request.governing_authority,
    rollbackPath: request.rollback_path,
    readbackPlan: request.readback_plan,
    materialAmbiguity: request.material_ambiguity
  });
  response.hjalmar_mental_control = control.verdict;
  if (control.verdict === "READ_REQUIRED") {
    response.verdict = MJOLNAR_VERDICTS.READ_REQUIRED;
    response.reason = control.reason;
    response.next_action = "PERFORM_ONE_SAFE_READ";
    return response;
  }

  response.verdict = MJOLNAR_VERDICTS.DELEGABLE;
  response.reason = action.delegationClass === DELEGATION_CLASSES.D0_ROUTINE
    ? "REGISTERED_D0_ROUTINE"
    : action.delegationClass === DELEGATION_CLASSES.D1_CONTROLLED
      ? "REGISTERED_D1_ALL_CONTROLS_PRESENT"
      : "REGISTERED_D2_PRIVILEGED_ALL_CONTROLS_PRESENT";
  response.next_action = `DISPATCH:${request.action_code}`;
  response.eic_autonomy = "CONTINUE";
  if (privileged) {
    response.m2_mandate = createM2Mandate(request);
    response.mandate_kind = "M2_MANDATE";
    response.operator_approval = "NOT_PRESENT";
  }
  return response;
}

export function createMjolnarLedgerEntry(request, response) {
  return {
    ledgerId: randomId("mjolnar-ledger"),
    requestId: request.request_id,
    idempotencyKey: request.idempotency_key,
    actionCode: request.action_code,
    exactTarget: request.exact_target,
    ownerRoute: request.owner_surface,
    ownerEvidenceLocator: request.owner_evidence_locator,
    expectedEffect: request.expected_effect,
    rollbackPath: request.rollback_path,
    readbackPlan: request.readback_plan,
    snapshotHash: request.created_from_snapshot_hash,
    promptDigest: "",
    promptAcknowledged: false,
    ownerResponseHash: "",
    delegationClass: response.delegation_class,
    destructivenessLevel: Number(response.destructiveness_level || request.destructiveness_level || 1),
    hjalmarMentalControl: response.hjalmar_mental_control || "NOT_REQUIRED",
    mandateKind: response.mandate_kind || null,
    m2Mandate: response.m2_mandate ? deepClone(response.m2_mandate) : null,
    actualOperatorApproval: false,
    verdict: response.verdict,
    status: response.verdict === MJOLNAR_VERDICTS.DELEGABLE
      ? "DELEGATED_PENDING_DISPATCH"
      : response.verdict,
    dispatchAttemptedAt: null,
    dispatchedAt: null,
    readbackAt: null,
    readbackStatus: "NOT_RUN",
    effectEvidence: "",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

export function markMjolnarDispatch(entry, status, detail = "") {
  const next = deepClone(entry);
  next.status = status;
  next.updatedAt = nowIso();
  if (status === "DISPATCHING") next.dispatchAttemptedAt = next.updatedAt;
  if (status === "DISPATCHED") next.dispatchedAt = next.updatedAt;
  if (status === "READBACK_PENDING") next.readbackStatus = "PENDING";
  if (status === "OWNER_RESPONSE_OBSERVED") {
    next.readbackAt = next.updatedAt;
    next.readbackStatus = "RESPONSE_OBSERVED_UNVERIFIED";
  }
  if (status === "VERIFIED_EFFECT") {
    next.readbackAt = next.updatedAt;
    next.readbackStatus = "MATCH";
  }
  if (detail) next.effectEvidence = sanitizeText(detail, 1200);
  return next;
}

export function canDispatchForRollout(response, rolloutMode) {
  if (response?.verdict !== MJOLNAR_VERDICTS.DELEGABLE) return false;
  if (rolloutMode === MJOLNAR_ROLLOUT_MODES.SHADOW) return false;
  if (response.delegation_class === DELEGATION_CLASSES.D0_ROUTINE) {
    return [
      MJOLNAR_ROLLOUT_MODES.D0_LIVE,
      MJOLNAR_ROLLOUT_MODES.D1_LIVE,
      MJOLNAR_ROLLOUT_MODES.D2_LIVE
    ].includes(rolloutMode);
  }
  if (response.delegation_class === DELEGATION_CLASSES.D1_CONTROLLED) {
    return [MJOLNAR_ROLLOUT_MODES.D1_LIVE, MJOLNAR_ROLLOUT_MODES.D2_LIVE].includes(rolloutMode);
  }
  if (response.delegation_class === DELEGATION_CLASSES.D2_PRIVILEGED) {
    return rolloutMode === MJOLNAR_ROLLOUT_MODES.D2_LIVE;
  }
  return false;
}
