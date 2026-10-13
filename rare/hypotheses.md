# G2/G4 – hypoteser

| ID | Konjunktion och mekanism | Falsifierande förutsägelse / experiment | Status |
|---|---|---|---|
| H301 | ChatGPT:s nya modellmeny exponerar **en** annons "Extra hög, 4 av 4." i **två icke-nästlade noder** (textnoden + `Prestanda` via `aria-describedby` [a] eller ett `aria-label`-element [b]) ∧ `ordinalControls` räknar varje nod som egen kontroll → `ordinal.length>1` → `THINKING_CONTROL_AMBIGUOUS` → `holdForSafety` | Fältets DOM-modell med en enda exponering ska ge AMBIGUOUS. Experiment: rigg med varianterna `describedby`/`arialabel`/`plain`. | **LEVER, bevisad**. `plain` 0/10 fel, `describedby` och `arialabel` 10/10 fel; signaturen är identisk med fältet. [E306, E307, E308] |
| H302 | Menyn innehåller två *verkligt olika* nivåkontroller, alltså är tvetydigheten äkta | Annonsens text ska förekomma två gånger, eller fler än en icke-modellkontroll ska finnas | **FALSIFIERAD**. Popuptexten innehåller exakt en "N av M", och den enda icke-modellkontrollen är `Prestanda`. [E302] |
| H303 | Global spärr (kapacitet, kvot, admission-paus, providerHold, prompt-gate, schema) håller kvar processen | Någon global spärr är aktiv i diagnostiken | **FALSIFIERAD**. Alla är inaktiva. [E311] Panelens "PAUS 1" är skyddsspärren. [E313] |
| H304 | *Utanför egen kod:* Chrome kör en äldre kodgeneration (som H201 i 1.9.12) | Diagnostiken visar en annan version än 1.9.12 eller adapter ≠ 8 | **FALSIFIERAD**. [E312] |
| H305 | Den första spärren `THINKING_CONTROL_UNAVAILABLE` (PREFLIGHT) omprövas aldrig | Ingen senare kontroll når SELECT_MAXIMUM | **FALSIFIERAD**. Båda starterna gick vidare till `SELECT_MAXIMUM` med `priorCode UNAVAILABLE`. [E303] |
| H306 | Upprepningsskyddet (`failedAttempt` + `surfaceKey`) gör spärren permanent | Senare kontroller utför nya UI-åtgärder | **VERIFIERAD som förstärkare, inte konkurrent**. Den förklarar varför spärren består, men inte varför den uppstår. [E310] |

H301 innehåller en del utanför egen kod: ChatGPT:s ändrade meny med `workPower.keyboardControl` (E304). Adapterns testmodell konstruerades från text, inte från live-DOM. Där ligger annonsen inuti kontrollern, och därför uppstod aldrig två noder. [E309]

**G4:** Exakt en orsakshypotes lever (H301). Underfrågan om [a] eller [b] är A301. Båda ger samma mekanism i adaptern och samma fältsignatur. [E307]
