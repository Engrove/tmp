export const REASONS = Object.freeze({
  UI_MODEL_VERIFIED:"Modellversion och tänkenivå verifierade i gränssnittet",
  UI_MODEL_COMPATIBLE:"Kompatibelt modell-/reasoningläge verifierat i gränssnittet",
  MODEL_EVIDENCE_MISSING:"Modelluppgift saknas",
  MODEL_EVIDENCE_STALE:"Modelluppgiften är för gammal",
  MODEL_IDENTITY_UNKNOWN:"Modellvalet kan inte läsas säkert",
  MODEL_VERSION_MISMATCH:"Modellversionen ligger under satt modellgolv",
  MODEL_DEGRADED:"Enklare eller automatiskt modelläge",
  THINKING_MODE_UNVERIFIED:"Reasoning-/Thinking-kontroll kan inte verifieras",
  THINKING_EFFORT_UNKNOWN:"Tänkenivån kan inte rankas mot valt golv",
  THINKING_EFFORT_TOO_LOW:"För låg tänkenivå",
  EIC_SURFACE_UNVERIFIED:"Rätt EIC GPT-yta är inte verifierad",
  EIC_GPT_ROOT_UNKNOWN:"EIC-adressen kunde inte fastställas: välj EIC under Fästa på ChatGPT:s startsida (eller öppna en EIC-konversation) och starta kön igen",
  SESSION_ROTATION_EIC_NOT_SELECTED:"EIC kunde inte väljas i ny chatt: välj EIC i sidofältet (Fästa) och starta kön igen",
  CHAT_MODE_REQUIRED:"Greenfield kräver vanligt Chat-läge",
  BLOCKING_CHATGPT_UI:"ChatGPT visar en blockerande dialog",
  PROVIDER_CONTENT_BLOCK_PAUSE:"ChatGPT-spärr (Daybreak) återkom: GFW pausad, fortsätter sedan i ny chatt",
  PROVIDER_QUOTA_OR_FALLBACK:"ChatGPT visar kvotgräns eller fallback",
  PROVIDER_QUOTA_HOLD:"Kontogräns: nya utskick är spärrade",
  OPERATOR_ADMISSION_PAUSED:"Nya utskick pausade av operatören",
  LOCAL_PACING_WAIT:"Väntar på nästa tillåtna utskick",
  LOCAL_MESSAGES3H_BUDGET:"Lokal meddelandebudget för 3 timmar nådd",
  LOCAL_MESSAGES24H_BUDGET:"Lokal meddelandebudget för 24 timmar nådd",
  LOCAL_MESSAGES7D_BUDGET:"Lokal meddelandebudget för 7 dygn nådd",
  LOCAL_TOKENS24H_BUDGET:"Lokal tokenbudget för 24 timmar nådd",
  PROMPT_LOCAL_TOKEN_BUDGET:"Prompten överskrider den lokala tokenbudgeten",
  OPERATOR_DRAFT_PRESENT:"Ett manuellt utkast finns i skrivfältet",
  OPERATOR_DRAFT_CHANGED_BEFORE_SEND:"Skrivfältet ändrades före utskick; prompten skickades inte",
  IMPORTED_RECOVERY_REQUIRES_OWNER_REVIEW:"Återläst körning: stäm av tidigare effekter med EIC före ny start",
  BACKUP_RESTORE_REQUIRES_EMPTY_INSTALLATION:"Återläsningen avbröts: installationen innehåller redan processer eller köer",
  BACKUP_RESTORE_WOULD_OVERWRITE_USAGE:"Återläsningen avbröts: befintlig förbrukning får inte skrivas över",
  BACKUP_CHECKSUM_MISMATCH:"Kopians kontrollsumma stämmer inte; inget har återlästs",
  BACKUP_CONTAINS_UNRECONCILED_STORAGE:"Kopian innehåller ett lagringsfel som kräver teknisk granskning",
  BACKUP_IMPORTED_PAUSED:"Säkerhetskopian återlästes pausad",
  DISPATCH_EFFECT_UNRESOLVED:"Oklart om prompten skickades – inget omskick",
  IN_FLIGHT_QUALITY_QUARANTINE:"Svar i karantän efter modell- eller kvotändring",
  IN_FLIGHT_MODEL_UNVERIFIED:"Pågående svar saknar verifierat modellkvitto",
  STORAGE_RECOVERY_REQUIRES_REVIEW:"Lagringen behöver kontrolleras före återstart",
  SYSTEM_CLOCK_ROLLBACK:"Datorns klocka har flyttats bakåt",
  LOCAL_STORAGE_PRESSURE:"Lokal lagring över mål; automatisk retention försöker frigöra utrymme utan att stoppa utskick",
  CONVERSATION_TAB_NOT_RESTORED:"Den sparade konversationens flik saknas",
  NO_DURABLE_CONVERSATION_ID:"Äldre process saknar beständig konversationsadress",
  QUEUE_WITHOUT_PROVEN_CONVERSATION:"Sparad kö saknar verifierad konversation; använd sparat köset eller exportera för återläsning",
  AMBIGUOUS_CONVERSATION:"Flera flikar eller processer matchar samma konversation",
  RECOVERY_USER_TURN_UNPROVEN:"Tidigare prompt kan inte verifieras i konversationen",
  SEND_CONTROL_UNAVAILABLE:"Skicka-knappen är inte tillgänglig",
  NO_FRESH_APPROVED_MODEL_UI:"Ingen öppen worker visar godkänd modell och tänkenivå",
  SAFETY_POLICY_UPDATED:"Körkrav sparade",
  SAFETY_POLICY_RESTORED:"Körkrav återställda från bokmärkesvalvet",
  DRIFT_SETTINGS_RESTORED:"Driftinställningar återställda från bokmärkesvalvet"
});
export function reasonLabel(code) {
  const value=String(code||"");
  if(/CHECKPOINT_UNRECOVERABLE|CHECKPOINT_RECONCILIATION|CHECKPOINT_RECOVERY_REQUIRED/.test(value))return "En sparad post behöver granskas. Välj Exportera diagnostik; radera inte uppdragen.";
  return REASONS[code] || String(code || "Väntar på första observation");
}
export function fleetHealth(fleet, now=Date.now()) {
  if (!fleet || !fleet.generatedAt) return {tone:"warn",label:"Inväntar driftdata",detail:"Översikten har ännu ingen verifierad status."};
  if (now-Date.parse(fleet.generatedAt)>15000) return {tone:"danger",label:"Driftdata är inaktuella",detail:"Senaste status är äldre än 15 sekunder. Kontrollera Chrome och tillägget."};
  if (fleet.runtimeFault || fleet.safety?.error) return {tone:"danger",label:"Driften är spärrad",detail:reasonLabel(fleet.runtimeFault || fleet.safety.error)};
  if (fleet.storage?.error) return {tone:"danger",label:"Lagringen kan inte kontrolleras",detail:fleet.storage.error};
  if (fleet.safety?.providerHold) return {tone:"danger",label:"ChatGPT-kvot: utskick spärrade",detail:fleet.safety.providerHold.text || "Ny modellverifiering krävs innan utskick kan fortsätta."};
  if (fleet.safety?.admissionPaused) return {tone:"warn",label:"Nya utskick är pausade",detail:"Redan skickat arbete kan slutföras. Köer och kvitton finns kvar."};
  if (fleet.recovery?.unresolved?.length) return {tone:"warn",label:`${fleet.recovery.unresolved.length} worker behöver återställning`,detail:"Sparat arbete finns kvar. Rätt konversation måste kunna verifieras."};
  if (fleet.heldCount) return {tone:"warn",label:`${fleet.heldCount} worker hålls av skyddet`,detail:"Orsaken visas vid respektive uppdrag."};
  if (fleet.storageRetention?.error) return {tone:"warn",label:"Automatisk lagringsstädning rapporterar fel",detail:String(fleet.storageRetention.error)};
  if (fleet.storage?.ratio>=0.9) return {tone:"warn",label:"Lokal lagring över nominellt mål",detail:"Autoretention fortsätter i bakgrunden och tar äldsta obundna workerdata först. Lagringsprocenten stoppar inte nya utskick."};
  if (fleet.storage?.ratio>=0.8) return {tone:"warn",label:"Automatisk lagringsstädning aktiv",detail:"Greenfield kompakterar gamla checkpointkopior och rensar äldsta obundna workerdata vid behov."};
  if (fleet.rateLimitState && fleet.rateLimitState!=="NORMAL") return {tone:"warn",label:"ChatGPT begränsar trafiken",detail:reasonLabel(fleet.rateLimitState)};
  if (!fleet.activeCount) return {tone:"neutral",label:"Ingen pågående körning",detail:"Öppna EIC GPT i Chat-läge och kontrollera modellvalet före start."};
  return {tone:"good",label:"Drift under bevakning",detail:"Modellkontroll och lokala budgetar tillämpas före varje nytt utskick."};
}
export function workerReason(process,now=Date.now()) {
  if (process.storageRecoveryRequired) return reasonLabel("STORAGE_RECOVERY_REQUIRES_REVIEW");
  if (process.safety?.qualityIncident) return reasonLabel(process.safety.qualityIncident.code);
  if (process.safety?.hold) return reasonLabel(process.safety.hold.code);
  if (process.phase==="PAUSED") return process.missionPause?.reason || "Uppdraget har begärt paus";
  if (process.phase==="RECOVERING") return process.recovery?.reason || "Teknisk återhämtning";
  if (process.phase==="WAITING") return "Inväntar ChatGPTs svar";
  if (process.phase==="ANALYZING") return "Kontrollerar svaret med Nano och Hjalmar";
  if (process.phase==="ROTATING") return "Byter till en ny EIC-konversation";
  if (process.phase==="SENDING" && process.promptPause?.notBeforeAtMs>now) return "Väntar på promptpausen";
  if (process.phase==="SENDING") return "Väntar på sändningskontroll eller kapacitet";
  return process.lastError?.message || process.phase || "Ingen aktiv process";
}

// v1.8.11 operator actions on a worker card: "Läs svar" and "Gå till nästa
// uppgift i kön". Which phases offer them and what the result says.
export function workerActionAvailability(process = {}, queue = null) {
  const phase = String(process?.phase || "");
  const readResponse = (phase === "SENDING" && process?.pendingDispatch?.effectPossible === true) || phase === "WAITING";
  const queueManaged = Boolean(process?.queueContext?.itemId) && queue?.enabled !== false;
  const nextQueueItem = (queueManaged && ["SENDING", "WAITING", "PAUSED"].includes(phase)) ||
    (phase === "QUEUE_WAIT" && Boolean(queue?.enabled));
  const nextReady = Number(queue?.readyCount || 0) > 0;
  return { readResponse, nextQueueItem, nextReady };
}

const READ_OUTCOMES = Object.freeze({
  RESPONSE_CAPTURED: "Svaret är inläst. Greenfield fortsätter.",
  PROMPT_FOUND_READING: "Prompten hittades i konversationen. Svaret läses nu.",
  READING: "Svaret läses nu.",
  STILL_GENERATING: "ChatGPT skriver fortfarande. Svaret läses när det är klart.",
  NO_ANSWER_YET: "Inget svar efter prompten ännu.",
  PROMPT_NOT_FOUND: "Prompten kunde inte kopplas till en tur i konversationen.",
  PHASE_CHANGED: "Läget ändrades medan svaret lästes.",
  PROCESS_GONE: "Processen finns inte längre."
});
const ACTION_ERRORS = Object.freeze({
  READ_RESPONSE_NO_NEW_USER_TURN: "ChatGPT visar ingen ny användartur efter föregående prompt – inget att läsa. Inget skickades om.",
  READ_RESPONSE_NO_USER_TURN: "Ingen användartur syns i workerns flik.",
  READ_RESPONSE_CONVERSATION_MISMATCH: "Fliken visar en annan konversation än workerns. Inget ändrades.",
  READ_RESPONSE_PROMPT_NOT_SENT: "Prompten är inte skickad ännu – det finns inget svar att läsa.",
  READ_RESPONSE_NOT_APPLICABLE: "Det finns inget svar att läsa i det här läget.",
  READ_RESPONSE_PAGE_UNAVAILABLE: "Workerns flik svarar inte just nu.",
  READ_RESPONSE_PROCESS_CHANGED: "Workern har bytt uppdrag. Försök igen.",
  READ_RESPONSE_NO_PROCESS: "Workern har ingen process.",
  QUEUE_NEXT_NONE_RUNNABLE: "Ingen annan uppgift i kön är redo att köras nu. Inget ändrades.",
  QUEUE_NEXT_NOT_QUEUE_MANAGED: "Workern kör inte från uppdragskön.",
  QUEUE_NEXT_ITEM_MISSING: "Uppdraget finns inte i kön (eller kön är avstängd).",
  QUEUE_NEXT_NOT_ACTIVE: "Workern är inte aktiv.",
  QUEUE_NEXT_NO_PROCESS: "Workern har ingen process.",
  QUEUE_NEXT_PROCESS_CHANGED: "Workern har bytt uppdrag. Försök igen.",
  RUNTIME_FAULT: "Greenfield är spärrat av ett körfel."
});

export function workerActionMessage(action, result = {}) {
  if (result?.ok) {
    if (action === "read-response") {
      const text = READ_OUTCOMES[result.outcome] || String(result.outcome || "Klart.");
      return result.boundByOperator
        ? `Prompten kopplades till ChatGPT:s senaste användartur (ditt beslut). ${text}`
        : text;
    }
    return result.outcome === "QUEUE_WOKEN"
      ? "Nästa uppgift i kön startar."
      : "Nästa uppgift startar i en ny chatt. Uppdraget parkerades med sin checkpoint.";
  }
  const code = String(result?.code || result?.error || "");
  if (code === "READ_RESPONSE_SAFETY_HOLD") return `En annan spärr gäller: ${reasonLabel(result.holdCode)}. Läs svar ändrar den inte.`;
  if (code === "QUEUE_NEXT_BUSY") return `Greenfield är mitt i ett steg (${result.phase || "okänt"}). Försök igen om en stund.`;
  return ACTION_ERRORS[code] || code || "Åtgärden misslyckades.";
}

export function workerActionConfirmText(action, process = {}) {
  const phase = String(process?.phase || "");
  if (action === "read-response") {
    return phase === "SENDING"
      ? "Läs svar: Greenfield läser nu svaret i workerns flik. Hittas prompten inte automatiskt, kopplas ChatGPT:s senaste användartur efter föregående Greenfield-tur till prompten. Inget skickas om. Fortsätta?"
      : "";
  }
  const unread = phase === "SENDING" || phase === "WAITING"
    ? " Svaret på den senaste prompten har inte lästs; vill du ha med det, välj Läs svar först."
    : "";
  return `Gå till nästa uppgift i kön: nuvarande uppdrag parkeras med sin checkpoint och nästa uppgift startar i en ny chatt.${unread} Inget skickas om. Fortsätta?`;
}

// v1.8.12 reserved slot: what the card and the panel say and offer.
export function reservedSlotView(reservation = {}, workerId = "") {
  const reservedWorkerId = String(reservation?.workerId || "");
  const here = Boolean(workerId) && reservedWorkerId === String(workerId);
  const mode = String(reservation?.mode || "NONE");
  let detail;
  if (!reservedWorkerId) {
    detail = "Med Max parallella 2 eller fler kan ett fönster få en egen plats som alltid är ledig för det. Övriga fönster delar på resten.";
  } else if (!reservation.appliesNow) {
    detail = "Reservationen gäller först när Max parallella är 2 eller fler.";
  } else if (mode === "EXCLUSIVE") {
    const shared = Number(reservation.sharedCapacity || 0);
    detail = `1 plats är låst för ${here ? "detta fönster" : "det reserverade fönstret"}. Övriga fönster delar på ${shared} ${shared === 1 ? "plats" : "platser"}.`;
  } else if (mode === "FIRST_IN_LINE") {
    detail = "ChatGPT begränsar trafiken just nu (1 plats): det reserverade fönstret går först, men platsen är inte låst.";
  } else if (mode === "SUSPENDED") {
    detail = "ChatGPT-kvot: inga utskick just nu, inte heller från det reserverade fönstret.";
  } else {
    detail = "Reservationen väntar på nästa avläsning.";
  }
  if (reservedWorkerId && reservation.appliesNow && reservation.workerHasProcess === false) {
    detail += " Det reserverade fönstret kör inget just nu; platsen står ändå låst.";
  }
  return {
    reservedWorkerId,
    here,
    label: here ? "Detta fönster" : reservedWorkerId ? "Ett annat fönster" : "Ingen",
    detail,
    toggleText: here ? "Ta bort reservationen" : "Reservera en plats för detta fönster"
  };
}

export function reservedSlotConfirmText(reserve, { movesFromOtherWindow = false } = {}) {
  if (!reserve) return "";
  return `Reservera en plats för det här fönstret: en av platserna låses för det, även när det inte kör, och övriga fönster delar på resten.${movesFromOtherWindow ? " Reservationen flyttas från ett annat fönster." : ""} Pågående svar avbryts inte. Fortsätta?`;
}

export function reservedSlotMessage(result = {}) {
  if (!result?.ok) return ({ WORKER_ID_REQUIRED: "Fönstret saknar worker-id.", RESERVED_SLOT_READBACK_MISMATCH: "Reservationen kunde inte sparas." })[result?.code] ||
    String(result?.error || result?.code || "Reservationen kunde inte ändras.");
  if (!result.reservedWorkerId) return "Reservationen är borttagen. Alla fönster delar på platserna.";
  return result.appliesNow
    ? "Fönstret har nu en reserverad plats. Övriga fönster delar på resten."
    : "Fönstret är reserverat. Det gäller när Max parallella är 2 eller fler.";
}

// v1.8.13: a stale turn that gave its capacity slot back after the 30-minute
// reload (no generation, no answer). It still waits; the ladder is unchanged.
export function staleTurnSlotNote(process = {}, formatTime = (ms) => new Date(ms).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })) {
  const released = process?.waitingRefresh?.capacityReleased || null;
  if (String(process?.phase || "") !== "WAITING" || !released) return "";
  if (String(released.promptHash || "") !== String(process?.lastPrompt?.hash || "")) return "";
  const at = Number(released.atMs || 0);
  return `Platsen lämnad tillbaka${at ? ` ${formatTime(at)}` : ""}: ingen generering efter omladdningen. Svaret läses ändå om det kommer.`;
}
