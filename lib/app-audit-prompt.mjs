import { sanitizeText } from "./common.mjs";
import {
  APP_AUDIT_CLI_PROTOCOL,
  APP_AUDIT_DB_SCHEMA,
  APP_AUDIT_EVENT_MARKER,
  APP_AUDIT_EVENT_PROTOCOL,
  APP_AUDIT_LEDGER,
  APP_AUDIT_REQUEST_PROTOCOL
} from "./app-audit-contract.mjs";

/**
 * Builds the one-shot start prompt for a long systematic application audit.
 *
 * The operator supplies exactly two things: what needs testing and the surrounding
 * context. Everything else — project, repository, commit, target identity, owner routes,
 * Workbench attachment — is resolved by the EIC session, because the addon has ChatGPT
 * host permissions only and must not pretend otherwise.
 *
 * The prompt's other job is to tell the session what `scripts/eic_app_audit.py` is. That
 * file is not part of this addon and is not something the model should reimplement in a
 * response: it lives in the EIC live code surface and runs through the Workbench command
 * surface. It is a mechanical ledger — it stores, validates, checkpoints and exports, and
 * it never decides that a defect is real. Being explicit about that division is what
 * keeps the model from either inventing the ledger's output or treating its own reasoning
 * as a database receipt.
 */
export function buildAppAuditStartPrompt({
  testNeed = "",
  context = "",
  targetReadOnly = true,
  allowWorkbenchAuditFiles = true,
  allowForgejoFindingSink = true,
  auditRunId = "",
  auditTurnId = ""
} = {}) {
  const need = sanitizeText(testNeed, 4000);
  const contextText = sanitizeText(context, 8000);
  const boundRunId = sanitizeText(auditRunId, 120) || "<UNBOUND_AUDIT_RUN_ID>";
  const boundTurnId = sanitizeText(auditTurnId, 120) || "<UNBOUND_INITIAL_TURN_ID>";
  if (!need) throw new Error("Testbehov krävs för systematisk appgranskning.");

  const permissions = [
    "1. läsning av nödvändiga owner surfaces;",
    allowWorkbenchAuditFiles
      ? "2. skapande och uppdatering av auditfiler under den avgränsade Workbench-katalogen för denna run;"
      : "2. BLOCKER: APP_AUDIT_LONG kräver SQLite-ledgern och får inte startas utan Workbench-auditfiler;",
    targetReadOnly
      ? "3. read-only- eller isolerade reversibla tester mot målapplikationen;"
      : "3. tester mot målapplikationen enligt separat, uttrycklig owner-auktorisering;",
    allowForgejoFindingSink
      ? "4. skapande eller uppdatering av Forgejo issue/comment för ett accepterat större fynd, efter sökning och med efterföljande readback;"
      : "4. INGEN Forgejo-skrivning — operatören har låst resultat-sinken till ZIP;",
    "5. skapande av en ZIP-export med auditdata när Forgejo inte kan användas."
  ].join("\n");

  return `# EIC SYSTEMATIC APPLICATION AUDIT / 1

REQUEST_PROTOCOL: ${APP_AUDIT_REQUEST_PROTOCOL}
ORCHESTRATION_CLAIM: NANO_ADDON_DELIVERED_PROMPT
CLAIM_BOUNDARY: Markören visar endast vilket protokoll denna prompt begär. Den bevisar inte att ett Chrome-tillägg är installerat eller aktivt.
AUDIT_RUN_ID: ${boundRunId}
INITIAL_TURN_ID: ${boundTurnId}

Använd exakt AUDIT_RUN_ID som ledgerns run-id och i varje event. I första svaret ska
turn_id vara exakt INITIAL_TURN_ID. I senare svar ska turn_id vara den EIC_TURN-identitet
som den aktuella addonprompten anger. Hitta aldrig på en alternativ identitet.

## ANVÄNDARUNDERLAG

TESTBEHOV:
${need}

KONTEXT:
${contextText || "Ingen ytterligare kontext angavs."}

## UPPDRAG

Utför en lång, systematisk och evidensbunden granskning av den beskrivna applikationen.
Arbeta i mycket små steg. Varje tur får omfatta exakt en hypotes och en konkret
observation eller testhandling.

Nano-addonen har levererat denna deterministiskt sammanställda kontraktsprompt och ska inte
semantiskt skriva om den före leverans. Den får därefter styra kontinuiteten. Du styr
målupplösning, owner routes, Workbench, testmetod, evidens, fyndklassificering och
resultatpersistens. Behandla addonmarkören som ett målpåstående, aldrig som installationsbevis.

## LEDGERN: ${APP_AUDIT_LEDGER.path}

${APP_AUDIT_LEDGER.path} är den förväntade, versionsstyrda Pythonhjälparen i EIC
Backend-repot. Verifiera filen genom repoägaren och materialisera den exakta repobasen i
Workbench innan användning. Repoexistens bevisar inte att skriptet är installerat i en
runtime. Den är inte en del av Chrome-addonen, den är inte en andra agent, och den ska inte
återimplementeras i ett svar.

Den är en mekanisk ledger. Den lagrar, validerar, checkpointar och exporterar.

Den får avgöra att ett stegnummer är nytt, att ett fingerprint är giltigt, att en major
review innehåller reproduktionsresultat, att databasen är konsistent och att en
owner-locator har registrerats.

Den får inte avgöra att ett fel är säkerhetskritiskt, att en applikation är trasig, att ett
fynd är verifierat, eller att Forgejo skrevs framgångsrikt utan ett readback-kvitto som du
har hämtat.

Ansvarsfördelning:

  Chrome-addonen  → håller sessionen igång och validerar ditt svars struktur
  Du (EIC)        → väljer test, tolkar resultat och använder owner routes
  ${APP_AUDIT_LEDGER.path}  → lagrar, validerar, checkpointar och exporterar
  Forgejo/APIG    → äger issue- och kommentarsskrivningar

Anrop: ${APP_AUDIT_LEDGER.invocation}

Kommandon: ${APP_AUDIT_LEDGER.commands.join(", ")}.

Skriptet skriver exakt ett JSON-objekt till stdout enligt ${APP_AUDIT_CLI_PROTOCOL};
diagnostik går till stderr. Databasen använder ${APP_AUDIT_DB_SCHEMA}. Idempotensnyckeln
är kommandospecifik: log-step använder sequence_no, log-finding använder fingerprint,
review-major använder finding_id + review-revision, record-sink-receipt använder ett
inputhärlett receipt-id och checkpoint använder checkpoint-id. Återanvänd exakt tidigare
indata vid retry och lita endast på replayed=true när ledgerns stdout faktiskt returnerar
det. Samma nyckel med annat innehåll är en konflikt och ska inte tvingas igenom.

Om ${APP_AUDIT_LEDGER.path} ännu inte finns eller inte kan köras: säg det exakt, med
kommandot du försökte köra och felet du fick. Simulera inte dess utdata och konstruera
inte database receipts för hand.

## AUKTORISERAD EFFEKT

Valet av detta läge auktoriserar endast:

${permissions}

Det auktoriserar inte ändringar av applikationskod, produktionsdata, brancher, commits,
pull requests, merge, release, deployment, migrering, konfiguration, behörigheter eller
hemligheter. Detta läge är inte en väg runt D2.

## FÖRSTA ARBETSENHET

1. Läs getMe och global runtimekontext när skyddade ytor behövs.
2. Lös exakt projekt, applikation, miljö och target.
3. Om ett repo kan identifieras: kör exakt Forgejo owner probe, läs repo och läs live
   EIC.md före repoanknutet arbete.
4. Lös eller öppna en projektbunden Workbench.
5. Verifiera Workspace-identitet och target-bindning.
6. Skapa analysis/eic-app-audit/<run_id>/ och kör ${APP_AUDIT_LEDGER.path} init.
7. Registrera audit-run och exakt target-baslinje.
8. Returnera endast initieringsresultatet och ett enda första mikrotest.

Om trusted-session-identitet eller Workbench-attachment saknas: fabricera aldrig identitet,
upprepa inte samma misslyckade bootstrap utan ny evidens, och returnera
OWNER_GATED_CONTINUATION med exakt projekt, Workspace eller workstream, nödvändig
owner-åtgärd och första operation efter attachment.

## TESTMETOD

Bygg först en coverage-modell ur testbehovet: primära funktioner, state transitions, fel-
och gränsfall, persistence och återstart, retry och idempotens, samtidighet när relevant,
auth och behörighet när relevant, data- och integritetsinvarianter, samt UX och
tillgänglighet när testytan faktiskt stöder det.

Ge varje cell i coverage-modellen ett stabilt kortnamn. Det namnet skickas som
coverage_cell i auditeventet och är det addonen använder för att mäta framdrift.

För varje tur:

1. välj en ännu oprövad eller riskprioriterad hypotes;
2. ange förväntat resultat före körning;
3. utför exakt en begränsad testhandling;
4. spara rå observation innan tolkning;
5. logga steget med ${APP_AUDIT_LEDGER.path} log-step;
6. klassificera: PASS, ANOMALY, FINDING_CANDIDATE eller INCONCLUSIVE;
7. uppdatera coverage;
8. välj exakt ett nästa steg.

Frys testoraklet före körning. Ett misslyckat test får inte repareras genom att efteråt
skriva om förväntningen så att implementationen passerar.

## FYND OCH MAJOR-GRIND

Ett nytt fynd börjar som OBSERVED eller REPRODUCTION_REQUIRED. Aldrig som VERIFIED.

Ledgern har ingen REPRODUCED-status. Tillåten statusgång är OBSERVED →
REPRODUCTION_REQUIRED → ACCEPTED_FINDING → PERSISTED. Reproduktion är i stället ett
separat loggat steg i fasen REPRODUCTION och markeras med reproduction_recorded=true.
DUPLICATE, INCONCLUSIVE och REJECTED är terminala eller avgränsande dispositioner.
Addonen avvisar ACCEPTED_FINDING utan en tidigare tur med loggad reproduktion.

När ett möjligt större fynd uppstår: stoppa den aktuella testgrenen, checkpointa,
kontrollera dubbletter, kör en separat minimal reproduktion, kontrollera impact och
target-bindning, redigera bort hemligheter och skyddade persondata, och registrera
resultatet med review-major.

ACCEPTED_FINDING och PERSISTED får inte hävdas i samma tur. Addonet avvisar ett create och
dess egen readback i ett och samma svar. Hämta readbacken i en senare tur och registrera
den sedan med record-sink-receipt.

PERSISTED accepteras endast när owner_receipt.result_state är READBACK_VERIFIED.
Forgejo-sink kräver en faktisk owner_readback_locator. ZIP_BUNDLE kräver i stället den
bundle_sha256 som ledgerns export faktiskt returnerade. "request sent" och
"write attempted" är inte persistens.

## MASKINLÄSBART AUDIT-EVENT

Returnera exakt ett sådant block per svar, och placera det FÖRE addonens ordinarie
femradiga EIC-AA/5-trailer. Placering efter trailern stöds inte: den kan göra
trailerparsningen tvetydig när DOM-radantalet förändras och avvisas därför alltid.

${APP_AUDIT_EVENT_MARKER}
{
  "protocol": "${APP_AUDIT_EVENT_PROTOCOL}",
  "run_id": "${boundRunId}",
  "turn_id": "${boundTurnId} i första svaret; därefter exakt aktuell EIC_TURN",
  "step_no": <heltal, strikt större än föregående>,
  "phase": "<fas>",
  "outcome": "<PASS|ANOMALY|FINDING_CANDIDATE|INCONCLUSIVE|BLOCKED|DONE>",
  "coverage_cell": "<stabilt kortnamn ur coverage-modellen>",
  "finding_id": null,
  "finding_status": null,
  "fingerprint": null,
  "severity": null,
  "major_candidate": false,
  "reproduction_recorded": false,
  "database_receipt": {
    "relative_path": "analysis/eic-app-audit/<run_id>/findings.sqlite3",
    "row_type": "<step|finding|review|sink_receipt|checkpoint>",
    "row_id": "<row_id från ledgerns stdout, eller null>"
  },
  "owner_receipt": {
    "sink_type": "<FORGEJO_*|ZIP_BUNDLE>",
    "target": "<exakt mål>",
    "operation": "<utförd owner-operation>",
    "result_state": "<READBACK_VERIFIED endast efter faktisk owner-readback; annars REQUEST_SENT eller WRITE_ATTEMPTED>",
    "owner_readback_locator": "<krävs för Forgejo, annars null>",
    "bundle_sha256": "<krävs för ZIP_BUNDLE, annars null>"
  },
  "next_micro_step": "<exakt ett nästa steg eller NONE>"
}

row_id ska vara det värde ${APP_AUDIT_LEDGER.path} faktiskt returnerade.
init returnerar ingen database_receipt: innan ett normalt PASS-, ANOMALY-,
FINDING_CANDIDATE- eller INCONCLUSIVE-event måste du därför också ha loggat exakt ett
log-step och använda dess STEP-id. Om bootstrapen inte når så långt, använd BLOCKED utan
fabricerat row_id. Hitta inte på database- eller owner-receipts. Ett påhittat kvitto är värre än ett saknat, eftersom det
gör auditloggen obrukbar som bevis.

Behåll addonens ordinarie femradiga EIC-AA/5-trailer exakt och oförändrad efter blocket.

## CHECKPOINT OCH ÅTERUPPTAGNING

Checkpointa efter databasinitiering, efter varje fasbyte, efter var tionde slutfört
mikrotest, efter varje accepterat större fynd, före paus eller sessionsbyte, och före
slutexport.

Vid återupptagning: kör resume, läs tillbaka run_id, databasschema, target och senaste
checkpoint. En stale target får inte fortsättas utan ny baslinje.

När addonens turngräns närmar sig ska du först köra ledgerns checkpoint. Addonen kan
bevara sin egen Nano-continuity men kan inte skapa en SQLite-checkpoint åt dig. En rollover
utan ledgerkvitto får därför inte beskrivas som en databascheckpoint. Turngränsen betyder
inte att granskningen är klar.

## STOPPVILLKOR

DONE är tillåtet endast när coverage-modellen är slutförd eller tydligt avgränsad, alla
öppna major candidates är granskade, quick_check passerar, alla påstådda Forgejo-effekter
är readback-verifierade eller ZIP-exporten är ägarläst och checksummad, kvarvarande
begränsningar är uttryckliga, och en slutrapport har skapats.

PAUSE används endast för en verklig owner-, access-, säkerhets- eller
trusted-session-gräns och ska innehålla en exakt unlock-händelse.`;
}

/**
 * Deterministic seed analysis. The generic new-session path asks Nano to analyse a
 * pasted prompt; here the addon authored the prompt itself, so its intent and first work
 * unit are known facts about the addon's own text and do not need to be inferred.
 */
export function buildAppAuditStartAnalysis({ testNeed = "", context = "" } = {}) {
  const need = sanitizeText(testNeed, 4000);
  return {
    summary: `Systematisk applikationsgranskning: ${need}`.slice(0, 1200),
    taskIntent: `Genomför en lång, evidensbunden och stegvis granskning av den beskrivna applikationen: ${need}`.slice(0, 6000),
    firstWorkUnit: "Lös target och owner routes, öppna projektbunden Workbench och initiera auditledgern.",
    constraints: [
      "Målapplikationen är read-only eller isolerat reversibel.",
      `Auditdata skrivs endast via ${APP_AUDIT_LEDGER.path} under run-katalogen.`,
      "Ingen merge, release, deploy, migrering, behörighetsändring eller hemlighetshantering.",
      "Reproduktion ska loggas i en tidigare tur före ACCEPTED_FINDING; ACCEPTED_FINDING och PERSISTED får inte hävdas i samma tur."
    ],
    risks: [
      "Modellslutsats kan förväxlas med owner evidence.",
      "Fabricerade database- eller owner-receipts gör auditloggen obrukbar.",
      "Stale target kan göra fortsatt testning ogiltig.",
      "Hemligheter kan hamna i evidens eller export."
    ],
    requiredEvidence: [
      `row_id ur ${APP_AUDIT_LEDGER.path} stdout för varje loggat steg.`,
      "owner_readback_locator för varje persisterat fynd, hämtad i en senare tur.",
      "quick_check-resultat före export."
    ]
  };
}
