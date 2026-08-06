# EIC Autonom Agent v0.9.0 — changelog

## Mission Control

- Fem vyer: Körning, Webbytor, Evidens, Uppdrag och Inställningar.
- Mission-domän, slutet mode-register och stängd tillståndsmaskin.
- Befintliga kontinuitets-, NEW_SESSION-, ARCHAEOLOGY_LONG- och APP_AUDIT_LONG-flöden
  körs som Mission modes via en explicit legacy-adapter.

## Webbytor och browserprofil

- Separata roller `CHATGPT_CONTROLLER` och `WEB_TARGET`.
- Stabil surface-identitet med dokumentepoch och fail-closed tabblivscykel.
- Gemensam källkod ger separata STANDARD- och BROWSER-paket.
- Browserprofilen använder explicit originbehörighet och bounded CDP.

## Evidens och actions

- Redigerad och kvoterad AX/DOM-, screenshot-, console-, network- och navigationsevidens.
- Strikta `EIC_BROWSER_ACTION/1` och `EIC_BROWSER_OBSERVATION/1`.
- Fast actionregister och exakt en verifierad browseråtgärd per komplett AI-svar.
- Ingen godtycklig JavaScript-exekvering, cookie-write eller request mutation.

## Risk och recovery

- Målwebbens innehåll har instruction authority `NONE`.
- Externa effekter kräver exakt, single-use operatörsgodkännande.
- Autentisering, CAPTCHA, betalning, secrets och destruktiva kontoåtgärder är human-only.
- Navigation, reload, tab replacement, service-worker-förlust och debugger-detach pausar
  browserloopen och kräver verifierad recovery utan action-replay.
- Import återställer aldrig liveauktoritet; rollback är digestbundet och single-use.

## UI

- Focus Mode är UI-only.
- Responsiva 700/620/420-brytpunkter.
- Tangentbordsfokus, skip link, reduced-motion och forced-colors.
- Approval-, recovery- och boundaryytor döljs aldrig.

## Version

Alla aktiva applikations-, manifest-, bridge- och UI-versioner är synkroniserade till `0.9.0`.
