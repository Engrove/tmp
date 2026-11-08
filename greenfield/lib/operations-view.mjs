export const REASONS = Object.freeze({
  MISSION_WORK_QUEUE_RETIRED:"Den tomma workern har arkiverats; använd en ny worker för nya uppdrag",
  SCHEDULE_INVALID:"Schemat är skadat; öppna Schema och spara samtliga fält på nytt",
  SCHEDULE_REPAIR_REQUIRES_COMPLETE_EDIT:"Spara alla schemafält för att ersätta det skadade schemat",
  QUEUE_ITEM_STATE_INVALID:"Köplatsens lagrade status är okänd; tidigare effekter behöver stämmas av",
  QUEUE_MULTIPLE_ACTIVE_ITEMS:"Flera platser var aktiva i samma kö; stäm av den extra platsens tidigare körning",
  MISSION_RECONCILIATION_RECEIPT_REQUIRED:"Manuell worker-avstämning är avvecklad; Greenfield använder automatisk no-replay-överlämning",
  MISSION_RECONCILIATION_STALE:"Äldre manuell avstämning är inaktuell; automatisk ägaröverlämning gäller",
  MISSION_RECONCILIATION_QUEUE_CHANGED:"Äldre manuell worker-avstämning stöds inte längre; ny session tar över automatiskt",
  RECOVERY_NOTICE_STALE:"Återställningslistan har ändrats. Uppdatera översikten och kvittera den aktuella notisen",
  RECOVERY_CONVERSATION_URL_UNAVAILABLE:"Originalkonversationen saknas. Ny session fortsätter med färsk ägarinläsning och no-replay-karantän",
  QUEUE_SAVED_NOT_STARTED:"Sparad kö som aldrig startats; inget utskick behöver återställas",
  RECOVERY_RESUME_PHASE_UNPROVEN:"Tidigare körfas kunde inte verifieras; konversationen har inte återanslutits",
  MISSION_ACTIVE_ON_OTHER_WORKER:"Tidigare worker hittad; ny session tar automatiskt över och fasar ut föregående generation",
  MISSION_OWNED_BY_OTHER_WORKER:"Tidigare ägare hittad; automatisk no-replay-överlämning förbereds",
  MISSION_OWNERSHIP_SUPERSEDED:"En nyare session äger redan uppdraget; denna äldre worker fasas ut",
  MISSION_PRIOR_EFFECT_UNRESOLVED:"Tidigare utskick isoleras i no-replay-karantän; ny session fortsätter från färsk ägarstatus",
  MISSION_PRIOR_EFFECT_QUARANTINED:"Tidigare effekt isolerad; ny session fortsätter utan att återspela gammalt utskick",
  MISSION_PRIOR_EFFECT_QUARANTINE_REQUIRED:"No-replay-kontinuitet byggs om före denna köposts aktivering; övriga uppdrag fortsätter",
  MISSION_PRIOR_OWNER_UNPROVEN:"Tidigare ägarreferens isoleras; ny session tar över med färsk ägarinläsning",
  MISSION_OWNER_CLAIM_IN_PROGRESS:"En annan session publicerar just nu sitt ägarskapskvitto; kort automatisk återkontroll",
  MISSION_QUEUE_STATE_UNPROVEN:"Denna köpost har ett inkonsekvent kötillstånd och isoleras; oberoende köposter fortsätter",
  MISSION_PRIOR_CHECKPOINT_UNRECONCILED:"Ett faktiskt skadat lagringskvitto behöver återställas; endast berörd köpost isoleras",
  RESPONSE_REPAIR_SOURCE_UNPROVEN:"Det ofullständiga svarets ursprung kan inte verifieras; inget uppdrag skickas om",
  RESPONSE_REPAIR_USER_TURN_UNPROVEN:"Den ursprungliga prompten kan ännu inte identifieras i konversationen",
  RESPONSE_REPAIR_CONVERSATION_UNPROVEN:"Originalkonversationen kunde inte läsas av",
  RESPONSE_REPAIR_ORIGINAL_RESPONSE_UNRESOLVED:"Originalsvaret kunde inte verifieras efter återställningsförsöken; inget nytt uppdrag skickas",
  CONVERSATION_GENERATION_UNRESOLVED:"Konversationen har fortfarande ett oavslutat svar",
  THINKING_MAXIMUM_VERIFIED:"Vald resonemangsnivå verifierad",
  MODEL_RECHECK_INCOMPLETE:"Alla modellkontroller kunde inte slutföras",
  NO_SENDING_PROCESS:"Ingen process väntar på ett nytt utskick",
  PROCESS_OWNER_CHANGED:"Uppdraget ändrades under kontrollen",
  PROCESS_PAUSED:"Workern är pausad",
  PROCESS_DETACHED:"Workern saknar ansluten flik",
  QUEUE_SCHEDULE_CLOSED:"Uppdraget väntar på sin schemalagda körtid",
  ADMISSION_PAUSED:"Nya utskick är pausade",
  UI_MODEL_VERIFIED:"Modellversion och tänkenivå verifierade i gränssnittet",
  UI_MODEL_COMPATIBLE:"Kompatibelt modell-/reasoningläge verifierat i gränssnittet",
  MODEL_EVIDENCE_MISSING:"Modelluppgift saknas",
  MODEL_EVIDENCE_REFRESH_UNAVAILABLE:"Återansluter modellavläsningen automatiskt",
  MODEL_EVIDENCE_CONTEXT_CHANGED:"Sidan ändrades; hämtar nya modelluppgifter",
  MODEL_EVIDENCE_STALE:"Förnyar modelluppgifterna automatiskt",
  MODEL_IDENTITY_UNKNOWN:"Modellvalet kan inte läsas säkert",
  MODEL_VERSION_MISMATCH:"Modellversionen ligger under satt modellgolv",
  MODEL_PRO_NOT_ALLOWED:"Pro-modell tillåts inte för automatiska utskick; välj ordinarie modell och vald resonemangsnivå",
  MODEL_DEGRADED:"Enklare eller automatiskt modelläge",
  THINKING_MODE_UNVERIFIED:"Reasoning-/Thinking-kontroll kan inte verifieras",
  THINKING_EFFORT_UNKNOWN:"Tänkenivån kan inte rankas mot valt golv",
  THINKING_EFFORT_TOO_LOW:"För låg tänkenivå",
  THINKING_MAXIMUM_UNVERIFIED:"Vald resonemangsnivå är inte verifierad; inget nytt utskick",
  REASONING_LEVEL_INVALID:"Ogiltig resonemangsnivå för köplatsen; välj nivån på nytt",
  REASONING_LEVEL_CHANGED:"Köplatsens resonemangsnivå ändrades; verifieras på nytt före utskick",
  THINKING_TARGET_MISMATCH:"Vald resonemangsnivå stämmer inte; Pro används inte av Greenfield",
  THINKING_TARGET_UNAVAILABLE:"Vald resonemangsnivå kunde inte väljas säkert; Pro används inte som reserv",
  THINKING_CONTROL_UNAVAILABLE:"Tänkenivåns kontroll saknas eller är inaktiverad",
  THINKING_CONTROL_AMBIGUOUS:"Flera möjliga tänkenivåkontroller hittades; inget automatiskt val",
  THINKING_OPTIONS_UNVERIFIED:"Vald resonemangsnivå kunde inte fastställas",
  THINKING_SLIDER_UNVERIFIED:"Tänkenivåns reglage kan inte läsas säkert",
  THINKING_SELECTION_TIMEOUT:"Valet av tänkenivå kunde inte bekräftas i tid; automatisk ny kontroll efter en kort väntetid",
  THINKING_SELECTION_READBACK_FAILED:"Vald tänkenivå kunde inte bekräftas; inget nytt utskick",
  THINKING_SELECTION_SESSION_CHANGED:"Sessionen ändrades under valet av tänkenivå",
  THINKING_SELECTION_DOCUMENT_CHANGED:"Sidan laddades om under valet av tänkenivå",
  THINKING_MENU_ALREADY_OPEN:"Stäng modellmenyn så kan Greenfield välja resonemangsnivå",
  THINKING_MENU_OWNERSHIP_UNVERIFIED:"En öppen meny kunde inte kopplas säkert till tänkenivån; automatisk ny kontroll efter en kort väntetid",
  THINKING_MENU_CLOSE_FAILED:"Menyn kunde inte bekräftas stängd; automatisk ny kontroll efter en kort väntetid",
  THINKING_SELECTION_BUSY:"Val av resonemangsnivå pågår",
  THINKING_SELECTION_FAILED:"Automatiskt val av resonemangsnivå misslyckades",
  THINKING_ADAPTER_UNAVAILABLE:"Styrningen för tänkenivå saknas i fliken; läs in fliken igen",
  EIC_SURFACE_UNVERIFIED:"Rätt EIC GPT-yta är inte verifierad",
  ACTIVE_CHATGPT_TAB_REQUIRED:"Välj ChatGPT-fliken i detta Chrome-fönster och starta arbetskön igen",
  EXTENSION_CONTEXT_INVALIDATED:"Anslutningen till tillägget har upphört; läs in ChatGPT-fliken igen",
  CONTENT_BRIDGE_DISPOSED:"Sidans Greenfield-anslutning har ersatts; invänta den nya anslutningen",
  EIC_GPT_ROOT_UNKNOWN:"EIC-adressen kunde inte läsas: kontrollera EIC:s startadress under Drift och starta kön igen",
  EIC_ENTRY_URL_INVALID:"Ange EIC:s HTTPS-adress på chatgpt.com/g/g-… (eller chat.openai.com), utan parametrar, fragment eller inloggningsuppgifter. Projektadresser stöds inte.",
  EIC_ENTRY_STORAGE_UNAVAILABLE:"EIC:s startadress kunde inte sparas. Kontrollera att tillägget är inläst och försök igen.",
  SESSION_ROTATION_EIC_NOT_SELECTED:"EIC kunde inte väljas i ny chatt: välj EIC i sidofältet (Fästa) och starta kön igen",
  SESSION_ROTATION_COMPOSER_DRAFT_PRESENT:"Förbereder sessionsstart: skrivfältet tas undan automatiskt.",
  SESSION_START_PREPARING:"Förbereder sessionsstart automatiskt.",
  CHAT_MODE_REQUIRED:"Greenfield kräver vanligt Chat-läge",
  BLOCKING_CHATGPT_UI:"ChatGPT visar en blockerande dialog",
  PROVIDER_CONTENT_BLOCK_PAUSE:"ChatGPT-spärr (Daybreak) återkom: GFW pausad, fortsätter sedan i ny chatt",
  PROVIDER_QUOTA_OR_FALLBACK:"ChatGPT visar kvotgräns eller fallback",
  PROVIDER_QUOTA_HOLD:"Kontogräns: nya utskick är spärrade",
  OPERATOR_ADMISSION_PAUSED:"Nya utskick pausade av operatören",
  LOCAL_PACING_WAIT:"Väntar på nästa tillåtna utskick",
  OUTSIDE_RUN_WINDOW:"Köplatsens körfönster är stängt; nästa körbara plats får fortsätta",
  SCHEDULE_PAUSED:"Köplatsen är pausad enligt sitt schema",
  QUEUE_DISPATCH_STOPPED:"Detta fönsters arbetskö är stoppad; inget nytt utskick",
  QUEUE_DISPATCH_OWNER_MISMATCH:"Worker, köplats och uppdrag stämmer inte överens; detta fönsters utskick avvaktar ny kontroll",
  QUEUE_SCHEDULE_UNAVAILABLE:"Detta fönsters sparade schema kunde inte läsas; ny kontroll om 30 sekunder",
  LOCAL_MESSAGES3H_BUDGET:"Lokal meddelandebudget för 3 timmar nådd",
  LOCAL_MESSAGES24H_BUDGET:"Lokal dygnsbudget för utskick nådd; återställs 00:00 (Europe/Helsinki)",
  LOCAL_MESSAGES7D_BUDGET:"Lokal veckobudget för utskick nådd; återställs måndag 00:00 (Europe/Helsinki)",
  LOCAL_TOKENS24H_BUDGET:"Lokal tokenbudget för idag nådd; återställs 00:00 (Europe/Helsinki)",
  PROMPT_LOCAL_TOKEN_BUDGET:"Prompten överskrider den lokala tokenbudgeten",
  OPERATOR_DRAFT_PRESENT:"Ett oskickat utkast finns i skrivfältet",
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
  DRIFT_SETTINGS_RESTORED:"Driftinställningar återställda från bokmärkesvalvet",
  SESSION_INITIALIZATION_ACK_BINDING_MISMATCH:"Initieringskvittensen tillhör inte detta uppdrag eller denna session",
  SESSION_INITIALIZATION_CONVERSATION_UNPROVEN:"Väntar på att verifiera initieringens konversation och skickade användartur",
  SESSION_INITIALIZATION_LEGACY_EFFECT_UNPROVEN:"Äldre initiering kan inte uppgraderas: utskickets eller uppdragets tillstånd är inte verifierat",
  SESSION_INITIALIZATION_ACK_HASH_MISSING:"Initieringssvaret är avläst men rätt kvittenshash saknas. Efter en minuts respit begärs kvittensen högst en gång; därefter parkeras köplatsen.",
  SESSION_INITIALIZATION_ACK_SOURCE_UNPROVEN:"Kvittensen kan inte efterfrågas säkert: originaltur eller oskickad uppdragsprompt är inte verifierad",
  SESSION_INITIALIZATION_ACK_EXHAUSTED:"Initieringskvittensen saknas. Uppdraget är sparat och parkeras; andra körbara uppdrag fortsätter. Kontrollera initieringshindret före återaktivering.",
  SESSION_INITIALIZATION_RECOVERY_EXHAUSTED:"Initieringen kunde inte verifieras efter återhämtning. Uppdraget är sparat; andra körbara uppdrag fortsätter. Kontrollera konversationen före nytt försök."
});
export function reasonLabel(code) {
  const value=String(code||"");
  if(/CHECKPOINT_UNRECOVERABLE|CHECKPOINT_RECONCILIATION|CHECKPOINT_RECOVERY_REQUIRED/.test(value))return "En sparad post behöver granskas. Välj Exportera diagnostik; radera inte uppdragen.";
  return REASONS[code] || String(code || "Väntar på första observation");
}
export function storageRetentionView(storage, retention, now=Date.now()) {
  if (!storage?.known) return {text:"Okänd",detail:storage?.error || "Lagringsmängden kunde inte mätas."};
  const mib = bytes => (Number(bytes || 0)/1048576).toFixed(1);
  const labels = {COMPACTED:"kompakterad",PARTIAL:"delvis kompakterad",RETAINED_PROTECTED:"bevarade data över städmålet",
    ERROR:"städfel",UNAVAILABLE:"städning kunde inte kontrolleras",NO_ACTION:"kontrollerad"};
  const checkedAt = Date.parse(retention?.at || ""), stale = !Number.isFinite(checkedAt) || now-checkedAt>180000;
  const status = stale ? "städstatus inaktuell" : labels[retention?.action] || "städstatus okänd";
  const prefix = `${mib(storage.bytes)} MiB · riktvärde ${mib(storage.limitBytes)} MiB · ${(storage.ratio*100).toFixed(0)} %`;
  const detail = ["Automatisk kontroll varje minut när Chrome kör tillägget. Städning startar vid 80 % och siktar på 70 %. Riktvärdet är ingen hård gräns.",
    retention?.at ? `Senast kontrollerad ${retention.at}.` : "Ingen städkörning är verifierad.",
    retention?.known ? `Senaste kontroll: frigjorde ${mib(retention.freedBytes)} MiB.` : "",
    retention?.action === 'PARTIAL' || retention?.action === 'RETAINED_PROTECTED'
      ? "Städmålet nåddes inte. Uppdrag, köer och återställningsbevis bevaras; stora poster komprimeras utan informationsförlust." : "",
    retention?.error || (retention?.errors || []).map(e=>e.code).slice(0,3).join('; ')].filter(Boolean).join(' ');
  return {text:`${prefix} · ${status}`,detail};
}
export function fleetHealth(fleet, now=Date.now()) {
  if (!fleet || !fleet.generatedAt) return {tone:"warn",label:"Inväntar driftdata",detail:"Översikten har ännu ingen verifierad status."};
  if (now-Date.parse(fleet.generatedAt)>15000) return {tone:"danger",label:"Driftdata är inaktuella",detail:"Senaste status är äldre än 15 sekunder. Kontrollera Chrome och tillägget."};
  if (fleet.runtimeFault || fleet.safety?.error) return {tone:"danger",label:"Driften är spärrad",detail:reasonLabel(fleet.runtimeFault || fleet.safety.error)};
  if (fleet.storage?.error) return {tone:"danger",label:"Lagringen kan inte kontrolleras",detail:fleet.storage.error};
  if (fleet.safety?.providerHold) return {tone:"danger",label:"ChatGPT-kvot: utskick spärrade",detail:fleet.safety.providerHold.text || "Ny modellverifiering krävs innan utskick kan fortsätta."};
  if (fleet.safety?.admissionPaused) return {tone:"warn",label:"Nya utskick är pausade",detail:"Redan skickat arbete kan slutföras. Köer och kvitton finns kvar."};
  if ((fleet.recovery?.noticeCount ?? fleet.recovery?.unresolved?.length) > 0) return {tone:"warn",label:`${fleet.recovery.noticeCount ?? fleet.recovery.unresolved.length} worker behöver återställning`,detail:"Sparat arbete finns kvar. Rätt konversation måste kunna verifieras."};
  if (fleet.heldCount) return {tone:"warn",label:`${fleet.heldCount} worker hålls av skyddet`,detail:"Orsaken visas vid respektive uppdrag."};
  if (fleet.startupWaitCount) return {tone:"warn",label:`${fleet.startupWaitCount} worker väntar på start`,detail:"Ett utkast blockerar starten. Verifierade oskickade Greenfield-utkast återställs automatiskt; annan text behöver tas om hand i skrivfältet."};
  if (fleet.storageRetention?.error || fleet.storageRetention?.errors?.length) return {tone:"warn",label:"Automatisk lagringsstädning rapporterar fel",detail:storageRetentionView(fleet.storage,fleet.storageRetention,now).detail};
  if (fleet.storage?.ratio>=0.8) return {tone:"warn",label:"Lokal lagring över städtröskeln",detail:storageRetentionView(fleet.storage,fleet.storageRetention,now).detail};
  if (fleet.rateLimitState && fleet.rateLimitState!=="NORMAL") return {tone:"warn",label:"ChatGPT begränsar trafiken",detail:reasonLabel(fleet.rateLimitState)};
  if (!fleet.activeCount) return {tone:"neutral",label:"Ingen pågående körning",detail:"Öppna EIC GPT i Chat-läge och kontrollera modellvalet före start."};
  return {tone:"good",label:"Drift under bevakning",detail:"Modellkontroll och lokala budgetar tillämpas före varje nytt utskick."};
}
export function workerReason(process,now=Date.now()) {
  if (process.storageRecoveryRequired) return reasonLabel("STORAGE_RECOVERY_REQUIRES_REVIEW");
  if (process.safety?.qualityIncident) return reasonLabel(process.safety.qualityIncident.code);
  if (process.dispatchWait?.retryAtMs > now) return `Väntar på utskickstid · minst ${process.dispatchWait.minGapSeconds} s mellan utskick · promptpaus ${process.dispatchWait.postDelaySeconds} s`;
  if (process.safety?.hold?.code === "LOCAL_PACING_WAIT") return process.safety.hold.retryAtMs > now
    ? "Väntar på tidsvillkoret för nästa utskick; ledig kapacitet ändrar inte tidsgränsen"
    : "Tidsväntan har löpt ut; kontrollerar utskicksbehörighet";
  if (process.safety?.hold) return reasonLabel(process.safety.hold.code);
  if (process.phase==="PAUSED") return process.missionPause?.reason || "Uppdraget har begärt paus";
  if (process.phase==="RECOVERING") return process.recovery?.reason || "Teknisk återhämtning";
  if (process.phase==="WAITING" && process.sessionInitialization?.status === "AWAITING_ACK")
    return reasonLabel(process.sessionInitialization.ackWait?.code || "SESSION_INITIALIZATION_ACK_HASH_MISSING");
  if (process.phase==="WAITING" && process.sessionInitialization?.status === "PENDING")
    return "Inväntar initieringskvittens; uppdragsprompten är ännu inte skickad";
  if (process.phase==="WAITING") return "Inväntar ChatGPTs svar";
  if (process.phase==="ANALYZING") return "Behandlar mottaget svar och planerar nästa steg";
  if (process.phase==="QUEUE_WAIT") return "Uppdragets checkpoint är sparad; väntar på nästa tillåtna köaktivering";
  if (process.phase==="ROTATING") return process.sessionRotation?.readinessWait?.code
    ? reasonLabel(process.sessionRotation.readinessWait.code) : "Byter till en ny EIC-konversation";
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

export function modelRecheckMessage(recheck = {}) {
  const ready=Number(recheck.ready || 0),failed=Number(recheck.failed || 0),skipped=Number(recheck.skipped || 0);
  const parts=[];
  if (ready) parts.push(`Vald resonemangsnivå verifierad för ${ready} worker. Återupptagning köad.`);
  if (failed) parts.push(`${failed} kontroll${failed===1 ? "" : "er"} blockerad${failed===1 ? "" : "e"}.`);
  if (skipped) parts.push(`${skipped} worker behåller sitt nuvarande läge.`);
  const reasons=[...new Set((recheck.results || []).filter(r=>!r.ok).map(r=>reasonLabel(r.code)))];
  if (reasons.length) parts.push(reasons.join(" · "));
  return parts.join(" ") || "Ingen process väntar på modellkontroll.";
}

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
      : "Nästa uppgift startar i en ny chatt, eller fortsätter sin ofärdiga kvant i sin egen chatt. Uppdraget parkerades med sin checkpoint.";
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
  return `Gå till nästa uppgift i kön: nuvarande uppdrag parkeras med sin checkpoint och nästa uppgift startar i en ny chatt (eller fortsätter sin ofärdiga kvant i sin egen chatt).${unread} Inget skickas om. Fortsätta?`;
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
