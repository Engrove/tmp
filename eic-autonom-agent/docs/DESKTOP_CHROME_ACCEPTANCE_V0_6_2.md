# Desktop Chrome Acceptance — v0.6.2

## Förutsättningar

- v0.6.2 load-unpacked;
- samma desktop Chrome-profil;
- explicit kopplad och låst ChatGPT-flik;
- export från det observerade v0.6.1-felet tillgänglig.

Registrera extensionversion, contentversion, Chromeversion, tid och exportens SHA-256.

## A. Exakta incidentreplayet

1. Importera v0.6.1-exporten där:
   - `state=WAITING_FOR_RESPONSE`;
   - `pendingNanoRequest=null`;
   - `pendingObservation.targetResult.valid=true`;
   - `EIC_AUTONOMY=CONTINUE`;
   - senaste Nanoresultat är `GROUNDING_REJECTED: META_ONLY_ACTION`.
2. Återställ samma målflik/konversation.
3. Verifiera audit: `Stuck v0.6.1-state självreparerad`.
4. Verifiera `DETERMINISTIC_PROTOCOL`, inte `CONTINUATION_ANALYSIS`.
5. Verifiera att nästa prompt innehåller exakt EIC_NEXT-handlingen.
6. Verifiera promptkvittens.
7. Verifiera exakt en prompt; ingen duplicate dispatch.
8. Verifiera att runnen lämnar `WAITING_FOR_RESPONSE` och inte återgår till samma observation.

## B. Grounding-regression

Använd exakt:

```text
Utför owner-approved trusted-session handoff för cwp_wp2524_publication_recovery och dess publication job/request locator; läs därefter workspace.forgejo.publish.status med verify_remote=true.
```

Verifiera att den inte klassificeras `META_ONLY_ACTION`.

## C. Giltigt protokoll

Kör separata turn-bundna fall:

- CONTINUE med konkret EIC_NEXT;
- PAUSE nivå 4/5 med konkret unlock;
- PAUSE nivå 7 med komplett Hjalmar mental-control-underlag;
- PAUSE nivå 10 för CAPTCHA/credentials;
- DONE med konkret completion evidence.

Förväntat:

- CONTINUE går fast path;
- nivå 1–9 fortsätter/replannar;
- Nivå 10 stannar;
- DONE avslutar endast lokal run efter korrekt trailer.

## D. Nano-fel utan giltig trailer

1. Tvinga ett schema-/groundingfel på ett svar utan giltig trailer.
2. Verifiera högst en repair-runda.
3. Verifiera därefter `DETERMINISTIC_RECOVERY`.
4. Verifiera aktiv owner-read/replan, inte passiv `SOFT_PAUSED`.
5. Direkt operatörs-Stop ska fortfarande stoppa.

## E. Lifecycle

- service-worker suspend/wake mitt i `DETERMINISTIC_PENDING`;
- tab reload;
- panel stängd/öppnad;
- frozen/discarded;
- import/export;
- prompt ack före och efter worker restart.

Varje fall ska vara duplicate-säkert.

## Acceptans

PASS kräver observerbar end-to-end runtime för A–E. Lokala Node-tester och ZIP-integritet ersätter inte desktop runtime.
