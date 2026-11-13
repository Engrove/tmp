---
title: "Registerpost enligt GDPR art. 30 – PresenceLock"
status: "UTKAST"
---

# Registerpost (GDPR art. 30.1): automatisk skärmlåsning, PresenceLock

| Fält (art. 30.1) | Innehåll |
|---|---|
| Personuppgiftsansvarig | [[Oy El-Ho Ab – VERIFIERA]], [[kontakt]]. Dataskyddsombud: [[om sådant finns]] |
| Behandling | Automatisk låsning av arbetsstationer när användaren lämnat dem (PresenceLock) |
| Ändamål (a) | Informationssäkerhet: förhindra obehörig åtkomst via obevakade datorer. Åtkomsthantering och grundläggande säkerhetspraxis (cybersäkerhetslagen 124/2025 9 §, där den gäller). **Inte** uppföljning av arbetstid, närvaro eller prestation |
| Rättslig grund | Art. 6.1 f, berättigat intresse (se intresseavvägningen). Eventuellt art. 6.1 c där cybersäkerhetslagen gäller (**VERIFIERA**) |
| Kategorier av registrerade (c) | Anställda och andra användare av Elhos arbetsstationer (konsulter, praktikanter) |
| Kategorier av personuppgifter (c) | Windows-kontots SID och datornamn; inlärd modell (vikter, räknare, utfall); tystnadsprofil (räknare); vanejournal (start och längd av inaktiva perioder, 42 dygn); pausintervall (24 h); teknisk logg; händelseloggposter (pauser, säkerhetshändelser, låsbegäranden och bekräftelser); hjärtslag (senaste svarstid och processnummer, skrivs över). Insamlad kopia (valfri): utan SID, datornamn och livscykeltider, men identifierbar genom filnamnet. **Inga** särskilda kategorier (art. 9). Inget innehåll, inga tangenttryckningar, inga fönstertitlar, ingen kamerabild och inget ljud |
| Mottagare (d) | IT-administratörer. [[SIEM / extern leverantör om händelseloggen skickas vidare]] |
| Överföring till tredje land (e) | Ingen |
| Lagringstider (f) | Vanejournal 42 dygn; pauser 24 h; teknisk logg 30 dygn; skyddad kopia 180 dygn efter senaste inloggning; insamlad modell 90 dygn; profil så länge användaren använder datorn; händelselogg enligt Windows inställning [[ ]]. Rensning sker automatiskt var 24:e timme (programmets städtjänst) |
| Säkerhetsåtgärder (g, art. 32) | Lokal lagring i användarens profilmapp (Windows behörigheter); i NIS2-läge en skyddad kopia som användaren inte kan skriva; fasta storleksgränser och automatisk rensning; inget innehåll samlas in; insamlad kopia utan aktivitetstider; revisionslogg för pauser och säkerhetshändelser |
| Konsekvensbedömning | [[Datum / referens till DPIA]] |
| Samarbete med personalen | [[Datum / protokoll enligt 759/2004 21 § och samarbetslagen]] |
| Systemägare | Jan-Eric Enlund, Elho |
