# Uppdatera Greenfield 1.8.7 → 1.8.8

## Installation

1. Säkerhetskopiera den befintliga tilläggsmappen och spara aktiv kö som kö-set.
2. Gör uppdateringen vid en lämplig arbetsgräns. Avbryt inte ett pågående viktigt svar enbart för denna patch.
3. Packa upp `EIC_Autonom_Agent_Greenfield_v1.8.8.zip` och ersätt innehållet i samma mapp som Chrome redan använder. Behåll samma tillägg och profil; skapa inte en parallell installation som delar arbetskö.
4. I `chrome://extensions`, välj **Läs in igen** och kontrollera att panelen visar **v1.8.8**.
5. Behåll EIC under **Fästa**. Kontrollera först en köplats: rätt EIC-konversation, ett utskick, korrekt svarsfångst och efterföljande kvant/schema.

Detta paket är lokalt testat men inte live-validerat i din inloggade Chrome-session.

## Rättningar

### 1. Aktiv generering skyddas mot den vanliga tidsstegen

När den färska sidobservationen visar både `generating=true` och synlig stoppknapp eller strömningssignal skjuts F5/Ctrl-F5/rotation upp. Enbart upptaget skrivfält eller en obestyrkt `generating`-flagga räcker inte.

Respiten har ett **fast tak på fyra timmar räknat från den kvitterade promptens utskick**. Taket är en återhämtningsbudget i klienten, inte ett löfte om modellens svarstid. En fastnad signal får inte binda köplatsen obegränsat. När signalen upphör eller taket nås återgår klienten till tidsstegen. Ett färdigt, giltigt svar fångas normalt utan omladdning.

Panel/overlay visar **”Generering observerad · maximal respit …”** i stället för en missvisande utgången TTL under respiten. Detta är inte samma sak som uppdragets schemalagda `pauseUntil`.

### 2. Sena återhämtningssteg körs inte i en omladdningsstorm

Grundstegen är fortfarande 30/60/90/120 minuter. Om flera steg redan har förfallit, exempelvis efter en vilande service worker eller genereringsrespit, väntar klienten minst **60 sekunder mellan faktiskt begärda återhämtningssteg**. Räknarna använder samma beräkning.

### 3. En annan aktiv GPT får inte byta köns mål

Vid köstart och rotation prioriteras processens bundna GPT, därefter senast verifierade EIC. En tillfälligt aktiv flik med en annan GPT får inte ersätta detta mål. Första användningen utan någon tidigare bindning behåller möjligheten att välja en anpassad GPT som operatör.

### 4. En omdirigering till startsidan raderar inte trådens återställningsadress

Under en pågående tur sparas den senast verifierade konversationsadressen även om fliken hamnar på GPT-roten. En tom, färdigladdad startsida är inte återhämtning av en saknad konversation. Efter den befintliga 90-sekundersgränsen används den kända konversationsadressen i återhämtningen.

Har en äldre version redan raderat den riktiga adressen kan patchen inte återskapa den ur ingenting. Öppna då den ursprungliga konversationen manuellt och använd befintlig återställning; inga okända effekter skickas blint igen.

## Oförändrat

- Modellkrav, policy för **Pro**, kvalitetskarantän och spärrar mot dubbla/okända utskick.
- Kvant, köordning, prioritetstak, `SET_SCHEDULE` och begränsningen till rätt köplats.
- P0/generalplan, GF-056:s periodiska uppdrag och GF-045:s högst en full GF-056-riskreview per rullande 24 timmar.
- Ingen automatisk ändring av modellväljare, installation eller massväckning av GFW.

## Verifiering

Se `BUILD_VERIFICATION.json`, `verification/v188-release-tests.tap` och `docs/RISKANALYS_FUNKTION_V1_8_8.md`.
Äldre verifieringsfiler i paketet avser sina äldre versioner och ska inte läsas som nya Chrome-resultat.
