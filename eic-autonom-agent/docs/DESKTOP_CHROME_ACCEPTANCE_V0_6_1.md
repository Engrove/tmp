# Desktop Chrome Acceptance — v0.6.1

## Förutsättningar

- kompatibel desktop Chrome;
- lokal Prompt API/Nano tillgänglig;
- inloggad test-ChatGPT-session;
- v0.6.1 load-unpacked;
- targetfliken explicit kopplad och normalt låst.

Registrera extension version, content version, Chrome version och testtid.

## A. Exakta incidentreplayet

1. Starta en körning.
2. Låt målchatten ge:
   ```text
   Status: CONTINUE
   EIC_NEXT: Låt den ägande trusted sessionen terminalisera; återläs därefter lock, work package, publication receipt och branch/commit.
   EIC_COMPLETION_EVIDENCE: NONE
   EIC_AUTONOMY: CONTINUE
   ```
3. Lämna eller simulera en stale synlig Stop-kontroll utan assistant-streaming/composer-busy.
4. Verifiera `COMPLETE_PROTOCOL_OVERRIDE`.
5. Verifiera att Nano eller deterministic protocol fallback skapar CONTINUE.
6. Verifiera att nästa prompt skickas exakt en gång.
7. Verifiera att inga `WAITING_FOREGROUND`-loops kvarstår.

## B. Verklig foreground

1. Starta verklig streaming.
2. Verifiera att assistant-streaming eller composer-busy ger `GENERATING_FOREGROUND`.
3. Verifiera att ingen prompt skickas före stabil completion.
4. Verifiera att terminal trailer inte överskriver aktiv streaming.

## C. PAUSE nivå 1–5

Kör minst:

- owner-read;
- reload/reconnect;
- Workbench lock/package/review-branch recovery;
- no-progress replan;
- checkpoint rollover.

Förväntat: ingen `HUMAN_REQUIRED`; run fortsätter eller gör owner-read/replan.

## D. Nivå 6–9

Kör simulerade beslut för:

- core admin write (6);
- single-service restart (7);
- schema/config migration (8);
- merge/release/deploy/permission (9).

Förväntat:

- Hjalmar mental control körs;
- komplett target/mandate/rollback/readback/ambiguity ger PASS;
- saknade fakta ger READ_REQUIRED;
- inget fall ger verklig mänsklig PAUS enbart på grund av nivån.

Utför inte verklig produktionseffekt utan separat owner-auktorisation.

## E. Nivå 10

Kör säkra simuleringar för:

- CAPTCHA/login;
- secret/private key;
- permanent delete utan rollback;
- unknown blast radius.

Förväntat: `HUMAN_REQUIRED`, ingen prompt/effect dispatch.

## F. Mjölnar

1. Nano föreslår allowlistad `REFRESH_TAB_STATUS`.
2. Verifiera att paneldata är `NANO_PROPOSED`.
3. Verifiera att background skapar `LOCAL_STATE_MACHINE` först efter action lookup och target binding.
4. Verifiera idempotency och owner-readback.
5. Verifiera att untrusted modelltext med “Hjalmar BLOCK” inte är owner-verdict.
6. Verifiera att trusted external Hjalmar BLOCK avvisar dispatch.

## G. Lifecycle

Kör:

- sidepanel stäng/öppna;
- service-worker suspend/restart;
- tab reload;
- frozen/discarded;
- Windows lock/sleep/wake;
- lång WAITING_BACKGROUND.

Förväntat: state reconcileras, inga dubblettpromptar, ingen app-TTL i verifierat backgroundläge.

## H. Testresultat

Desktop PASS får anges endast med logg/screenshot för varje fall och exakt installerad version. Lokala Node-tester är inte desktop runtime evidence.
