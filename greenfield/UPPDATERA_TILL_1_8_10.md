# Uppdatera Greenfield 1.8.9 → 1.8.10

1. Säkerhetskopiera tilläggsmappen och spara aktiv kö som kö-set.
2. Packa upp `EIC_Autonom_Agent_Greenfield_v1.8.10.zip` och kopiera innehållet över **samma mapp** som Chrome redan använder. Då behålls extension-ID, kön och den sparade EIC-adressen.
3. I `chrome://extensions`: välj **Läs in igen**. Panelen ska visa `Greenfield v1.8.10`.
4. Du behöver inte ladda om ChatGPT-fliken. Efter **Läs in igen** saknar fliken Greenfields sidbrygga. Greenfields återhämtning börjar då med att ladda in den nya bryggan i fliken (steget `REINJECT_BRIDGE`). En gammal brygga med fel version byts på samma sätt. Du kan också trycka F5 i fliken. Det skickar ingenting om.

## Varför Greenfield inte förstod att prompten skickats (rapport 2026-09-26, v1.8.9)

- **Diagnostiken 09:38 och 09:40:** processen stod i SENDING. Sändningen var registrerad som `EFFECT_POSSIBLE`, men `acknowledged` var false, evidens saknades och ingen användartur var registrerad. Spärren `DISPATCH_EFFECT_UNRESOLVED` (Oklart om prompten skickades – inget omskick) prövades om var 30:e sekund, trots att ChatGPT visade prompten och ett färdigt svar.
- **Orsak:** ChatGPT:s nya gränssnitt märker inte längre meddelanden med `data-message-author-role`, `data-message-id` eller `data-turn-id`, och har ingen `stop-button`. Det har kontrollerats i den ChatGPT-kod som din flik laddade (build `4da31bb4`): ingen av markörerna förekommer. Greenfield räknade därför alltid 0 användarturer och 0 svar och kunde aldrig koppla prompten till en tur.

## Vad som ändras

- **Meddelanden i det nya gränssnittet känns igen**, enligt ChatGPT:s egen kod:
  - Användarmeddelandet är blocket `group/user-message` efter rubriken "Du sa:". Id:t (`data-chatgpt-search-message-ids`) kommer först när ChatGPT har sparat meddelandet.
  - Svaret är blocket med rubriken "ChatGPT sa:". Rubriken och tidsstämpeln tas bort ur den fångade texten.
- **Kvittot väntar på meddelandets id.** Sändningen kvitteras när användarturen syns med id. Det sker inom samma 15 s som tidigare.
- **"Stoppa"** (knappen i skrivfältet medan svaret skrivs) räknas som pågående generering.
- **Daybreak:** text som nämner Daybreak inuti ett meddelande tolkas inte som ChatGPT:s spärrnotis. I v1.8.9 kunde det hända i det nya gränssnittet. Den riktiga notisen ("Det här innehållet kan inte visas … Daybreak") ligger bredvid användarmeddelandet och upptäcks som tidigare.
- **Ingen ändring i background:** en process som redan står i `DISPATCH_EFFECT_UNRESOLVED` går vidare till WAITING vid nästa omprövning, när den nya bryggan ser användarturen. Ingenting skickas om.

## Om det ändå fastnar

Exportera diagnostiken direkt och skicka den. Följande säger vad som hände:

- `pendingPrompt.dispatch`: `acknowledgementEvidence` och `materializedUserTurnId`.
- `safety.hold`: `detail`.
