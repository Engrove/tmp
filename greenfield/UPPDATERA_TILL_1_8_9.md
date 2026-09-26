# Uppdatera Greenfield 1.8.8 → 1.8.9

1. Säkerhetskopiera tilläggsmappen och spara aktiv kö som kö-set.
2. Packa upp `EIC_Autonom_Agent_Greenfield_v1.8.9.zip` och kopiera innehållet över **samma mapp** som Chrome redan använder. Då behålls extension-ID, kön och den sparade EIC-adressen.
3. I `chrome://extensions`: välj **Läs in igen**. Panelen ska visa `Greenfield v1.8.9`.
4. Håll **EIC fäst** i ChatGPT:s sidofält. Välj EIC på startsidan och tryck **Starta arbetskö**.

## Varför kön stoppades direkt (rapport 2026-09-26, v1.8.8)

- **Kön startade aldrig.** Diagnostiken 09:03 visar fliken på `chatgpt.com/` med EIC vald, alla köplatser READY med `activationCount 0`, ingen process och ingen förbrukningspost (`eic.gf.safety.v1` saknas). Lagringen var alltså ny, till exempel efter en installation i en ny mapp, och Greenfield hade ingen sparad EIC-adress.
- **ChatGPT:s nya startsida visar vald GPT utan id i adressen.** Utan sparad adress stoppade v1.8.7 och v1.8.8 därför köstarten med `EIC_GPT_ROOT_UNKNOWN`.
- **Orsaken syntes inte.** Felet skrevs i statusraden på fliken **Drift** och skrevs sedan direkt över med "Ingen aktiv process …". På fliken **Uppdragskö**, där kön startas, visades ingenting.

## Vad som ändras

- **Köstarten hittar EIC:s adress själv.** Om ingen adress är sparad och startsidan visar EIC (pillret i skrivfältet och rubriken är samma namn) öppnar Greenfield högst tre GPT-konversationer från sidofältets **Senaste**.
  - Den konversation vars adress har GPT-id och vars sida visar namnet **EIC** binder adressen.
  - Adressen sparas, och därefter startar kön i en ny EIC-chatt som vanligt.
  - Ingen prompt skickas förrän adressen är bunden.
  - Visar ingen kandidat EIC stoppas kön med `EIC_GPT_ROOT_UNKNOWN`, i stället för att blockera köplats efter köplats.
- **Startfel syns** direkt under **Starta/Stoppa arbetskö** och i statusraden, tills nästa start lyckas.
- **"Pro" i modellväljaren godkänns som högsta tänknivå** (Heavy), enligt ditt beslut 2026-09-26. Både standardgolvet och ett Heavy-golv godtar det.

## Om kön ändå inte startar

Läs raden under knapparna.

| Text | Gör så här |
|---|---|
| "EIC-adressen kunde inte fastställas …" | Välj EIC under **Fästa** på startsidan så att pillret "EIC" syns i skrivfältet, eller öppna en EIC-konversation. Starta sedan igen. |
| "Chrome local LanguageModel saknas …" | Chrome:s lokala modell (Nano) saknas. Det är en Chrome-inställning, inte köns fel. |
