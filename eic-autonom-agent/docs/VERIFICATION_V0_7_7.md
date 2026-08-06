# Verification — v0.7.7

## Obligatoriska kontroller

- fokuserade readiness-/effect-journal-regressioner;
- full Node-testsvit;
- statisk kontroll av att startvägen använder `allowBusy: true`;
- statisk kontroll av att ingen tidigare busy-throw finns i prepared-session-starten;
- statisk kontroll av att både foreground och background spärrar submit;
- statisk kontroll av att `submitPrompt()` skriver text före send-knappssökning och har Enter-fallback;
- validator;
- installations- och käll-ZIP CRC;
- test och validator från det färdigpaketerade källarkivet;
- bounded secretsökning;
- kontroll att runtimekoden saknar `chrome.tabs.create`.

## Verifierat källresultat

- 350/350 Node-tester passerade.
- Validatorn passerade.

## Förväntad claim-gräns

PASS för ovanstående innebär verifierad käll- och paketkandidat. Det innebär inte att v0.7.7 är installerad eller att live-DOM-acceptansen har passerat.

