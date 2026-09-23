# Greenfield 1.7.6 – börja här

Greenfield 1.7.6 behåller den deterministiska Uppdragskön och 1.7.5:s autonoma lagringsretention men gör fresh project owner-state / `current_focus` reconciliation till en explicit A2A-invariant. `current_focus` är en restart/steering pointer, inte factual owner; nyare exakt owner-evidence vinner, stale focus får inte replaya completed effects och focus skrivs bara efter material steering/restart delta.



## Owner-state/current_focus i 1.7.6

- Före första bounded work package ska färsk subject-project owner-state läsas.
- Project-bound arbete ska läsa och reconcile `project.current_focus`.
- `current_focus` behandlas som `STEERING_POINTER_NOT_FACT_OWNER`.
- Nyare exakt owner-evidence styr vid konflikt.
- Focus skrivs bara efter material steering/restart delta och write kräver owner readback.
- Om metadata-write är unavailable ska restart pointer bevaras via annan korrekt durable owner/chronology-route, felet routas till sin owner och unrelated safe work fortsätta utan blind retry.
- Completed objectives/effects får inte replayas på grund av stale focus.
- Exakt effect target/owner revalideras före material effect.
- Före pause/yield/block/done/handoff persisteras material mission state; focus ändras bara vid material restart delta.

## Autonom lagring från 1.7.5

- Vid 80 % av den nominella lokala lagringsgränsen startar automatisk retention.
- Målet är 70 % efter städning.
- Äldre checksummade checkpointslotar kompakteras först.
- Om mer utrymme behövs raderas de äldsta workerpaketen som **inte** är live-bundna i `chrome.storage.session`.
- Live-bundna workers raderas inte av retentionen.
- 90 % är inte längre en dispatchspärr.
- `unlimitedStorage` finns som kvotbuffert så att Greenfield kan städa även en redan full profil.

## Köprincipen från 1.7.4

1. `order` är den styrande ordningen inne i en Greenfield-worker; prioritet får inte hoppa över köplatser.
2. Efter sista körbara köplatsen wrappar kön till första körbara plats och fortsätter så länge kön är aktiverad.
3. `maxInteractions` är per köplats. En full kvant nollställer just den platsens kvantmätare inför nästa varv.
4. Tidig `YIELD_TO_QUEUE`, queue-local `PAUSE_PROCESS`/`BACKGROUND_SLEEP` eller temporär BLOCKED bevarar ofärdig kvantprogress i den platsen.
5. Samma `savedMissionId` kan finnas i flera slots. Varje slot har eget `itemId`, `order`, `priority`, `maxInteractions` och kvantprogress, men de delar senaste logiska mission-checkpoint/resume.
6. `PAUSE_PROCESS`/`BACKGROUND_SLEEP` pausar alla duplicate slots för samma sparade GFW och låter nästa annan runnable slot gå vidare; om ingen annan finns används vanlig processpause.
7. `DONE` eller `STOP_PROCESS` avslutar den logiska sparade GFW:n och tar bort alla dess duplicate slots, så den inte startas om av ett senare varv.
8. Slot-prioritet används av den profilglobala kapacitetsschedulern när slotten är aktiv; den påverkar inte inner-queue order.
9. Varje genererad queue-prompt visar kvantläget (`Hög · 1 interaktioner/kvant · 0/1 slutförda i kvanten`) och ett planningHint så EIC kan dimensionera just den promptens arbetspaket.
10. Greenfield anger ungefärlig response-roundtrip och efter återkomst ungefärlig loop-roundtrip för samma köplats.
11. EIC kan begära `greenfieldStatusRequest=FULL_NEXT_PROMPT`; nästa prompt för samma GFW innehåller ett bounded full process-statusobjekt utöver standardinformationen.
12. `CONTINUE + BACKGROUND_SLEEP` är alltid park/schedule, aldrig Klart/avslutad. Endast `DONE`/`STOP_PROCESS` avslutar den logiska GFW:n.

## Bevarad språk- och evidenceprincip

1. Greenfields interna A2A-, Nano- och Hjalmar-kontrollspråk är engelska.
2. Browser/UI/operator/source-evidence får samtidigt vara en kontinuerlig blandning av engelska, svenska och finska.
3. Råa labels bevaras på originalspråk.
4. Strukturell control-identitet och lokal språk-/fraskontext kommer före lexikal effort-ranking.
5. En mixed-language parsing-ambiguitet är inte i sig bevis på att modellen eller tänknivån faktiskt har ändrats.
6. Heavy/Max-krav fortsätter fail-closed när verklig effort inte kan etableras.

## Modellkontrollen

- Den breda globala `button[aria-label*='Djup' i]`-matchningen är borttagen.
- Composer-lokala effort-kontroller prioriteras när de finns.
- Svenska `nåla fast`/`fäst fast` skyddas från engelsk Fast-tolkning.
- Bounded finska termer för modell-/reasoning-UI stöds.
- Diagnostiken anger `effortEvidenceSource` så att en operator kan se om beviset kom från `COMPOSER_SELECTED_CONTROL` eller en svagare strukturell fallback.

## Installation över 1.7.5

1. Pausa nya Greenfield-utskick.
2. Säkerhetskopiera den uppackade tilläggsmappen.
3. Packa upp `EIC_Autonom_Agent_Greenfield_v1.7.6.zip`.
4. Kopiera innehållet över samma mapp som Chrome redan använder så extension-ID/lokal state bevaras.
5. I `chrome://extensions`, välj **Läs in igen**.
6. Verifiera att panelen visar `v1.7.6`.
7. Återgå till den exakta EIC-konversation som hör till workern.
8. Kör **Kontrollera modell igen** och exportera diagnostik om safety-hold kvarstår.
9. Låt Greenfield reconcilea befintlig process-state; gör inget manuellt omskick av en dispatch med okänd effekt.

## Riktad liveacceptans

- Spara gärna den aktiva kön som ett kö-set innan extension-reload. Om du kopierar 1.7.6 över samma unpacked Chrome-mapp bevaras normalt samma extension-ID/lokal state; ett helt nytt unpacked extension-ID ska inte antas ärva aktiv runtime-kö.
- Starta minst två olika GFW-slots med olika prioritet och verifiera att **listordningen**, inte prioriteten, avgör nästa slot.
- Sätt en slot till kvant 2 och verifiera `0/2 → 1/2 → byte`, därefter att samma slot vid nästa fulla varv börjar på `0/2`.
- Avbryt en större kvant tidigt via en kökontroll och verifiera att dess ofärdiga kvant fortsätter från tidigare tal när slotten kommer tillbaka.
- Lägg samma sparade GFW två gånger på olika platser med olika prioritet/kvant och verifiera att båda slots visas och körs i respektive position utan att missionen startas om från början.
- Med `Djupgående` valt ska en samtidig `Djupanalys`/pin-kontroll inte skapa `ambiguous=true`.
- Diagnostics bör visa `effortLabel="Djupgående"` och, när composer-kontrollen kan bindas, `effortEvidenceSource="COMPOSER_SELECTED_CONTROL"`.
- Kör minst en autonom continuation efter att fresh modelproof godkänts.
- Bekräfta att tidigare multi-turn-liveness fortfarande fungerar.

Lokal paketverifiering kan verifiera koden och regressionerna. Den ersätter inte live Chrome/ChatGPT-acceptans.
