# Desktop Chrome acceptance — EIC Autonom Agent v0.5.2

Initial status: `BROWSER_RUNTIME_PENDING`.

## A. Installation och version

- installera unpacked v0.5.2;
- kontrollera manifestversion;
- inga nya permissions/hosts;
- reload från v0.5.1-state;
- export visar schema v5.

## B. Nano activation

1. Klicka **Kontrollera / aktivera Nano**.
2. Kontrollera att availability och create visas.
3. Verifiera att unsupported `sv`-felet inte uppstår.
4. Kontrollera `chrome://on-device-internals` vid behov.
5. Stäng och öppna panelen: körningen ska bestå, men en ny LanguageModel-session kan kräva ny användargest.

## C. Verklig Nano-pipeline

För ett nytt komplett assistantsvar:

- request går `PENDING → RUNNING`;
- unikt claim ID finns;
- duration räknar upp;
- first token/output chars/chunks blir synliga;
- logg visar `Nano-analys startad`;
- terminal logg visar `Nano-analys slutförd`, källa `NANO`, duration och output chars;
- deterministic fallback får inte visas under aktiv claim;
- export innehåller `lastNanoTrace` och `nanoTelemetry`.

Simulera långsam Nano-inferens:

- låt inferensen gå längre än 45 sekunder;
- requesten ska förbli `RUNNING` medan claim-leasen är aktiv;
- duration ska fortsätta räknas och heartbeat ska förnya lease;
- ingen fallback eller ny målprompt får skapas.

Simulera därefter panelstängning under inferens:

- requesten förblir beständig tills claim-leasen faktiskt löper ut;
- efter lease-expiry återköas observationen;
- ingen målprompt skickas;
- efter ny Nano-aktivering kan samma observation analyseras bounded.

## D. Takeover regression

Använd en redan lång, pågående session utan EIC-AA/3-control envelope.

Verifiera:

- waiting-start skickar inget;
- första nya svaret utlöser `TAKEOVER_BOOTSTRAP`;
- Nano input innehåller latest response och recent conversation head+tail;
- intent/work unit/context anchors fylls;
- generiska åtgärder som `Läs target-sessionens påståenden` avvisas;
- `requiredEvidence=["targetClaims"]` avvisas;
- `PROTOCOL_MISSING` ger inte generic CONTINUE;
- endast ett konkret observerbart nästa steg kan levereras.

## E. DOM virtualization

- scrolla lång konversation;
- låt ChatGPT omrendera äldre meddelanden;
- assistantCount får ändras diagnostiskt;
- samma assistant hash/task fingerprint får inte behandlas som nytt svar;
- ingen duplicate prompt.

## F. Anti-loop

Skapa två Nano-kandidater med noll progress och svenska metaåtgärder.

- `STOP_META_LOOP` aktiveras;
- productive count ökar inte;
- ingen tredje generell auditprompt skickas.

## G. Background wait

Verifiera svenska och engelska struktursignaler, väntan längre än normal timeout, inaktiv/minimerad flik, service-worker termination, frozen/discarded, screen lock medan systemet är vaket och real sleep/wake.

Rapportera separat:

- `continued while system awake`;
- `resumed correctly after OS suspension`.

## H. Mjölnar

- SHADOW: ingen dispatch;
- D0 live: exakt read/action;
- D1 live: synlig action, rollback, Hjalmar/equivalent kontroll och readback;
- D2: HUMAN_REQUIRED;
- duplicate dispatch blockeras.

## I. Stop och hard boundaries

- Stop alltid aktiv;
- auth/CAPTCHA/credentials/permissions/delete/merge/release/deploy stoppas;
- ingen continuation efter target navigation eller conversation mismatch.

## Evidence pack

Exportera:

- addon-state JSON;
- sidopanelbilder före/under/efter Nano;
- service-worker log;
- exact Chrome version;
- testscenario och tider;
- eventlogg;
- eventuella failures med owner readback.

Browser PASS får inte anges utan detta runtime-underlag.
