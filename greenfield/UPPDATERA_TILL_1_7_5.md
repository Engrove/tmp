# Uppdatera Greenfield 1.7.4 → 1.7.5

1. Packa upp `EIC_Autonom_Agent_Greenfield_v1.7.5.zip` över samma unpacked extension-mapp om du vill behålla samma Chrome extension-ID och lokal state.
2. Öppna `chrome://extensions`, välj **Utvecklarläge** och tryck **Läs in igen** för Greenfield.
3. Bekräfta att sidopanelen visar `Greenfield v1.7.5`.
4. Greenfield kör därefter retention automatiskt. Ingen manuell rensning av `chrome.storage.local` behövs.

## Vad händer med en profil som redan ligger över 90 %?

v1.7.5 använder `unlimitedStorage` som kvotbuffert och kör retention vid startup/recovery-scan och före dispatch.

Ordningen är:

1. gamla alternerande checkpointslotar kompakteras så att varje logisk post normalt behåller primärvärdet + en checksummad slot;
2. lagringen mäts på nytt;
3. om användningen fortfarande ligger över retentionmålet tas de äldsta workerpaketen bort som inte längre har en live `chrome.storage.session`-binding;
4. live-bundna workers kontrolleras igen precis före radering och lämnas orörda.

Trigger: 80 % av nominell `chrome.storage.local`-kvot.
Mål efter städning: 70 %.
90 % är inte längre en lokal dispatchspärr.

## Viktig beteendeförändring

Obundna äldre workers är nu cache/recovery-retention, inte permanent arkiv. Vid lagringstryck kan de raderas automatiskt. Om en gammal obunden worker behöver sparas permanent ska den exporteras eller flyttas till en annan ägd lagringsyta.

Aktiva/bundna workers, operatorinställningar, safety journal och nuvarande ködata raderas inte av worker-retentionen.

## Köhistorik

Avslutad köhistorik är begränsad till de 30 senaste posterna per worker. Aktiva queue-items påverkas inte av denna historikgräns.
