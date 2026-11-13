using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using PresenceLock.Core;
using Xunit;
using Xunit.Abstractions;

namespace PresenceLock.Core.Tests
{
    /// <summary>
    /// 0.7.1: the questions the field profile of 2026-11-13 could not answer (was a CAD application ever
    /// seen? was it a Remote Desktop session? why was the profile recreated?) are answered by the profile.
    /// </summary>
    public class DiagnosticsTests
    {
        private readonly ITestOutputHelper _out;
        public DiagnosticsTests(ITestOutputHelper o) { _out = o; }
        private const long Sec = TimeSpan.TicksPerSecond;
        private static readonly long T0 = new DateTime(2026, 11, 16, 8, 0, 0, DateTimeKind.Utc).Ticks;

        private void Print(System.Collections.Generic.IEnumerable<ProfileDiagnostics.Finding> f)
        {
            foreach (var x in f) _out.WriteLine(x.ToString());
        }

        /// <summary>Episodes of 40 s idle each, all in one context, through the real coordinator.</summary>
        private static UserProfile Run(FeatureVector sig, int episodes)
        {
            var p = new UserProfile();
            var co = new PresenceCoordinator(new PresenceEngine(p), new CoordinatorConfig());
            long now = T0, lastInput = T0;
            for (int e = 0; e < episodes; e++)
            {
                for (int t = 1; t <= 40; t++) co.Tick(now + t * Sec, t, default(PassiveSignals), ModePolicy.Auto, () => sig.Clone());
                now += 41 * Sec;
                co.Tick(now, 0, default(PassiveSignals), ModePolicy.Auto, () => sig.Clone());   // input
                now += 20 * Sec;
            }
            return p;
        }

        [Fact]
        public void NoSilentWorkApplication_IsWarned_RemoteDesktopIsCounted()
        {
            var rdp = new FeatureVector(); rdp.X[FeatureSchema.RemoteSession] = 1;
            var p = Run(rdp, 250);
            var f = ProfileDiagnostics.Check(p, T0 + Sec * 250 * 61);
            Print(f);
            Assert.Equal(250, p.Stats.EpisodesByContext[0]);
            Assert.Equal(0, p.Stats.EpisodesByContext[1]);
            Assert.Equal(250, p.Stats.RemoteEpisodes);
            Assert.Contains(f, x => x.Severity == ProfileDiagnostics.Severity.Warn && x.Code == "coverage" && x.Text.Contains("ExtraReadingApps"));
            Assert.Contains(f, x => x.Code == "coverage" && x.Text.Contains("100 % of the episodes were in Remote Desktop"));
            Assert.False(ProfileDiagnostics.HasErrors(f));
        }

        [Fact]
        public void SilentWorkSeen_NoCoverageWarning()
        {
            var reading = new FeatureVector(); reading.X[FeatureSchema.CtxReading] = 1;
            var p = Run(reading, 250);
            var f = ProfileDiagnostics.Check(p, T0 + Sec * 250 * 61);
            Assert.Equal(250, p.Stats.EpisodesByContext[1]);
            Assert.DoesNotContain(f, x => x.Severity == ProfileDiagnostics.Severity.Warn && x.Code == "coverage");
        }

        [Fact]
        public void ProfileOrigin_FirstStart_Versus_DeletedProfile()
        {
            string dir = Path.Combine(Path.GetTempPath(), "pl-diag-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            try
            {
                string path = Path.Combine(dir, "profile.json");
                var first = ProfileStore.LoadWithRecovery(path, "S-1", "PC", out string r1, DateTime.UtcNow.Ticks);
                Assert.Equal("first start", first.Origin);
                Assert.Null(r1);

                File.WriteAllText(Path.Combine(dir, "habits.json"), "{}");               // the folder was in use
                var again = ProfileStore.LoadWithRecovery(path, "S-1", "PC", out string r2, DateTime.UtcNow.Ticks);
                Assert.StartsWith("recreated: profile.json was missing", again.Origin);
                Assert.NotNull(r2);                                                       // event 1013 for the administrator
                var f = ProfileDiagnostics.Check(again, DateTime.UtcNow.Ticks);
                Assert.Contains(f, x => x.Severity == ProfileDiagnostics.Severity.Warn && x.Code == "origin");

                File.Delete(Path.Combine(dir, "habits.json"));
                File.WriteAllText(Path.Combine(dir, "agent.log"), "earlier run\n");
                File.SetLastWriteTimeUtc(Path.Combine(dir, "agent.log"), DateTime.UtcNow.AddHours(-12));
                var third = ProfileStore.LoadWithRecovery(path, "S-1", "PC", out _, DateTime.UtcNow.Ticks);
                Assert.StartsWith("recreated", third.Origin);                            // a log older than this process
                var fourth = ProfileStore.LoadWithRecovery(path, "S-1", "PC", out _, DateTime.UtcNow.AddDays(-1).Ticks);
                Assert.Equal("first start", fourth.Origin);                              // written by this process: not evidence

                var b = ProfileStore.ExportBaseline(again);
                Assert.Equal("seeded from baseline", b.Origin);
            }
            finally { Directory.Delete(dir, true); }
        }

        [Fact]
        public void ImpossibleCounters_AreErrors()
        {
            var p = new UserProfile();
            p.Modes.FiredDecisions = 2; p.Modes.RejectedDecisions = 3;
            p.OptionalSeen[FeatureSchema.BleRssiDrop] = 1; p.OptionalAvailable[FeatureSchema.BleRssiDrop] = 2;
            p.Model.U[3] = double.NaN;
            var f = ProfileDiagnostics.Check(p, DateTime.UtcNow.Ticks);
            Print(f);
            Assert.Equal(3, f.Count(x => x.Severity == ProfileDiagnostics.Severity.Error));
        }

        [Fact]
        public void ProfileWrittenBy070_IsExplained()
        {
            var p = new UserProfile { AppVersion = "0.7.0" };
            for (int i = 0; i < 30; i++) p.Modes.RecordEpisodeOutcome(false, false, 60, T0 + i * Sec);
            string json = ProfileStore.Serialize(p).Replace(",\"WindowRule\":2", "");
            var q = ProfileStore.Deserialize(json);
            q.Origin = null;                                                              // 0.7.0 had no Origin
            q.Stats.EpisodesByContext = null;
            q = ProfileStore.Deserialize(ProfileStore.Serialize(q));
            var f = ProfileDiagnostics.Check(q, T0, "0.7.1");
            Print(f);
            Assert.Contains(f, x => x.Code == "origin" && x.Text.Contains("before 0.7.1"));
            Assert.Contains(f, x => x.Code == "gate" && x.Text.Contains("discarded 1 time"));
            Assert.False(ProfileDiagnostics.HasErrors(f));
        }

        // ------------------------------------------------------------------ fixture for verify/analyse_profile.py

        internal static UserProfile SimulatedCadProfile()
        {
            var s = new CadRhythmSim(new CoordinatorConfig(), false, -1, 7).Run(25);
            var p = s.Profile;
            // Wall-clock fields (set from DateTime.UtcNow by the constructor and by learning) are pinned
            // to simulated time so the fixture is deterministic.
            p.CreatedUtcTicks = p.Modes.FirstSeenUtcTicks;
            p.UpdatedUtcTicks = s.Now;
            p.Origin = "first start";
            p.AppVersion = "simulation";
            return p;
        }

        /// <summary>The C# view of the fixture, which the Python tool must reproduce (--check).</summary>
        internal static object Expected(UserProfile p)
        {
            var mc = p.Modes;
            mc.WindowDecisions(out int right, out int wrong, out int unverified);
            var x = new double[FeatureSchema.Count];
            return new
            {
                window_n = mc.WindowOpportunities(), window_k = mc.WindowFalsePositives(), window_days = mc.WindowDays(),
                window_ready = mc.WindowReady(), right, wrong, unverified,
                upper95 = mc.FalsePositiveUpperBound(),
                neutral_dim = p.Model.LockTime(x, p.Config.SoftDimThreshold, 900),
                neutral_lock = p.Model.LockTime(x, p.Config.LockThreshold, 900),
            };
        }

        /// <summary>
        /// The committed fixture verify/fixtures/simulated_cad_profile.json (+ .expected.json) is
        /// regenerated with PRESENCELOCK_WRITE_FIXTURE=1; otherwise this checks that it is still the
        /// output of the current code (it is synthetic: no person's data).
        /// </summary>
        [Fact]
        public void SimulatedCadFixture_IsCurrent_AndConsistent()
        {
            var p = SimulatedCadProfile();
            var f = ProfileDiagnostics.Check(p, p.UpdatedUtcTicks);
            Print(f);
            Assert.False(ProfileDiagnostics.HasErrors(f));
            Assert.DoesNotContain(f, x => x.Severity == ProfileDiagnostics.Severity.Warn);
            string json = ProfileStore.Serialize(p);
            string expected = JsonSerializer.Serialize(Expected(p), new JsonSerializerOptions { WriteIndented = true });
            string dir = Path.GetDirectoryName(ParityTests.RepoFile("verify", "parity_golden.json"));
            string fixture = Path.Combine(dir, "fixtures", "simulated_cad_profile.json");
            if (Environment.GetEnvironmentVariable("PRESENCELOCK_WRITE_FIXTURE") == "1")
            {
                Directory.CreateDirectory(Path.GetDirectoryName(fixture));
                File.WriteAllText(fixture, json);
                File.WriteAllText(Path.ChangeExtension(fixture, ".expected.json"), expected);
            }
            Assert.Equal(json, File.ReadAllText(fixture));
            Assert.Equal(expected, File.ReadAllText(Path.ChangeExtension(fixture, ".expected.json")));
        }
    }
}
