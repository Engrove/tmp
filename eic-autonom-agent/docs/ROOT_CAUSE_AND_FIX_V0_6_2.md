# Root Cause and Fix — v0.6.2

## Verifierat desktopincident

Målchatten avslutade med ett giltigt, turn-bundet protokoll:

```text
EIC_TURN: turn-ff4847b1-3a5f-4743-b854-87601aa98e75
EIC_NEXT: Utför owner-approved trusted-session handoff för cwp_wp2524_publication_recovery och dess publication job/request locator; läs därefter workspace.forgejo.publish.status med verify_remote=true.
EIC_COMPLETION_EVIDENCE: NONE
EIC_AUTONOMY: CONTINUE
```

Exporten visade samtidigt:

- `targetResult.valid=true`, `status=CONTINUE`;
- `pendingNanoRequest=null`;
- `pendingObservation` kvar med samma giltiga svar;
- `lastNanoTrace.status=INVALID`;
- `GROUNDING_REJECTED: META_ONLY_ACTION`;
- `state=WAITING_FOR_RESPONSE`, `mode=WAITING_CONTINUE`;
- Mjölnar `IDLE`.

Det var därför inte en verklig mänsklig PAUS. Det var ett internt continuation-fel.

## Rotorsak 1 — protocol inversion

Efter att `parseTargetResult()` redan verifierat den exakta terminala trailern skapade v0.6.1 ändå en Nano-request. Den lokala modellen blev ett blockerande mellanled för ett beslut som redan var deterministiskt definierat.

### Korrigering

Giltiga `CONTINUE`, `PAUSE` och `DONE` går nu genom `DETERMINISTIC_PROTOCOL`. Nano används bara när semantisk analys faktiskt behövs.

## Rotorsak 2 — falsk META_ONLY_ACTION

Groundingreglerna kände igen `läs` som metaord men inte:

- `utför`;
- `handoff`;
- `terminalisera`;
- dotted owner-routes, exempelvis `workspace.forgejo.publish.status`;
- snake-case work-package-id;
- `verify_remote=true`.

Den konkreta tvådelade handlingen klassificerades därför fel som ren kontrolltext.

### Korrigering

Grounding känner nu igen konkreta svenska effektverb och exakta tekniska locators. Det exakta incidentuttrycket har en regressionsfixture.

## Rotorsak 3 — poisoned observation bookkeeping

`lastProcessedResponseIdentity` uppdaterades när observationen köades, inte när ett beslut lyckades. Efter Nano-INVALID fanns observationen kvar men samma response kunde inte betraktas som ny.

### Korrigering

En bevarad giltig observation utan aktiv request kan återtas deterministiskt. Återtagandet kräver:

- samma målflik/konversation och response hash;
- giltig terminal trailer;
- ingen aktiv request;
- ingen verklig human pause.

## Rotorsak 4 — recoverable modellfel blev effektivt stopp

Efter exakt en repair-runda gick groundingfelet till `SOFT_PAUSED`. Lifecycle-recovery flyttade sedan till `WAITING_FOR_RESPONSE`, men ingen request återskapades.

### Korrigering

I Max Autonomous Mode gäller:

```text
Nano INVALID
  → valid target protocol? DETERMINISTIC_PROTOCOL
  → annars DETERMINISTIC_RECOVERY
  → aldrig verklig mänsklig PAUS under nivå 10
```

Operatörens Stop/Paus, autentisering/CAPTCHA, credentials, okänd/irreversibel destruktion och materiell safety/policy-gräns behåller nivå 10.

## Claim boundary

Source-, fixture-, statisk validator-, syntax-, package- och ZIP-resultat kan verifieras lokalt. Faktisk Chrome-installation och end-to-end desktopkörning kräver separat runtimeacceptans.
