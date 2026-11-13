using System;
using System.IO;
using System.Linq;
using PresenceLock.Core;
using Xunit;
using Xunit.Abstractions;

namespace PresenceLock.Core.Tests
{
    /// <summary>
    /// The About box must state what the agent actually does with the settings in force, and the
    /// privacy statements in it must hold for the data that actually leaves the computer.
    /// </summary>
    public class AboutContentTests
    {
        private readonly ITestOutputHelper _out;
        public AboutContentTests(ITestOutputHelper o) { _out = o; }

        private static string Text(AboutInfo i) => AboutContent.AsText(AboutContent.Build(i));

        [Fact]
        public void Defaults_NameTheResponsible_TheLegalBases_AndTheAuthority()
        {
            string t = Text(new AboutInfo { Version = "0.6.1" });
            _out.WriteLine(t);
            Assert.Contains("PresenceLock 0.6.1", t);
            Assert.Contains("Ansvarig: Jan-Eric Enlund – Elho", t);
            Assert.Contains("Personuppgiftsansvarig: Elho", t);
            Assert.Contains("Kontakt i dataskyddsfrågor: Jan-Eric Enlund – Elho", t);   // falls back to the responsible
            Assert.Contains("2022/2555", t);
            Assert.Contains("124/2025", t);
            Assert.Contains("art. 6.1 f", t);
            Assert.Contains("Dataombudsmannens byrå", t);
            Assert.Contains("inga tangenttryckningar", t);
        }

        [Fact]
        public void Text_FollowsThePoliciesInForce()
        {
            var i = new AboutInfo
            {
                HoldMaxMinutes = 10, ConfirmGraceSeconds = 20,
                PauseOptionsMinutes = new[] { 15, 45 }, PauseBudgetMinutes = 60, PauseKeepsConfirmation = false,
                Nis2Mode = true, ProfileCollection = true,
                Retention = new RetentionPolicy { LogRetentionDays = 45, ProtectedCopyRetentionDays = 365, CollectedProfileRetentionDays = 30 }
            };
            string t = Text(i);
            Assert.Contains("senast efter 10 minuter och 20 sekunder", t);
            Assert.Contains("15, 45 minuter, högst 60 minuter per dygn", t);
            Assert.DoesNotContain("gäller även under pausen", t);
            Assert.Contains("inte kan stängas av", t);
            Assert.Contains("Bevakningstjänsten körs INTE", t);            // default GuardStatus unknown: no false assurance
            Assert.Contains("högst 45 dygn", t);
            Assert.Contains("efter 365 dygn utan inloggning", t);
            Assert.Contains("högst 30 dygn", t);
            Assert.DoesNotContain("Inget skickas från datorn", t);
            Assert.Contains(new HabitPolicy().HistoryDays.ToString(System.Globalization.CultureInfo.InvariantCulture) + " dygnen", t);
        }

        [Fact]
        public void PauseOff_NoPauseText_NoCollection_SaysNothingLeavesTheComputer()
        {
            string t = Text(new AboutInfo { PauseAllowed = false, ProfileCollection = false, Nis2Mode = false });
            Assert.DoesNotContain("pausa via ikonen", t);
            Assert.Contains("Inget skickas från datorn", t);
            Assert.DoesNotContain("skyddad kopia", t);
        }

        /// <summary>The About box promises "no times of your activity" for the collected file: hold it to that.</summary>
        [Fact]
        public void CollectedProfile_CarriesNoActivityTimes()
        {
            var sim = new CadRhythmSim(new CoordinatorConfig(), false, -1, 7).Run(30);
            var p = sim.Profile;
            Assert.True(p.Pause.TryStart(30, sim.Now, new PausePolicy(), out _));
            p.Quality.RecordExposure(123);
            Assert.True(p.Silence.Count(1, sim.Now) > 0);

            var c = ProfileStore.ExportForCollection(p);
            string json = ProfileStore.Serialize(c);
            Assert.Empty(c.Pause.Intervals);
            Assert.Equal(1, c.Pause.PausesStarted);                      // counts stay
            Assert.Equal(0, c.Silence.Counts.Sum());
            Assert.Equal(0, c.Quality.ExposureCount);
            Assert.Equal(0, c.Stats.LastHousekeepingUtcTicks);
            Assert.DoesNotContain("\"s\":", json);                        // no pause start ticks
            Assert.Equal(p.Model.W0, c.Model.W0);                         // what --merge-baseline needs is intact
            Assert.Equal(p.Modes.Mode, c.Modes.Mode);
            // the live profile is untouched
            Assert.Single(p.Pause.Intervals);
        }
    }
}
