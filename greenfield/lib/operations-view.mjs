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
  EIC_GPT_ROOT_UNKNOWN:"EIC-adressen är okänd: öppna en EIC-konversation (adress /g/…) en gång och starta kön igen",
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
  NO_FRESH_APPROVED_MODEL_UI:"Ingen öppen worker visar godkänd modell och tänkenivå"
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
