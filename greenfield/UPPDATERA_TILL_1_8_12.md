# Uppdatera Greenfield 1.8.11 → 1.8.12

1. Säkerhetskopiera tilläggsmappen och spara aktiv kö som kö-set.
2. Packa upp `EIC_Autonom_Agent_Greenfield_v1.8.12.zip` och kopiera innehållet över **samma mapp** som Chrome redan använder. Då behålls extension-ID, köerna och fönstrens worker-bindning.
3. I `chrome://extensions`: välj **Läs in igen**. Panelen ska visa `Greenfield v1.8.12`.
4. Ingen reservation finns efter uppdateringen. Allt fungerar som i 1.8.11 tills du reserverar en plats.

## Nytt: reserverad plats för ett prioriterat fönster

Önskemål 2026-09-30: ett Greenfield-fönster med GFW:er som ska gå dygnet runt ska alltid ha en egen plats. Övriga fönster delar på resten.

- **Så väljer du fönstret.** Du kan välja på två sätt:
  - I det fönstrets panel under **Drift → Reserverad plats**: **Reservera en plats för detta fönster**.
  - På valfritt workerkort under **Körstatus**: **Reservera plats**.

  Du tillfrågas först. Bara ett fönster åt gången kan ha platsen; reserverar du ett annat fönster flyttas den dit.
- **Så fungerar det med Max parallella 2 eller fler:**
  - En av platserna är låst för det reserverade fönstret. Den står ledig för det även när fönstret inte kör något just då, och inget annat fönster får använda den.
  - Övriga fönster delar på resten. Med 2 platser får de 1, med 3 får de 2.
  - Varje ny tur i det reserverade fönstret får sin plats direkt; det väntar aldrig på platser bakom andra fönster.
  - Prioritet och åldring gäller som förut mellan de övriga fönstren, men de kan aldrig ta den reserverade platsen.
- **Pågående svar avbryts aldrig.** Reserverar du medan andra fönster redan har alla platser, får det reserverade fönstret nästa plats som blir ledig. Ett annat fönster som väntar får den inte.
- **Max parallella = 1:** reservationen sparas men gäller inte, eftersom det enda fönstret annars skulle stänga ute alla andra. Panelen visar ”gäller vid Max parallella ≥ 2”.
- **När ChatGPT begränsar trafiken** och Greenfield själv går ned till 1 plats (seriell återhämtning) går det reserverade fönstret först, men platsen är inte låst. Under nedkylning (0 platser) skickar inget fönster.
- **Visning:**
  - Workerkortet för det reserverade fönstret har märket **Reserverad plats**.
  - Raden med platser säger ”1 plats reserverad”.
  - **Drift → Reserverad plats** visar vilket fönster som har platsen och hur många de övriga delar på.
- **Ta bort:** **Ta bort reservationen** i det fönstrets panel, eller **Släpp reserverad plats** på dess kort.

## Gränser

- Platsen följer fönstrets Greenfield-bindning (worker), inte Chrome:s fönsternummer. Efter omstart av Chrome följer den med när Greenfield återställer fönstrets bindning. Ett helt nytt fönster har en ny bindning och är inte reserverat.
- Stänger du det reserverade fönstret för gott står platsen låst tills du tar bort reservationen. Det syns i panelen: ”Det reserverade fönstret kör inget just nu”.
- **Utskickstakten** gäller fortfarande alla fönster: minsta tid mellan prompter i Körkrav och pausen mellan analys och post. Det reserverade fönstret kan därför behöva vänta en taktlucka per annat fönster som skickar samtidigt, alltså högst Max parallella − 1 luckor. Det följer av koden och är inte uppmätt live. Takten är en säkerhetsregel och har inte ändrats.
- Live-Chrome är inte verifierat i denna leverans.
