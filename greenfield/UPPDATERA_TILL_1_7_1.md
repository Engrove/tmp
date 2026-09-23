# Uppdatera Greenfield till 1.7.1

## Syfte

1.7.1 rättar ett exact-once/liveness-fel i 1.7.0 där en dispatch kunde vara `ACKNOWLEDGED` och ha ett färdigt assistantsvar i ChatGPT men ändå fastna i `SENDING` eftersom den renderade user-text-hashen inte var identisk med prompt-hashen.

## Vad som ändras

- Materialiserad browser-user-turn får ett separat, dynamiskt receipt med turn-ID och ordinal.
- Service worker verifierar receipt mot rätt worker/flik/document/dispatch/prompt före persistens.
- `SENDING` använder turn-ID eller verifierad persistent ordinal som kausal identitet.
- Renderad text-hash är inte absolut gate när starkare turn-identitet finns.
- Exakt turn-ID-mismatch blockeras även om text-hashen skulle råka matcha.
- Acknowledged 1.7.0-dispatcher kan använda sitt persistenta `baselineUserCount` som förväntad ordinal efter uppgradering.
- Okänd dispatch-effekt får **inte** använda baseline-ordinal som bevis.
- Restart recovery använder exakt konversation + turn-identitet/ordinal och behåller endast hash som legacy-fallback.
- En stale `CONVERSATION_TAB_NOT_RESTORED`-rad reconcileras bort när processens live-observation verifierar exakt samma konversation; tvetydiga recoveryfall ligger kvar.
- `BACKGROUND_SLEEP`-köpolicyn är oförändrad: efter lyckad analys ska aktuellt köuppdrag parkeras och nästa `READY`-uppdrag kunna aktiveras.

## Installation

1. Pausa nya Greenfield-utskick.
2. Säkerhetskopiera den nuvarande uppackade tilläggsmappen.
3. Packa upp `EIC_Autonom_Agent_Greenfield_v1.7.1.zip`.
4. Kopiera innehållet över samma mapp som Chrome redan använder.
5. I `chrome://extensions`, välj **Läs in igen**.
6. Kontrollera version **1.7.1** och oförändrat extension-ID.
7. Återgå till rätt EIC-konversation.
8. Kör recovery-scan om panelen visar att worker behöver återställning.

## Liveacceptans för GF-045 → GF-007

Efter uppgradering:

- GF-045 ska inte längre ligga kvar i `SENDING` enbart på grund av skillnad mellan dispatch-hash och renderad user-text-hash.
- Om den persistenta dispatchen kan bindas till rätt materialiserad user turn ska det redan färdiga assistantsvaret kunna nå `WAITING/ANALYZING`.
- Om svaret anger `BACKGROUND_SLEEP` och uppdraget är köhanterat ska GF-045 parkeras enligt köpolicyn och workern bli tillgänglig för nästa `READY`-uppdrag, t.ex. GF-007.
- Om turn-identiteten är tvetydig eller faktiskt motsägande ska Greenfield fortfarande fail-closed och inte skicka prompten igen.

## Verifieringsgräns

Byggtester och replay av den bifogade 1.7.0-auditen bevisar kodvägen och det observerade gamla felet. De bevisar inte att den lokala Chrome-checkpointen överlevt uppgraderingen eller att 1.7.1 redan har körts live i din profil.
