# Uppdatera Greenfield 1.8.5 → 1.8.6

1. Säkerhetskopiera den uppackade tilläggsmappen. Spara gärna aktiv kö som kö-set.
2. Packa upp `EIC_Autonom_Agent_Greenfield_v1.8.6.zip` och kopiera innehållet över samma mapp som Chrome redan använder, så att extension-ID och lokal state bevaras.
3. I `chrome://extensions`: välj **Läs in igen**. Panelen ska visa `Greenfield v1.8.6`.
4. Låt Greenfield arbeta vidare med de processer som hänger. Starta inte om dem manuellt.

## Vad som händer med processer som hänger efter uppdateringen

- **Processer med tänknivån "Extra hög" eller "Hög"** i ChatGPT:s modellväljare godkänns nu. Spärren THINKING_MODE_UNVERIFIED släpper, och ett färdigt svar som redan ligger i konversationen tas emot.
- **Processer i WAITING som fortfarande är spärrade**, till exempel en flik som står på en ny chatt med "Direkt", fortsätter i tidsstegen i stället för att vänta för evigt. Stegen är Ctrl-F5 vid 60 och 90 min och köbyte eller ny chatt vid 120 min. Har tiden redan passerat tas ett steg per kontrollrunda, så köbytet kommer inom några minuter. Uppdraget parkeras med sin fortsättning.
- **Kapacitetsplatser** som de spärrade processerna höll frigörs vid köbytet, så att väntande GFW kan skicka.

## Tänknivå i ChatGPT:s nya modellväljare

- ChatGPT visar nu tänknivån som text i modellväljaren ("Välj ChatGPT-modell"), inte längre som kapseln "Djupgående".
- **Extra hög** räknas som högsta nivån (Heavy). **Hög** räknas som Extended och räcker för standardgolvet. Kräver du Heavy under **Körkrav**, godkänns bara Extra hög.
- **Direkt** är ingen tänknivå. Greenfield skickar inte i en chatt som står på Direkt. Välj en tänknivå i väljaren, så släpper spärren inom 30 s.
- Den gamla kapseln "Djupgående" godkänns som tidigare.
