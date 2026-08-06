# ARCHAEOLOGY_LONG

## Syfte

`ARCHAEOLOGY_LONG` är ett dedikerat långkörningsläge för analys, reverse engineering och forskning. ERP reverse engineering är en scenarioförinställning, inte lägets hela definition.

## Isolering

Läget är additivt. Befintliga `WAITING_CONTINUE`, `NEW_SESSION` och `APP_AUDIT_LONG` använder samma standardmandat och kontrollflöden som v0.7.8 om operatören inte uttryckligen väljer en ny profil eller startar `ARCHAEOLOGY_LONG`.

## Effektgräns

Tillåtet:

- owner-read och read-only query;
- source/file inspection och jämförelse;
- code graph;
- read-only eller isolerat reversibelt forskningsexperiment;
- ephemeral Workspace-evidens;
- hash, checkpoint och rapportexport.

Förbjudet som forskningsprogress:

- implementation och patch;
- commit, merge, release och deploy;
- permissions/auth-escalation;
- schema- eller datamigrering;
- produktionsskrivning;
- mutation av forskningsobjektet;
- secret access.

Runtime omplanerar en Nano-kandidat över nivå 4 till ett read-only forskningssteg. Ett uttryckligt `USER_PAUSE` bevaras som nivå 10 och går till lokal `HUMAN_REQUIRED`.

## Forskningsscenarier

- generell forskning;
- software reverse engineering;
- database reverse engineering;
- ERP reverse engineering;
- protocol reverse engineering;
- behavioral forensics.

## Workspace awareness

Nano har en mental capability-modell men ingen Workspace-behörighet. Nano får föreslå en capability-familj och kräva att EIC AI använder:

- `workspace.help`;
- `workspace.capabilities.resolve`;
- `workspace.op.describe`.

Exakt opcode, required fields, authorization och effekt måste fortfarande verifieras live.

## Eventkontrakt

Varje målsvar innehåller ett `EIC_ARCHAEOLOGY_EVENT/1` före den fyraradiga EIC-trailern. Addonen verifierar struktur, run/turn/scenario-bindning, monotont steg, hypotesstatus, evidenskrav och förbjuden effekt. Externa kvitton förblir målsessionens påståenden tills rätt owner-route läses.
