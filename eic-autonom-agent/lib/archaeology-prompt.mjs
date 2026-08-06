import { sanitizeText } from "./common.mjs";
import {
  ARCHAEOLOGY_EVENT_MARKER,
  ARCHAEOLOGY_EVENT_PROTOCOL,
  ARCHAEOLOGY_REQUEST_PROTOCOL,
  scenarioById
} from "./archaeology-contract.mjs";

export function buildArchaeologyStartPrompt({
  scenario = "GENERAL_RESEARCH",
  question = "",
  context = "",
  allowWorkspaceEvidence = true,
  allowExport = true,
  archaeologyRunId = "",
  archaeologyTurnId = ""
} = {}) {
  const selected = scenarioById(scenario);
  const researchQuestion = sanitizeText(question, 5000);
  const contextText = sanitizeText(context, 12000);
  const runId = sanitizeText(archaeologyRunId, 120) || "<UNBOUND_ARCHAEOLOGY_RUN_ID>";
  const turnId = sanitizeText(archaeologyTurnId, 120) || "<UNBOUND_INITIAL_TURN_ID>";
  if (!researchQuestion) throw new Error("Forskningsfråga krävs för ARCHAEOLOGY_LONG.");

  return `# EIC ARCHAEOLOGY_LONG / 1

REQUEST_PROTOCOL: ${ARCHAEOLOGY_REQUEST_PROTOCOL}
RUN_ID: ${runId}
INITIAL_TURN_ID: ${turnId}
SCENARIO: ${selected.id}
SCENARIO_FOCUS: ${selected.focus}

## FORSKNINGSFRÅGA

${researchQuestion}

## KONTEXT

${contextText || "Ingen ytterligare kontext angavs."}

## EXKLUSIVT UPPDRAG

Detta är ett dedikerat forskningsläge. Arbeta uteslutande med analys, reverse engineering
och forskning. Implementera, patcha, committa, merga, releasa, deploya, ändra permissions,
migrera schema/data eller mutera forskningsobjektet är inte forskningsprogress och är
förbjudet i denna run.

Tillåtet är owner-läsningar, read-only-frågor, source inventory, schema-/metadataanalys,
fil- och code-graph-inspektion, jämförelse, reproducerbara read-only eller isolerat
reversibla experiment, falsifiering, lokala forskningsanteckningar, hashning, checkpoint
och evidensexport.

Varje tur får föra exakt en forskningsenhet framåt:
- en observation;
- en falsifierbar hypotes;
- en prövning;
- en motsägelse;
- en ny evidenslocator;
- eller en avgränsad syntes.

Separera alltid:
- OBSERVATION — vad som faktiskt lästes eller mättes;
- HYPOTES — en prövbar förklaring;
- INFERENS — slutsats som ännu inte är owner-verifierad;
- MOTSÄGELSE — evidens som talar emot en hypotes;
- VERIFIERAD FAKTA — endast vad rätt owner-route faktiskt stödjer.

## WORKSPACE SOM FORSKNINGSYTA

Nano kan föreslå Workspace men kan inte kalla Workspace eller bevisa dess tillstånd.
EIC AI ska använda Workspace aktivt när det förbättrar materialisering, sökning,
source-inspektion, code graph, jämförelse, read-only execution, evidensbindning,
checkpoint eller export.

Före användning:
1. kör workspace.help, workspace.capabilities.resolve eller workspace.op.describe;
2. välj exakt opcode och required fields;
3. använd minsta tillräckliga funktion;
4. läs route-native status/receipt;
5. håll Workspace-kvittot inom dess ägargräns.

Relevanta capability-familjer:
- workspace lifecycle/identity/locks;
- source add/list/inspect/verify/extract/compare;
- file list/read/search/stat;
- code_graph ensure/status/query/impact/context/receipts;
- command.safe/submit/status/log/history och read-only testverktyg;
- hash compute/verify och security scans;
- work_package evidence.bind/dossier/session.handoff;
- export report/logs/artifact.

${allowWorkspaceEvidence
  ? "Ephemeral Workspace-filer, checkpoints och evidensbindning får användas för forskningsmaterial."
  : "Workspace får endast användas read-only; skriv inte forskningsfiler eller checkpoints."}
${allowExport
  ? "En avgränsad forskningsrapport eller evidensexport får skapas när underlaget är moget."
  : "Ingen export ska skapas i denna run."}

## RESEARCH EVENT

Returnera exakt ett event per svar och placera det FÖRE den femradiga EIC-AA/5-trailern.

${ARCHAEOLOGY_EVENT_MARKER}
{
  "protocol": "${ARCHAEOLOGY_EVENT_PROTOCOL}",
  "run_id": "${runId}",
  "turn_id": "${turnId} i första svaret; därefter exakt aktuell EIC_TURN",
  "scenario": "${selected.id}",
  "step_no": <heltal, strikt större än föregående>,
  "phase": "<INTAKE|OWNER_BOOTSTRAP|WORKSPACE_DISCOVERY|SOURCE_INVENTORY|BASELINE|HYPOTHESIS|EXPERIMENT|OBSERVATION|FALSIFICATION|SYNTHESIS|CHECKPOINT|EXPORT|DONE|OPERATOR_ACTION|USER_PAUSE|BLOCKED>",
  "coverage_unit": "<stabilt kortnamn för undersökt del>",
  "hypothesis_id": "<stabilt id eller null>",
  "hypothesis": "<falsifierbar utsaga eller null>",
  "hypothesis_status": "<OPEN|SUPPORTED|CONTRADICTED|REPRODUCED|INCONCLUSIVE|CLOSED|null>",
  "method": "<exakt owner-read, query, jämförelse eller experiment>",
  "observation": "<observerat resultat utan överclaim>",
  "result": "<OBSERVED|SUPPORTED|CONTRADICTED|REPRODUCED|INCONCLUSIVE|BLOCKED|DONE>",
  "evidence_locators": ["<exakt locator; tom endast vid BLOCKED>"],
  "workspace_recommendations": [
    {
      "capability_family": "<familj>",
      "probe": "<workspace.help|workspace.capabilities.resolve|workspace.op.describe>",
      "reason": "<varför denna yta hjälper>"
    }
  ],
  "proposed_effect": "<OWNER_READ|READ_ONLY_QUERY|SOURCE_INSPECTION|SOURCE_COMPARE|CODE_GRAPH|READ_ONLY_COMMAND|EPHEMERAL_WORKSPACE_EVIDENCE|HASH|CHECKPOINT|REPORT_EXPORT|NONE>",
  "next_micro_step": "<exakt ett nästa forskningssteg eller NONE>"
}

Eventet är målsessionens påstående. Addonen kan kontrollera form, bindning, monotonicitet
och förbjudna effekter men kan inte göra externa kvitton till verifierade fakta.

## PAUS OCH SLUT

Använd EIC_AUTONOMY: USER_PAUSE endast när ett verkligt nivå-10-val krävs av operatören.
EIC_NEXT ska då ange exakt beslut, mål, alternativ och konsekvens. USER_PAUSE är strikt:
addonen får inte autonomt omvandla den till CONTINUE.

Vanlig informationsbrist, saknad locator, en reversibel nivå 1–9-åtgärd eller behov av
ytterligare owner-read är CONTINUE eller PAUSE med exakt unlock — inte USER_PAUSE.

DONE kräver att den uttryckliga forskningsfrågan är besvarad inom angiven avgränsning,
centrala hypoteser har prövats eller märkts öppna, motsägande evidens redovisas,
evidenslocators finns och begränsningar är explicita.

Avsluta varje svar med exakt fem rader:
EIC_TURN: <aktuell turn>
EIC_NEXT: <nästa steg; NONE endast vid PROGRAM_DONE>
EIC_COMPLETION_EVIDENCE: <UNIT_DONE|MILESTONE_CONTINUE|PROGRAM_BLOCKED|PROGRAM_DONE> · <konkret evidens>
EIC_NEXT_ACTOR: <AGENT|OPERATOR_ACTION|OPERATOR_DECISION|EXTERNAL_SYSTEM|NONE>
EIC_AUTONOMY: <CONTINUE|OPERATOR_ACTION_REQUIRED|USER_PAUSE|DONE>`;
}

export function buildArchaeologyStartAnalysis({
  scenario = "GENERAL_RESEARCH",
  question = "",
  context = ""
} = {}) {
  const selected = scenarioById(scenario);
  const researchQuestion = sanitizeText(question, 5000);
  return {
    summary: `ARCHAEOLOGY_LONG ${selected.label}: ${researchQuestion}`.slice(0, 1200),
    taskIntent: `Bedriv långvarig, read-only och evidensbunden forskning för frågan: ${researchQuestion}`.slice(0, 6000),
    firstWorkUnit: "Lös owner surfaces, inventera källor, verifiera Workspace-capabilities och skapa en reproducerbar baseline.",
    constraints: [
      "Endast analys, reverse engineering och forskning.",
      "Ingen implementation, patch, commit, merge, release, deploy, permission-, schema-, data- eller targetmutation.",
      "Workspace-operationer ska discoveras och beskrivas innan användning.",
      "Målsessionens kvitton och event är target claims tills owner-route har lästs."
    ],
    risks: [
      "Korrelation kan misstolkas som orsak.",
      "Ett schema eller beteende kan vara generationsbundet.",
      "Stale source eller fel target kan göra hypotesprövningen ogiltig.",
      "Workspace-kvitto kan övertolkas som repo-, runtime- eller databassanning."
    ],
    requiredEvidence: [
      "Exakta owner-, source-, generation-, query-, fil-, symbol-, receipt- eller artifact-locators.",
      "Minst ett aktivt falsifieringsförsök för centrala hypoteser.",
      "Motsägande och ofullständig evidens redovisas explicit."
    ]
  };
}
