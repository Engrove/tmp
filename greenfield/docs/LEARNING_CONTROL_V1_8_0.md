# EIC Learning & Continuity Control i Greenfield 1.8.0

Omfång: **endast promptutbyggnad.** Greenfield hämtar inte AIK, Kaizen eller Operator Learning i förväg. Greenfield skriver inte till några lärande-lager och skapar inga nya effektvägar. Kontrollerna körs av EIC-sessionen. Greenfield bestämmer deterministiskt *vilka* kontroller som är obligatoriska i varje prompt, visar det för AI:n och tar emot en avgränsad resultatrapport.

Maskinspråket i A2A är engelska, och kontraktstexten återges därför på engelska nedan.

## Tre lager

| Lager | Var i prompten | När | Innehåll |
|---|---|---|---|
| A. Statiskt kontrakt | `responseContract.learningControlContract` | Varje FULL-prompt | Fristående kontrakt: `You have no built-in knowledge of EIC.`, `THE FACTUAL OWNER WINS`, definition av varje yta (AIK Learned, AIK Stream, Self-learn, Kaizen, Operator Learning, Memory, projektkronologi, global skill, repo/runtime/infra-owner) med *is / usedFor / isNot*, AIK-, Self-learn-, Kaizen- och Operator Learning-regler, routingtabell (9 rader), 3M, origin, stående triggers och regler. |
| B. Dynamisk kapsel | `control.learningControl` (`EIC_LEARNING_CONTEXT`) | Varje prompt, FULL och COMPACT | Projektscope, arbetsblock, keypoints som Greenfield har detekterat (med trigger), obligation per kontroll, överförda obligationer, återanvändbara färska resultat och en sammanfattning av föregående resultat. |
| C. Avslut och resultat | valfritt svarsfält `learningControl` | Svaret | AI:n rapporterar keypoints, AIK discovery/continuity, Kaizen, Operator Learning, Self-learn closure och om owner truth lästes om. |

En COMPACT-prompt bär inte kontraktet. Den bär kapseln och påminnelsen `responseContract.learningControl`: kontraktet från senaste FULL-prompt gäller fullt ut.

## Deterministiska keypoints (lager B)

| Keypoint | Greenfield-fakta som utlöser |
|---|---|
| `START_RESUME_AFTER_OWNER_BOOTSTRAP` | `MISSION_START`, `MISSION_RESTORE`, `SESSION_ROTATION`, eller ny kvant (`interactionCount = 0`) |
| `POST_FAILURE_FALSE_BLOCKER_UNKNOWN_EFFECT_RECOVERY` | föregående disposition `BLOCKED`/`SESSION_UNRESPONSIVE`, protokoll `BLOCKED`, rotation med `PROMPT_ACKNOWLEDGED_NO_COMPLETED_RESPONSE`/`PROMPT_EFFECT_UNKNOWN`, nano-task `UNKNOWN_EFFECT`/`FAILED` |
| `RECURRING_SOFT_BLOCKER_OR_FAILURE_FAMILY` | blockerare i ≥ 2 svar i följd (`trace.blockerStreak`) |
| `MAJOR_REPLAN_OR_SCOPE_DRIFT_RISK` | operatörsinstruktion finns (origin `HUMAN_OPERATOR`) |
| `CHECKPOINT_HANDOFF_STOP_OR_TERMINAL_CLOSE` | sista interaktionen i kvanten (`checkpointRequired`) |
| `PRE_MATERIAL_R2_EFFECT` | kan inte ses av Greenfield före svaret; stående trigger i kontraktet |

Keypoints som bara AI:n kan se (R2-effekt, replan, återkommande problemfamilj, terminalt svar) ligger som `standingTriggers` i kontraktet. Kontrollen blir då REQUIRED i samma tur.

## Obligationer

| Kontroll | REQUIRED när | Annars |
|---|---|---|
| `AIK_DISCOVERY` | alltid, utom när samma arbetsblock redan har ett rapporterat resultat | `FRESH_RESULT_REUSABLE` |
| `KAIZEN_RETRIEVAL` | någon keypoint detekterad, eller överförd | `REQUIRED_AT_DECLARED_KEYPOINT` |
| `AIK_CONTINUITY_CHECK` | kvantens sista interaktion, eller överförd | `REQUIRED_ON_TRIGGER` |
| `SELF_LEARN_CLOSURE` | kvantens sista interaktion, eller överförd | `REQUIRED_WHEN_ENDING_WORK_BLOCK` |
| `OWNER_TRUTH_REFRESH` | – | `REQUIRED_BEFORE_ACTING_ON_RETAINED_LEARNING` |

- **Arbetsblock** = `<GF-id>-s<sessionSeq>-a<activationCount>` (köstyrt) eller `<GF-id>-s<sessionSeq>`. Ny session eller ny köaktivering ger nytt block och därmed ny discovery.
- **Överföring:** en obligation som var `REQUIRED` i föregående prompt men saknas i föregående svars `learningControl` listas i `carriedOverObligations` och är `REQUIRED` igen. Detta gäller bara följdprompter (`CONTINUATION`/`READ_REQUIRED`). En sessionsgräns börjar om med egna REQUIRED-kontroller.
- **Projektscope** läses ur uppdragets första rad `Projekt: <id> - <namn> - Gf: <GF-id>` → `aikScope = project:<id>`. Saknas rubriken blir scope `RESOLVE_EXACT_PROJECT_SCOPE_FROM_OWNER_STATE_FIRST`.

## Resultatet (lager C)

`learningControl` är valfritt och additivt i `eic.a2a.response.v1`. Greenfield normaliserar det till en sluten, avgränsad form:

- okända fält tas bort, okända enum-värden blir tomma, listor och strängar begränsas;
- högst 8 000 tecken JSON; mer, eller en icke-objekt-typ, ger `{ "malformed": true }`;
- ett felaktigt `learningControl` påverkar aldrig svarets `status`/`sessionAction`.

Greenfield använder resultatet enbart till kapseln i nästa prompt, alltså återanvändning, överföring och `previousResult`. Resultatet skrivs inte till något lärande-lager, och kontraktet förbjuder AI:n att skriva det dit bara för att det finns.

## Storlek

Mätt med samma köstyrda fixtur:

| Prompt | 1.7.9 | 1.8.0 |
|---|---|---|
| FULL | 26 920 tecken | 45 715 tecken (kontrakt 14 737, resultatschema 2 919) |
| COMPACT | 5 801 tecken | 6 834 tecken (kapsel 670) |

## Risker och gränser

- **AI:n kan ljuga om utförda kontroller.** Greenfield kan bara se vad som rapporteras. Motmedel: kontraktet kräver owner readback för skrivningar, förbjuder påhittade id:n/kvitton, och en tyst utelämnad REQUIRED-kontroll överförs till nästa prompt.
- **Keypoints efter svaret** (R2, replan, terminalt) kan Greenfield inte förutse. De täcks av stående triggers i kontraktet. Greenfields detektion är därför en undre gräns, inte en fullständig lista.
- **Ingen prefetch.** Greenfield kan inte verifiera att AIK/Kaizen faktiskt är nåbara. En otillgänglig kontroll rapporteras med ett scopat utfall (`DISCOVERY_UNAVAILABLE_SCOPED`, `RETRIEVAL_UNAVAILABLE_SCOPED`).
- **Live-acceptans saknas.** Lokal Node/harness-verifiering visar promptinnehåll och parsning, inte hur EIC-modellen följer kontraktet.
