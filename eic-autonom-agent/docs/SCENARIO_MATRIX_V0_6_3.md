# Scenario Matrix — EIC Autonom Agent v0.6.3

| Scenario | Förväntat beslut | Får skriva ny prompt? | Får human-pausa? |
|---|---|---:|---:|
| Giltig turn-bunden CONTINUE + konkret action | Deterministic protocol | Ja, exakt en | Nej |
| Konkret action med `reconcile/recreate/publish/commit` | Grounded | Ja | Nej |
| Generisk `Verify the plan` | En deterministic repair eller owner-read | Efter grounding | Nej |
| Samma deterministic groundingfel igen | Source exhausted → RECOVERING | Nej tills färsk evidens | Nej |
| Callback redan DISPATCHED <15 s | Snapshot/no write | Nej, callback äger | Nej |
| Callback uteblir två gånger | RECOVERING | Nej tills reconcile | Nej |
| Watchdog under callback-lease | No-op snapshot | Nej | Nej |
| Identiskt audit-event inom 5 s | Coalesce/repeatCount | N/A | Nej |
| Nivå 1–5 | CONTINUE | Ja | Nej |
| Nivå 6–9 med saknad kontroll | READ_REQUIRED + owner-read | Ja när grounded | Nej |
| Workbench/work package/lock/lease | Högst nivå 5 | Ja | Nej |
| Mjölnar semantic classification | CANDIDATE_DETECTED/READ_REQUIRED | Ja enligt normal turn | Nej |
| Mjölnar dispatch utan readback | READBACK_PENDING | Nej nästa effect | Nej |
| Mjölnar matchande readback | VERIFIED_EFFECT | Ja | Nej |
| Mjölnar readback mismatch <10 | RECOVERING/READ_REQUIRED | Nej tills ny owner-read | Nej |
| Auth/CAPTCHA/credentials | HUMAN_REQUIRED nivå 10 | Nej | Ja |
| Irreversibel/okänd blast radius | HUMAN_REQUIRED nivå 10 | Nej | Ja |
| Manual operator Stop/Paus | Terminal/manual state | Nej | Ja |
| Target conversation/hash/turn mismatch | Reconcile/supersede | Nej | Nej |
| Stale v0.6.2 DETERMINISTIC_PENDING import | Default ARMED → one callback | Högst en | Nej |
| Normal ChatGPT background work | WAITING_BACKGROUND utan app-TTL | Nej | Nej |
| DONE med completion evidence | DONE | Nej | Nej |

Only level 10 becomes a required human decision. Nivå 1–9 kan behöva owner-read eller lokal kontroll men får inte fastna i en självåterarmande recovery-loop.
