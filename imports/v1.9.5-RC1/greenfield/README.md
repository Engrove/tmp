# EIC Autonom Agent Greenfield 1.9.5 RC1

Installationskandidat, 2026-10-09. Lokalt verifierad kod; verklig Chrome/ChatGPT-drift återstår.

Se `UPPDATERA_TILL_1_9_5.md` för uppdatering, bevarande av befintlig installation och en kort driftkontroll.

Denna version samlar rättelser för kontrollbeslut, paus, köåterstart, operatörsinstruktioner, delegation, promptstorlek, transport och den redigerbara launchern. Den återhämtar också avbruten terminalpublicering för de två redan klassificerade legacy-fallen: lokal rådgivande blocker och osänd kall sessionsrotation med passerad deadline. Generell BLOCKED-återstart är fortsatt spärrad när ägarvillkor eller utskickseffekt saknar bevis.

- En uppdragspaus gäller uppdraget och dess dubbletter i samma kö. Andra körbara uppdrag får fortsätta. Utan alternativ väntar arbetsfönstret. Pausa nya utskick är globalt.
- En ny eller kall appstyrd session får ett separat litet initieringsping före arbetsuppdraget.
- Förlorad konversation och leveranstimeout behandlas utifrån aktuellt sidtillstånd. Fortsättningsförsök återspelar inte hela arbetsuppdraget.
- Sparade uppdrag får redigerbara identitetsfält och instruktion med en standard för nya uppdrag. Befintlig fulltext bevaras.
- GF-n.z.xxxx stöds som ett helt ID. Inga registerändringar eller ID-tilldelningar ingår.

Manifest, content bridge, panel och runtime använder version 1.9.5. Versionsnamnet RC1 markerar kvarvarande liveverifiering. V1.9.4 används inte för denna kandidat eftersom äldre separata paket redan har använt det numret.

Utvecklings- och fortsättningspaketet innehåller alla källor och historiska bevis. Aktuell kontrollpunkt är `steps/R7A`, inte äldre INTEGRITY.json, BUILD_VERIFICATION.json eller fyndlistor under source/verification. Installationspaketet innehåller enbart runtimefiler och dessa aktuella instruktioner.
