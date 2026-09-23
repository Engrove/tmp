# Greenfield Model Compatibility Contract v1.7.0

## Problem som kontraktet löser

1.6.x band säkerhetsbeslutet för hårt till produktnamn och UI-strängar. Det gjorde att ett annars godtagbart läge kunde stoppas av exempelvis `Luna`, `Sol`, `Astra`, svensk etikett `Djupgående`, eller att ChatGPT helt enkelt inte exponerade modellnamnet i en stabil selector.

1.7.0 separerar därför fyra saker:

1. **EIC-yta**
2. **numerisk modellversion när den är synlig**
3. **reasoning-kontroll**
4. **explicit negativ/degraderad evidens**

## Modellgolv

`requiredModel = GPT-5.6` betyder:

```text
om explicit GPT-version kan läsas:
    observerad version måste vara >= 5.6
annars:
    modellnamnets frånvaro är inte ensam blockerande
```

Jämförelsen är numerisk segment för segment. Exempel:

```text
5.5   < 5.6
5.6   = 5.6
5.7   > 5.6
5.60  > 5.6
6     > 5.6
6.0   > 5.6
```

Familjenamn efter versionsnumret är inte del av jämförelsen.

## Modellfamilj

Exempel på etiketter som behandlas likvärdigt vid golv 5.6:

```text
GPT-5.6 Sol
GPT-5.6 Luna
GPT-5.6 Astra
GPT-5.6 <framtida_namn>
```

`GPT-6 Astra` passerar samma golv.

Det finns ingen hårdkodad familje-whitelist i säkerhetsbeslutet.

## Reasoning

Reasoning kan styrkas av:

- en strukturellt identifierad thinking/reasoning-kontroll;
- en semantiskt igenkänd effort-etikett;
- kompatibel äldre evidens där Thinking/Reasoning är explicit.

Effort rankas:

```text
0 = låg/snabb: Standard, Light, Medium, Instant, Fast, m.fl.
2 = Extended-klass: Extended, Utökad, Förlängd, m.fl.
3 = Heavy-klass: Heavy, Max, Djupgående, Deep, m.fl.
```

En okänd etikett på en **positivt identifierad reasoning-kontroll** får konservativt motsvara Extended-golvet. Den får inte automatiskt motsvara Heavy.

## Modellnamn som inte exponeras

Följande kan ge `UI_MODEL_COMPATIBLE`:

```text
rätt EIC GPT-yta
AND Chat-läge
AND ingen providerfallback/kvot
AND inget explicit degraderat modelläge
AND reasoning-kontroll uppfyller golvet
AND ingen konflikt mellan observerade explicita versioner
```

Detta är avsiktligt: avsaknad av kosmetisk text behandlas som okänd presentation, inte som bevis för fel modell.

## Fortsatt fail-closed

1.7.0 stoppar fortfarande vid:

- explicit observerad version under modellgolvet;
- malformed explicit GPT-token som inte går att tolka säkert;
- Auto / Automatic / Instant / mini / Nano / Fast / Quick / fallback i modellindikationen;
- konflikt mellan olika explicita numeriska modellversioner;
- Work/Codex;
- providerkvot/fallback;
- blockerande ChatGPT-dialog;
- stale modellbevis;
- tänkenivå under golvet;
- okänd reasoningetikett när Heavy-golv krävs.

## Rekommendation kontra aktuell modell

Text som beskriver **skaparens rekommenderade modell** är fortsatt endast diagnostik. Den blir inte automatiskt aktuell-modellevidens.

Uttrycklig text som `Du använder GPT-6 Astra` eller `You are currently using GPT-6 Astra` kan däremot användas som aktuell UI-evidens.

## Assurance-gräns

Greenfield kan verifiera vad den synliga UI-ytan visar och vilka kontroller som är valda. Den kan inte intyga en osynlig serverintern fallback som inte lämnar någon observerbar UI-signal.
