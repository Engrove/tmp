# Greenfield 1.9.14 — autonomt flöde

Utgångspunkt: `EIC_Autonom_Agent_Greenfield_v1.9.13_Field_Menu.zip`, diagnostik exporterad 2026-10-14 samt den kompletterande analysen. Geminis förslag användes som granskningsreferens. Dess ersättningsmoduler kopierades inte in: flera API:er och lagringsoperationer motsvarade inte originalappens implementation.

| Fynd | Levererad ändring |
| --- | --- |
| F01: UI-skal godkänns | Sanerad DOM-text återgår aldrig till originalrubriken. Svenska, engelska och finska rollrubriker samt lifecycle-text spärras före stabilitet, stale-reset och analys. Korta riktiga svar och fallback-ID:n fungerar fortfarande. |
| F02: hallucinerad analys och kapat uppdrag | Tomt underlag stoppas i både bakgrund och analysvärd. Ett strikt prefix av det fullständiga uppdraget ersätts av ett avgränsat återläsningssteg; hela uppdragsramen följer separat med. Kända falska captures får en återställningsväg till originalturnen. |
| F03: återberättad gammal evidens | Hjalmar får aktuellt svarsutdrag och ingen tidigare progressEvidence som nytt underlag. Påstådd progress måste vara ett citat ur aktuellt underlag eller markeras UNKNOWN. Rådgivarevidens binds till process, generation, turn, prompt- och svarshash. |
| F04: analys vid kögränsen | Befintliga undantag för ogiltig strukturerad kontroll, terminala besked, Nano-uppdrag och operatörsinstruktioner behålls. Det felaktiga skalet stoppas före denna logik. Aktuellt kvantum äger interaktionsnumret. |
| F05: aktiv post märks parkerad | Exporten skiljer PROCESS_RECORD, ACTIVE_QUEUE_CHECKPOINT och PARKED_QUEUE_SLOT. Lagrad phase=ANALYZING behålls eftersom den ingår i återupptagningskontraktet. En lagringspost utges inte för att bevisa levande körning. |
| F06: överlappande workers | Beständigt ägarregister med serialiserade anspråk, checkpointkontroll och spärr vid sändning/lagring. Avslutat övertagande undantar den gamla processen från återställningsförsök. Historiken bevaras. |
| F07: dold generering | Faktisk sidavläsning får en räknare per dokument och tidsstämpel. Trace-count märks som antal sparade samples. Den befintliga 30-minutersstegen och fyra timmars genereringsgräns ändras inte utifrån ett enda tiominutersfall. |
| F08: modell och kvitto | Synlig kontrolltext och aria-label separeras. Numerisk modellversion lämnas okänd när den inte exponeras. Aktuell kvittogiltighet och ogiltighetsorsak visas separat från historiska diagnostics. Kvittots 60 sekunder gäller fortfarande. |
| F09: sessionshälsa | Tidskvalitet och giltigt svar separeras. Äldre overifierade samples används inte som ny giltig baseline. Varm återupptagning behåller samma sessionsmått. Första substantiella innehåll får eget mått; TTFR förklaras som första observerade UI-aktivitet. |
| F10: timeout före readiness | Färsk readiness i rätt varm konversation prövas före 90-sekunders- och femminutersutfall, även före konfigurerad hård omladdning. Oavslutad generering byts inte bort på 90-sekundersgränsen. |
| F11: falsk initieringsbekräftelse | Initiering kräver READY från rätt användartur/konversation, utöver vanlig innehålls- och stabilitetskontroll. Ofullständig initiering behåller begränsad återhämtning. |
| F12: för kort incidenthistorik | Nya incidenter får event-ID och appversion. Upp till 200 äldre kritiska händelser reserveras utöver 400 senaste händelser. Exporten visar posternas aktualitet och ägarövertagande. |

## Preciseringar av analysen

Den befintliga koden hade redan en särskild färsk avläsning för vissa säkra kalla rotationer efter deadline. Felet i varm återupptagning kunde reproduceras; den kalla specialvägen har bevarats. Alla fem historiska warm-resume-timeouts kan inte säkert tillskrivas samma orsak.

Ett tio minuter långt genererande skal i dold flik bevisar inte att ChatGPT har låst sig. De observerade 60-sekundersintervallen motsvarar även appens avsiktliga tracebegränsning. Nya mätfält förbättrar nästa diagnostik utan att införa automatisk fokusflytt.

Ett utgånget modellkvitto återaktiveras inte av historiskt VERIFIED. Den observerade modellversionen är fortfarande okänd när UI:t bara visar tänkenivå; den befintliga kompatibilitetspolicyn har inte ändrats till ett påhittat versionsbevis.

## Datakontrakt

Originalets checksummade checkpoints och workerbindningar används även av patchen. Uppdragsägarskap ligger i ett separat checksummat register. Ett avbrutet registerbyte spärrar fortsatt användning tills lagringen är rekoncilerad. Reparation av ett UI-skal körs på faktisk sparad text och kausalt kvitto, inte på enbart textlängd eller en hårdkodad hash.

Historiska loggar återställs inte genom gissningar. De två andra korta timingproven och de 149 redan bortfallna incidenterna kan inte rekonstrueras till fullständiga svar av denna patch.
