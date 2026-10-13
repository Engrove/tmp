# G1 – villkorsrum

| Dimension | Felande fält | Lyckade fält / instrumentering |
| --- | --- | --- |
| Motor / panel / adapterversion | 1.9.10 / 1.9.11 / 7 [E201,E202] | jämför paket och rapporterad motorversion |
| Tänkenivå / maximumkvitto | Extra hög / null [E201] | mät faktiskt maximumkvitto efter manuell kontroll |
| Initiering / dispatch | PENDING / null, 3/3 [E201] | följ kontroll → tick → utskick → WAITING i harness |
| Kvot / global paus / kapacitet | inga globala spärrar, 0 aktiva platser [E201] | injicera spärrar separat; kontroll får inte radera dem |
| Livscykel | 1 SENDING, 2 historiska DETACHED [E201] | testa en otillgänglig och en frisk worker oberoende |
| Schemapaus / generation | ingen missionPause i dessa tre [E201] | testa pausad worker tillsammans med opausad |
| Retry / sidladdning / processbyte | 30 s hålltid i loggen [E201] | deterministiska callbacks, byt ägare över await |
| Tasks / last / drifttid / minne | inte mätt [A201] | inga påståenden om resursläcka; ej särskiljande än |
