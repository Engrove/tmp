# Greenfield 1.9.17 – EIC Entry Bootstrap

## Reproducerad orsak

`activateQueueItem` behövde en GPT-rot från aktuell URL, tidigare process eller
`lastKnownGoodEicUrl`. Utan sådan rot användes `planEicRootDiscovery`, som kräver
både GPT-namn och äldre GPT-konversationslänkar i sidofältet. Tom historik gav
`EIC_GPT_ROOT_UNKNOWN`, även när operatören redan hade valt EIC vid `/`.

Operatörens första bild visar EIC vid `chatgpt.com` och felmeddelandet. Den andra
visar samma GPT-id i `/g/.../c/...` efter ett manuellt meddelande. Samma GPT-rot
finns i diagnostikfilen från 2026-10-14. Bilderna är inte en DOM-capture och
bevisar inte att varje CSS-/ARIA-selector fortfarande motsvarar liveklienten.

## Ändrat

- `managed-eic-surface.mjs`: validerad, sparbar `configuredEicUrl`; separat
  `entryUrl`/`entrySource`; belagd EIC-standard vid tom cache. Ingen observerad
  identitet, tidsstämpel eller säkerhetsattest fabriceras för standardadressen.
- Konfigurations- och observationsskrivningar serialiseras. Observation av en
  annan GPT kan inte radera det manuella adressvalet.
- `background.js`: start, rotation, återhämtning, modellinspektion och WMT-start
  använder samma valda startadress. Köpostens egen GPT-bindning går först. En
  annan föregående köpost får inte blockera ett nytt manuellt adressval.
- En separat panelauktoriserad sparåtgärd ändrar bara konfiguration; den navigerar
  inte, skickar inget meddelande och startar inte en kö.
- `sidepanel.html`/`.js`: redigerbar och sparbar startadress under Drift, med
  källangivelse och skydd mot att uppdateringar skriver över ett pågående utkast.
- `operations-view.mjs`: fel hänvisar till den nya inställningen.
- Versionsmarkörer: 1.9.17. Ny regression: `tests/eic-entry.test.mjs`.

## Bevarat och avgränsat

A2A-schema, owner-progress-kontrakt, Chrome-behörigheter, GPT-/modellkontroller,
turn-parning, rotationsgränsen 3/15, slotkvantum, UNKNOWN-rekonciliering och
frusen owner-root är oförändrade. Standardadressen är en distributionsinställning
för denna EIC, inte ett antagande om vilken GPT en godtycklig sida visar.

Den äldre historikbaserade upptäckten finns kvar som reserv vid oläsbar
startadress. Ingen extra testprompt, intern ChatGPT-API-anropning eller
sökning i privata konversationstexter har lagts till.

Se `../verification/1.9.17/VERIFIERING.md` för verkliga testresultat, negativ
kontroll, simuleringarnas gränser och kvarstående driftverifiering.
# Komplettering: Initialization ACK

- Ersätt exakt `READY` med unik, kontextbunden 64-teckens kvittenshash.
- Tillåt omgivande text/Markdown/footer utan att försvaga svarstur-,
  konversations-, ägar- eller stabilitetskontroller.
- Uppgradera redan besvarad äldre initiering en gång i samma konversation;
  bevara hela osända uppdragsprompten, mission, köpost, kvantum och session.
- Saknad hash i färdigt svar ger explicit kvittensväntan och släpper kapacitet.
  Oförändrad evidens skickar inga nya promptar och triggar ingen stale-rotation.
- Fixera uppdragskortens ordning och avvisa försenade gamla panelhämtningar.
- Förtydliga att observationstid är en ålder, inte en kö-/avläsningsräknare.

Se `../verification/1.9.17-ack/` för exakt källa, tester och begränsningar.
Den tidigare v1.9.17-byggnaden bevaras separat som spårbar bas.

---

