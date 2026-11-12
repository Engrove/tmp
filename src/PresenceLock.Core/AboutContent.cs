using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace PresenceLock.Core
{
    /// <summary>
    /// What the About box states. Built from the settings that are actually in force, so the
    /// text cannot drift from the behaviour: retention periods, pause budget, NIS2 mode and the
    /// learned-horizon cap are read, not written into prose by hand.
    /// Organisation-specific fields (responsible person, controller, contact, link) come from GPO
    /// with the defaults below.
    /// </summary>
    public sealed class AboutInfo
    {
        public string Version = "0.0.0";
        public string Responsible = "Jan-Eric Enlund – Elho";
        public string Controller = "Elho";
        public string PrivacyContact = "";          // empty = the responsible person
        public string PolicyUrl = "";               // optional link to the full privacy notice
        public bool Nis2Mode;                       // AllowUserExit = 0
        public int HoldMaxMinutes = 15;
        public int ConfirmGraceSeconds = 15;
        public int MaxLearnedHorizonMinutes = 10;
        public bool PauseAllowed = true;
        public int[] PauseOptionsMinutes = { 30, 60, 90 };
        public int PauseBudgetMinutes = 120;
        public bool PauseKeepsConfirmation = true;
        public bool HabitLearning = true;
        public bool ProfileCollection;              // ProfileExportDirectory configured
        public RetentionPolicy Retention = new RetentionPolicy();
        public string DataFolder = @"%LOCALAPPDATA%\PresenceLock";
    }

    public sealed class AboutSection
    {
        public string Heading;
        public string Body;
    }

    public static class AboutContent
    {
        public const string Title = "Om PresenceLock";

        public static List<AboutSection> Build(AboutInfo i)
        {
            var c = CultureInfo.InvariantCulture;
            string contact = string.IsNullOrWhiteSpace(i.PrivacyContact) ? i.Responsible : i.PrivacyContact;
            int unattended = i.HoldMaxMinutes * 60 + i.ConfirmGraceSeconds;
            var s = new List<AboutSection>();

            s.Add(new AboutSection
            {
                Heading = "PresenceLock " + i.Version,
                Body =
                    "Ansvarig: " + i.Responsible + "\n" +
                    "Personuppgiftsansvarig: " + i.Controller + "\n" +
                    "Kontakt i dataskyddsfrågor: " + contact +
                    (string.IsNullOrWhiteSpace(i.PolicyUrl) ? "" : "\nFullständig dataskyddsbeskrivning: " + i.PolicyUrl)
            });

            s.Add(new AboutSection
            {
                Heading = "Vad appen gör",
                Body =
                    "PresenceLock låser datorn när du har gått ifrån den, så att ingen annan kan använda din inloggning. " +
                    "Den lär sig på den här datorn hur just du arbetar, till exempel att du kan sitta stilla och läsa " +
                    "eller studera en ritning en stund, och skiljer det från att du har rest dig och gått.\n" +
                    "Innan låsning dämpas skärmen i några sekunder. En musrörelse eller tangenttryckning avbryter. " +
                    "Under de första veckorna lär sig appen utan att låsa.\n" +
                    "Spelar en synlig video, eller används mikrofon eller kamera i ett möte, pausas bedömningen. Efter " +
                    i.HoldMaxMinutes.ToString(c) + " minuter utan aktivitet frågar skärmen ändå om du är kvar." +
                    (i.PauseAllowed && i.PauseBudgetMinutes > 0
                        ? "\nBehöver du läsa av skärmen länge utan att röra något kan du pausa via ikonen: " +
                          string.Join(", ", i.PauseOptionsMinutes.Select(m => m.ToString(c))) + " minuter, högst " +
                          i.PauseBudgetMinutes.ToString(c) + " minuter per dygn." +
                          (i.PauseKeepsConfirmation ? " Frågan om du är kvar gäller även under pausen." : "") +
                          " Varje paus registreras i datorns händelselogg."
                        : "")
            });

            s.Add(new AboutSection
            {
                Heading = "Varför: informationssäkerhet och NIS2",
                Body =
                    "En olåst dator som lämnats obevakad ger vem som helst åtkomst till dina system och uppgifter i ditt namn. " +
                    "Automatisk låsning är en proportionell teknisk åtgärd för åtkomsthantering och grundläggande " +
                    "informationssäkerhetspraxis enligt NIS2-direktivet (EU 2022/2555, artikel 21.2 i), g)) och Finlands " +
                    "cybersäkerhetslag (124/2025, 9 §), som kräver att organisationen hanterar risker mot sina " +
                    "kommunikationsnät och informationssystem.\n" +
                    "Den kompletterar Windows egen skärmsläckarlåsning. Där den låser efter en fast tid, låser PresenceLock " +
                    "när du faktiskt har gått. Lämnas datorn utan att låsas, till exempel under en video eller paus, låses den " +
                    "senast efter " + Duration(unattended) + "." +
                    (i.Nis2Mode
                        ? "\nOrganisationen har bestämt att appen inte kan stängas av på den här datorn (NIS2-läge). " +
                          "Om den ändå stoppas låses sessionen."
                        : "")
            });

            var collected = new StringBuilder();
            collected.Append("Uppgifter som behandlas, bara på den här datorn:\n");
            collected.Append("• En inlärd modell med siffervikter, räknare och utfallet av de senaste 200 bedömningarna, kopplad till ditt Windows-konto.\n");
            collected.Append("• En tystnadsprofil: hur långa dina tysta perioder brukar vara per typ av program (räknare, inga tidpunkter).\n");
            if (i.HabitLearning)
                collected.Append("• En vanejournal: när dina inaktiva perioder började och hur länge de varade, de senaste " +
                                 new HabitPolicy().HistoryDays.ToString(c) + " dygnen. Den lämnar aldrig datorn.\n");
            collected.Append("• Pauser du har tagit de senaste 24 timmarna, och en kort teknisk logg (start, stopp, fel) som sparas i högst " +
                             i.Retention.LogRetentionDays.ToString(c) + " dygn.\n");
            collected.Append("Det som INTE samlas in: inga tangenttryckningar, inget skärm- eller dokumentinnehåll, inga fönstertitlar, " +
                             "ingen kamerabild och inget mikrofonljud (bara om de används just nu, som ja eller nej), ingen webbhistorik och " +
                             "ingen position. Från förgrundsprogrammet används bara processnamnet för att avgöra programtyp, och det sparas inte.\n");
            collected.Append("Musrörelser används bara i ett några sekunder långt fönster i minnet och sparas inte.");
            s.Add(new AboutSection { Heading = "GDPR: vilka uppgifter", Body = collected.ToString() });

            var purpose = new StringBuilder();
            purpose.Append("Ändamål: att skydda organisationens information och system genom att låsa obevakade datorer. " +
                           "Uppgifterna används inte för att följa upp arbetstid, närvaro eller prestation.\n");
            purpose.Append("Rättslig grund: berättigat intresse (GDPR art. 6.1 f), informationssäkerhet. Där NIS2 gäller sker " +
                           "behandlingen också för att uppfylla organisationens riskhanteringsskyldighet.\n");
            purpose.Append("Var: lokalt i " + i.DataFolder + ". ");
            purpose.Append(i.Nis2Mode
                ? "En skyddad kopia av modellen (inte vanejournalen) finns på samma dator, så att skyddet inte kan nollställas. Den tas bort efter " +
                  i.Retention.ProtectedCopyRetentionDays.ToString(c) + " dygn utan inloggning. "
                : "");
            purpose.Append(i.ProfileCollection
                ? "Modellen (siffror, inga tidpunkter och inget innehåll) samlas dagligen in till IT för förbättring av standardinställningarna. Insamlade kopior sparas i högst " +
                  i.Retention.CollectedProfileRetentionDays.ToString(c) + " dygn. Vanejournalen samlas aldrig in. "
                : "Inget skickas från datorn. ");
            purpose.Append("Ingen överföring till tredje land.\n");
            purpose.Append("Automatiska beslut: låsningen är en säkerhetsåtgärd utan rättsliga följder för dig. Den låser bara skärmen, " +
                           "och du låser upp som vanligt.");
            s.Add(new AboutSection { Heading = "GDPR: ändamål, rättslig grund, lagring", Body = purpose.ToString() });

            s.Add(new AboutSection
            {
                Heading = "Dina rättigheter",
                Body =
                    "Du har rätt att få veta vilka uppgifter som finns om dig och att få tillgång till dem. Knappen \"Öppna mina data\" " +
                    "visar filerna. Du har också rätt att begära rättelse och radering, att invända mot behandlingen (art. 21) och " +
                    "att klaga hos dataskyddsmyndigheten. I Finland är det Dataombudsmannens byrå (tietosuoja.fi), i Sverige IMY.\n" +
                    "Kontakta " + contact + "."
            });
            return s;
        }

        public static string AsText(List<AboutSection> sections)
        {
            var sb = new StringBuilder();
            foreach (var x in sections)
            {
                sb.AppendLine(x.Heading);
                sb.AppendLine(new string('-', Math.Min(60, x.Heading.Length)));
                sb.AppendLine(x.Body);
                sb.AppendLine();
            }
            return sb.ToString();
        }

        private static string Duration(int seconds) =>
            seconds % 60 == 0 ? (seconds / 60).ToString(CultureInfo.InvariantCulture) + " minuter"
                              : (seconds / 60).ToString(CultureInfo.InvariantCulture) + " minuter och " + (seconds % 60).ToString(CultureInfo.InvariantCulture) + " sekunder";
    }
}
