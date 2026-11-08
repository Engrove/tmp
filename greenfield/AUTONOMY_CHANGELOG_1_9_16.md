# Greenfield 1.9.16 — fruset rotmål

Bygger på det levererade, hashverifierade v1.9.15-paketet. Dess funktioner och
v1.9.14:s integritetsrättningar ingår. v1.9.15 lämnas oförändrad som historik.

| Område | Ändring i v1.9.16 |
| --- | --- |
| Rotbindning | `allowRootChange` tas bort ur klientens läsare/validerare. Efter första bindningen nekas annat root.ref för NEXT, WAIT och CLOSURE_READY. |
| Svarsobservation | Väntande operatörsinstruktion kan inte längre lossa rotgrinden. |
| Fristående WAIT | Samma rotgrind gäller vid återupptagning. Instruktionen kan behandlas inom ursprungligt mål utan att underkänt ägarkvitto används. |
| Läsresultat | Fristående WAIT och parkerade köposter sparar senaste misslyckade validering, i stället för att lämna tidigare positivt resultat som det senaste. Historiskt kvitto bevaras. |
| Testskydd | 20 nya negativa och positiva tester; den äldre rotbytesassertionen rättas. Den nya sviten fäller v1.9.15 med 15 fel och 5 godkända kontrollfall. |
| Panel | Aktuell version och korrekt text om 3 kvantum / 15 promptar. |
| EIC | Samstämmig rotpolicy, separata leveransbevis, NOT_VERIFIED skilt från bevisad BLOCKED, samt instruktioner för befintliga skills/kunskapsägare. |

Referenshandlern nekade redan rotbyten och dess körbara kod är byteidentisk
med v1.9.15. Klienten följer nu samma policy. Ingen scope-rebase har lagts till.
Första korrekta bindning och ändrad revision inom samma rot är fortsatt tillåtna.

A2A-svarsschema, obligatoriska fält, statusvärden, manifestbehörigheter och
hostpermissions är oförändrade. Sessionsgränsen 3/15 och separat slotkvantum
är oförändrade. Inga nya mission-ID:n, slots eller prioritetsändringar införs.

Granskningen visade en klientlucka, inte ett faktiskt felaktigt avslut i EIC.
Tidigare sparade rotbyten repareras inte automatiskt; följ migrationsanvisningen.
Lokal verifiering finns i `../verification/1.9.16/`. Ingen EIC-publicering,
Chrome-installation eller verklig terminal acceptans påstås i paketet.
