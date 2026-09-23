> Historiskt RC1-underlag. Startregressionen i dess orderberoende checksumma rättas av 1.6.1 RC2. Se UPPDATERA_TILL_1_6_1.md i paketets rot; den har företräde framför detta dokument.

# Säkerhets- och återställningskontrakt för 1.6.0 RC1

## Kraven kommer från arbetets karaktär

De två bifogade analyserna beskriver D1–D5-arbete: avgränsad strukturering, analys, forensik, utveckling och metod-/orkestreringsarbete. Rapporternas exempel omfattar ELHO/Lean, kunskapsförvaltning, historik, labb/evaluering, dokumentation och Greenfield-supervision. Detta är underlag från användaren, inte nya liveverifieringar av EICs owner-records.

Den nya gemensamma transportregeln är att alla dessa arbeten måste ha en uttryckligen godkänd djup Thinking-session. Nano får ett litet, självständigt EIC/Greenfield-kontextblock och det verifierade UI-kvittot i sin analysinput. Domänsanning och effektverifiering förblir hos EIC; Nano är observatör och kan inte ge tillstånd till en sämre session. Rapportens arbetsdjup D2 och den befintliga Hjalmar D2-kontraktsversionen är inte samma sak som ChatGPTs tänkenivå.

## Konkreta fynd i 1.5.3

| Prioritet | Fynd i koden | Ändring |
|---|---|---|
| Kritisk | Inget självständigt krav på avläst modell och resonemangsnivå före utskick. Rate-limit-hantering ersätter inte sådan kontroll. | `safety-policy.js`, `model-observation.js`; avläsning i bakgrund och omedelbart före innehållsskriptets klick. |
| Kritisk | Förbrukningsräkning/budget över workers saknades. | `usage-governor.mjs`; beständig journal, atomisk reservation och ytterligare tillståndskontroll vid faktisk sändning. |
| Hög | Beständiga workers kunde bli osynliga när parade ägarkopplingar i `storage.session` försvann. | `restart-recovery.mjs`; oberoende inventering och unik konversations-/prompthashmatchning, inklusive begränsad 1.5.3-migrering. |
| Hög | Process och kö saknade de nya två checksummade checkpointkopiorna. | `durable-checkpoint.mjs`; stage → readback → publish → readback. Skadad/osammanhängande publikation går till granskning. |
| Hög | Ett tomt transportkvitto kunde behandlas alltför optimistiskt; Enter-fallback gav en ytterligare sändningsväg. | Okänt transportutfall behåller möjlig effekt. Ingen blind Enter-fallback. Exakt prompt krävs för att lösa osäkerhet. |
| Hög | Modellbyte under en pågående tur saknade den nya kvalitetskarantänen. | Kvitto före tur, avläsningar under väntan och kontroll före analys. Upptäckt nedgradering eller gammal tur utan kvitto stoppar vidare användning. |
| Medel | Körstatus blandade antal processer med faktisk kapacitetsbelastning och gav liten hjälp vid väntan. | Översikt med orsaker, korrekt schedulerbelastning, ålder, budget, återställning och händelser. |
| Medel | Långa serier av tekniska fel kunde fortsätta med täta återförsök. | Backoff efter fem fel: 15 minuter, därefter fördubbling upp till sex timmar. |

Ingen ny permanent autentiseringsmekanism, serverintegration, mejlsändning eller automatisk utrullning ingår. Outlook-sökningen efter Greenfield gav inga träffar som kompletterade bilagorna.

## Utskicksgränsen

1. Vänta på startupinventering och ägarverifiering.
2. Kontrollera rätt EIC GPT-rot, godkänt synligt modellnamn, Thinking och miniminivå. UI-beviset måste vara högst 15 sekunder gammalt och får inte ligga mer än en sekund i framtiden.
3. Kontrollera operatörspaus, global kvotspärr, lokal lagring, rullande budget, tempo och frånvaro av främmande manuellt utkast.
4. Reservera förbrukning med idempotent identitet `runId + sessionSeq + turn + promptHash` innan någon möjlig effekt.
5. Spara modellkvitto och PREPARED-dispatch beständigt. En avbruten lagringsskrivning får inte följas av klick.
6. Innehållsskriptet måste åter få tillstånd från den verkliga bakgrundsägaren för exakt flik/dispatch/hash. Den atomiska tillståndskontrollen tillämpar senaste sparade policy och tempo även för fördröjda reservationer.
7. Kontrollera omedelbart igen modellkontrollerna, rätt skrivfält, exakt text och aktiv Skicka-knapp. Inget asynkront steg ligger mellan den sista innehållskontrollen och klicket.
8. Bevara sändningskvittot. Vid oklart utfall får samma dispatch-ID bara återspelas inom samma dokument med idempotenskvittot. Nytt dokument och okänd effekt ger spärr. Ett högre antal användarmeddelanden bevisar inte att just Greenfields prompt skickades.

Detta är försvar mot dubbla utskick vid de hanterade felgränserna. Det är **inte en distribuerad exactly-once-garanti** för ChatGPT eller EIC. Om en servereffekt uppstår och alla observerbara kvitton förloras är stopp ett nödvändigt utfall. EICs verktyg måste själva ha idempotenta owner-operationer och verifierbart readback.

## Modellbevis och begränsningar

Adaptern läser begränsade modell-/tänkenivåkontroller och synliga kvot-/dialogelement. Den ignorerar konversationstext, artiklar och tilläggets egna UI-ytor. Motstridiga kontroller blir okända. Work/Codex, Auto, Instant, mini, Nano, fel version, Standard/Light eller saknad tänkenivå släpper inte igenom.

`VISIBLE_UI_ONLY` är den explicita bevisnivån. Detta gäller varken API-tokenräkning, serverattestering, faktisk reasoning-tokenförbrukning eller en garanti om kontots återstående användning. Ett oförändrat UI kan inte avslöja en osynlig intern serveromkoppling. Korta svar eller Nanos åsikt används inte som bevis för modellens identitet.

Om EIC GPT inte exponerar tillräckliga kontroller i den aktuella ChatGPT-ytan kommer RC1 att hålla arbetet. Det är en verifieringsspärr som kräver anpassning efter observerad live-UI, inte en fallback till svagare kontroll. De aktuella selektorerna har inte validerats mot användarens inloggade EIC-session här.

Godkänd modell är konfigurerbar men explicit. GPT-5.6 är användarens angivna utgångspunkt; ingen verifierad lista över senaste modeller eller abonnemangsspecifika Chat-kvoter har härletts från Work-, Codex- eller API-dokumentation.

## Beständighet och återhämtning

Process, körkö och säkerhetsjournal har två växelvisa SHA-256-kontrollerade snapshots samt en kompatibilitetsnyckel. Läsare i samma service worker väntar på pågående publicering. Senaste giltiga snapshot kan återvinnas, men om någon slot är skadad eller publiceringen inte stämmer blir tillståndet granskningskrävande. Skrivning får då inte tyst börja om från äldre data. Checksummorna skyddar inte mot avsiktlig manipulation av någon som kan ändra både data och checksumma.

Worker-identiteten är beständig i process/kö, medan Chrome-fönster och flik är tillfälliga anknytningar. Återstart kräver att en exakt konversation och tidigare prompthash går att observera. Dubbla matchande flikar, upptagen worker-bindning eller otillräckligt bevis lämnas olösta. Köer utan tidigare process eller bevisad konversation visas som återställningsproblem när deras flyktiga bindning saknas.

Alarm för bevakning, uppdragspaus, köväckning och återställningsscan återskapas. Ingen del förutsätter att en JavaScript-global eller timer överlever service workerns livslängd. Om datorn eller Chrome är avstängd sker ingen körning; nästa start kan återansluta sådant som kan bevisas. Detta är inte filsystem-fsync, fysisk disktolerans eller backup av en raderad Chrome-profil.

Exporterad JSON är en kontrollerbar räddningskopia. Återläsning till en tom installation bevarar lokal förbrukning och råa process/ködata men startar pausat, utan flyktiga ägarlås. Alla importerade processer har en kvarstående granskningsmarkering; alla köer är inaktiverade. Lästa kömallar måste godkännas genom att operatören väljer ett nytt uppdrag efter EIC-avstämning. Import till redan använd installation eller från en skadad export avvisas. En överstor återläsning kan också stoppas av Chromes lagringskvot; den beständiga pausen skrivs först.

## Mätning och driftgränser

- Estimator: `ceil(UTF8_bytes / 3)`, tydligt `exact:false`.
- Budgetbelastning: uppskattad prompt + `max(observerat svar, reserverat svar)`.
- Alla Greenfield-workers i samma installerade tillägg och Chrome-profil delar journal och sändningstempo. Manuella chattar, andra enheter, profiler och parallella installationer ingår inte.
- Journalen behåller rullande användningsposter i sju dygn, högst 10 000 ännu relevanta reservationer. Kontrollhändelser begränsas till 200; UI visar de senaste tio. Detta ersätter inte EICs beständiga kronologi.
- Lokal lagring visas med Chromes rapporterade byteantal. 80 procent ger varning, 90 procent stoppar nya utskick. Misslyckad lagringsskrivning stoppar också tillståndsgivningen.
- Modell-/kvotspärr kan hållas hur länge som helst om nya säkra bevis inte kommer. Det är avsiktligt. Ingen watchdog får tolka detta som tillåtelse att skicka om.

## Testbevis och vad som återstår

Originalets 324 tester kördes och passerade före ändringar. Paketet har nu 407 tester: 83 nya policy-, lagrings-, recovery-, backup-, adapter- och integrationstester plus befintliga regressioner. Integrationstesterna laddar den verkliga `background.js` med simulerade Chrome-gränssnitt. De är inte en installerad browser- eller EIC-testmiljö.

De nya scenarierna omfattar samtidiga anspråk på sista budgetplatsen, veckofönster, klockrollback, slutligt sändningstempo, saknade/för gamla modellbevis, kvotåterhämtning, torn writes, skadade slots, full lagring, kall omstart, äldre uppgraderingsdata, återanvända fönsternummer, dubbla flikar, förlorat/tomt kvitto, manuell text, nedgradering under tur, pausad backupimport och avbruten import.

Syntax kontrollerades för alla 96 JavaScript-/modulfiler. Manifestresurser och panelens 113 unika element-ID:n kontrollerades. Antalen gäller releasekandidaten före eventuella framtida ändringar; `BUILD_VERIFICATION.json` och testutskriften är det maskinläsbara beviset.

Granskningswebbläsarens säkerhetspolicy blockerade lokala provsidor. Inga alternativa vägar runt den spärren användes. Därför återstår faktisk panelrendering, tillgänglighets-/breddkontroll, verifiering av aktuella ChatGPT-selektorer, installerad service-worker-/Chrome-återstart, verklig providerkvot/fallback och minst ett dygns observerad EIC-drift. Följ `START_HERE_SV.md` innan semesterdrift.

## Källor

- Användarens `EIC_Autonom_Agent_Greenfield_v1.5.3(1).zip`, de två bifogade PDF-analyserna och panelbilderna.
- [Chrome extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle): oväntad avslutning och beständig lagring.
- [Chrome storage API](https://developer.chrome.com/docs/extensions/reference/api/storage): sessionens livslängd, lokal lagring och kvoter.
- [Chrome alarms API](https://developer.chrome.com/docs/extensions/reference/api/alarms): alarm kan fördröjas och behöver återskapas.
- [Chrome manifest key](https://developer.chrome.com/docs/extensions/reference/manifest/key): tilläggsidentitet under utveckling. Ingen ny nyckel har lagts in i denna release.

Webbkällorna kontrollerades 8 september 2026. De används för Chrome-kontrakten; de bevisar inte abonnemangets ChatGPT-gränser.
