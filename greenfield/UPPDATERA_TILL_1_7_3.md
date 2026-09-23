# Uppdatera Greenfield till 1.7.3

Version 1.7.3 rättar den falska modell-/tänknivåspaus där svensk ChatGPT-UI kunde tolkas med engelsk betydelse.

## Vad som ändras

- Den globala `aria-label*="Djup"`-selektorn tas bort.
- Den aktiva composer-kontrollen prioriteras över svagare dokumentglobala reasoning-kandidater.
- Svenska `nåla fast`/`fäst fast` får inte tolkas som engelska reasoning-läget `Fast`.
- Finska modell-/reasoningord får ett explicit bounded basstöd.
- Greenfields interna A2A, Nano och Mental-Hjalmar-kontrollspråk är engelska.
- A2A bär ett explicit `languageContext`: engelska, svenska och finska förväntas kunna förekomma samtidigt; rå evidence bevaras på originalspråk.

## Installation över 1.7.2

1. Pausa nya Greenfield-utskick.
2. Säkerhetskopiera den uppackade tilläggsmappen.
3. Packa upp `EIC_Autonom_Agent_Greenfield_v1.7.3.zip`.
4. Kopiera innehållet över samma mapp som Chrome redan använder så extension-ID och lokal state bevaras.
5. I `chrome://extensions`, välj **Läs in igen**.
6. Verifiera att panelen visar `v1.7.3`.
7. Återgå till den exakta EIC-konversation som hör till workern.
8. Tryck **Kontrollera modell igen**. En tidigare `THINKING_EFFORT_UNKNOWN` får endast släppa när den färska v1.7.3-observationen faktiskt ger ett tillåtet proof.
9. Låt processen fortsätta från sin sparade state; gör inget manuellt omskick av en dispatch med okänd effekt.

## Liveacceptans

Minsta riktade test efter installation:

- Låt ChatGPT-UI visa `Djupgående`.
- Om `Djupanalys`/pin-kontroller också finns i sidan ska de inte skapa en falsk effort-konflikt.
- Exportera diagnostik och kontrollera att `effortLabel` är `Djupgående`, `ambiguous=false` och att `effortEvidenceSource` helst är `COMPOSER_SELECTED_CONTROL`.
- Verifiera därefter minst en autonom continuation-turn.
- Kontrollera att äldre v1.7.2 multi-turn-funktion fortsätter utan regression.

Lokal source/package-verifiering ersätter inte live Chrome/ChatGPT-acceptans.
