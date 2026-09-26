# Uppdatera Greenfield 1.8.6 → 1.8.7

1. Säkerhetskopiera den uppackade tilläggsmappen. Spara gärna aktiv kö som kö-set.
2. Packa upp `EIC_Autonom_Agent_Greenfield_v1.8.7.zip` och kopiera innehållet över samma mapp som Chrome redan använder, så att extension-ID och lokal state bevaras.
3. I `chrome://extensions`: välj **Läs in igen**. Panelen ska visa `Greenfield v1.8.7`.
4. Se till att **EIC ligger under Fästa** i ChatGPT:s sidofält. Greenfield väljer EIC där om en GPT-adress öppnar standardchatten.
5. Starta kön som vanligt, gärna från ChatGPT:s startsida.

## Vad som ändras

- **Köstart och ny chatt landar i EIC.** I ChatGPT:s nya gränssnitt kunde köstarten öppna standardchatten (`chatgpt.com/`) och fastna där med spärren `EIC_SURFACE_UNVERIFIED`. Greenfield går nu alltid till den senast verifierade EIC-adressen. Visar ChatGPT ändå standardchatten prövas först adressen utan namn (`/g/g-<id>`) och sedan ett klick på EIC under **Fästa**. Ingen prompt skickas förrän sidan visar EIC.
- **EIC känns igen utan namnet i adressen.** Nya konversationsadresser saknar `-eic` (`/g/g-<id>/c/…`). Samma GPT-id räknas nu som samma GPT.
- **EIC på startsidan.** När EIC är vald vid `chatgpt.com/` godtas EIC-pillret i skrivfältet och rubriken "EIC" som bevis. En annan GPT, ingen GPT eller två olika namn spärras som tidigare.
- **Ny väntetext.** "Våra system bearbetar den här **begäran** lite till innan de svarar." och rubriken ovanför (t.ex. "Planerade åtkomst") fångas aldrig som svar.

## Nya meddelanden

| Kod | Betydelse | Gör så här |
|---|---|---|
| `EIC_GPT_ROOT_UNKNOWN` | Greenfield har ingen verifierad EIC-adress (köstarten avbryts i stället för att öppna standardchatten) | Öppna en EIC-konversation en gång (adress `/g/…`), starta sedan kön igen |
| `SESSION_ROTATION_EIC_NOT_SELECTED` | EIC kunde inte väljas i den nya chatten inom 2 min | Fäst EIC i sidofältet eller välj EIC för hand. Köplatsen försöker igen efter pausen. |

## Obs: "Pro" i modellväljaren

Står modellväljaren på **Pro** spärras utskick som `THINKING_MODE_UNVERIFIED`, precis som i 1.8.6. Det är ett policybeslut om "Pro" ska räknas som godkänd tänknivå, och det har inte ändrats. Välj "Extra hög" eller "Hög" för att köra nu. Se [docs/RISKANALYS_FUNKTION_V1_8_7.md](docs/RISKANALYS_FUNKTION_V1_8_7.md).
