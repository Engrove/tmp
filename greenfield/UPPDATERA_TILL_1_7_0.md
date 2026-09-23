# Uppdatera Greenfield till 1.7.0

## Syfte

1.7.0 rättar modell-/tänkenivåspärren som kunde stoppa arbetet när ChatGPTs UI ändrade namn eller inte exponerade exakt modelltext.

Den centrala förändringen är att `GPT-5.6` nu är ett **numeriskt modellgolv**, inte en fullständig sträng som måste matcha 1:1.

## Kompatibilitetsregler

- `GPT-5.6 Sol`, `GPT-5.6 Luna` och andra 5.6-familjer godtas.
- `GPT-6 Astra` och senare numeriskt högre GPT-versioner godtas utan kodändring.
- Familjenamnet är inte en whitelist.
- Om modellnamnet inte exponeras kan rätt EIC-yta + verifierad reasoning-kontroll räcka.
- `Djupgående` och `Deep` rankas som Heavy/Max.
- En okänd framtida reasoningetikett kan godtas vid Extended om kontrollen strukturellt är identifierad.
- Heavy-golv kräver fortsatt att nivån kan rankas som Heavy/Max/Deep.
- Explicit äldre version, Auto/Instant/mini/Nano/Fast, Work/Codex och providerfallback blockeras fortsatt.

## Installation

1. Pausa Greenfield.
2. Säkerhetskopiera nuvarande tilläggsmapp.
3. Packa upp `EIC_Autonom_Agent_Greenfield_v1.7.0.zip`.
4. Kopiera innehållet till samma uppackade tilläggsmapp som Chrome redan använder.
5. Gå till `chrome://extensions` och välj **Läs in igen**.
6. Kontrollera version **1.7.0** och oförändrat extension-ID.
7. Öppna EIC GPT i Chat-läge.
8. Kontrollera Drift → Körkrav. Standardgolvet är `GPT-5.6`.
9. Klicka **Läs modell i aktiv EIC-flik**.

## Förväntat resultat för scenariot som utlöste ändringen

Med synlig `Djupgående`-kontroll ska Greenfield kunna godkänna EIC-ytan även om modellnamnet inte kan läsas exakt. Resultatet visas då som kompatibelt UI-läge i stället för `Modell okänd · Tänkenivå okänd`.

Om en explicit modellversion under golvet eller ett explicit snabb-/fallbackläge syns ska körningen däremot fortfarande stoppas.

## Verifieringsgräns

Byggens lokala regressioner och syntaxkontroller är genomförda och redovisas i `BUILD_VERIFICATION.json`. Live DOM-acceptans i den faktiska Chrome-profilen måste fortfarande utföras efter installation.
