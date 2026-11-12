using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using PresenceLock.Core;
using Xunit;
using Xunit.Abstractions;

namespace PresenceLock.Core.Tests
{
    /// <summary>
    /// The cleaning service. Criteria fixed before the run: no store may have an "expiry date" —
    /// every one reaches a steady state well inside its budget and the agent still protects after
    /// more than a year without any administrator action; an unusable file heals itself.
    /// </summary>
    public class HousekeepingTests : IDisposable
    {
        private readonly ITestOutputHelper _out;
        private readonly string _dir = Path.Combine(Path.GetTempPath(), "pl-hk-" + Guid.NewGuid().ToString("N"));
        public HousekeepingTests(ITestOutputHelper o) { _out = o; Directory.CreateDirectory(_dir); }
        public void Dispose() { try { Directory.Delete(_dir, true); } catch { } }
        private static readonly long T0 = new DateTime(2026, 3, 2, 8, 0, 0, DateTimeKind.Utc).Ticks;

        [Fact]
        public void FourHundredDays_EveryStoreReachesASteadyState_AndTheAgentStillProtects()
        {
            var sizes = new List<(int day, long profile, long journal, int episodes)>();
            CadRhythmSim sim = null;
            var report = new HousekeepingReport();
            var hp = new HabitPolicy();
            sim = new CadRhythmSim(new CoordinatorConfig(), false, -1, 7);
            sim.StartOfDay = (day, now) =>
            {
                var j = sim.Co.Config.Habits;
                Housekeeping.PruneJournal(j, now, hp, report);
                if (day % 30 == 0 || day == 63)
                    sizes.Add((day, ProfileStore.Serialize(sim.Profile).Length, HabitStore.Serialize(j).Length, j.Episodes.Count));
                if (j.Episodes.Count > 0)
                    Assert.True((now - j.Episodes.Min(e => e.EntryUtcTicks)) / (double)TimeSpan.TicksPerDay <= hp.HistoryDays + 1e-9);
            };
            sim.Run(400);
            foreach (var x in sizes) _out.WriteLine($"day {x.day,3}: profile.json {x.profile / 1024.0,5:F1} KB, habits.json {x.journal / 1024.0,6:F1} KB ({x.episodes} episodes)");

            var d63 = sizes.First(x => x.day == 63);
            var late = sizes.Where(x => x.day >= 300).ToList();
            Assert.All(late, x => Assert.True(x.journal <= 1.2 * d63.journal, $"journal grew: day {x.day} {x.journal} vs day 63 {d63.journal}"));
            Assert.All(late, x => Assert.True(x.profile <= 1.1 * d63.profile, $"profile grew: day {x.day} {x.profile} vs day 63 {d63.profile}"));
            Assert.All(sizes, x => Assert.True(x.journal * 4 <= BoundedFile.MaxJournalBytes && x.profile * 4 <= BoundedFile.MaxProfileBytes));

            // ... and after more than a year it still does its job, unattended.
            var E = sim.Enforcing;
            Assert.Equal(OperatingMode.Enforcing, sim.Profile.Modes.Mode);
            Assert.True(E.StudiesDimmed <= 0.05 * E.Studies, $"{E.StudiesDimmed}/{E.Studies}");
            Assert.Equal(0, E.HardLocksOnPresent);
            Assert.False(sim.Profile.Quality.Degraded);
            _out.WriteLine($"after 400 days: mode {sim.Profile.Modes.Mode}, studies dimmed {E.StudiesDimmed}/{E.Studies}, " +
                           $"quality {(sim.Profile.Quality.Degraded ? "BELOW" : "ok")}, guard rollbacks {sim.Profile.Guard.Rollbacks}, " +
                           $"journal episodes retired by the cleaning service {report.JournalEpisodesRetired}");
        }

        [Fact]
        public void LeaveOfAbsence_StaleJournalIsRetired_EvenWithNothingNewRecorded()
        {
            var j = new HabitJournal { UserSid = "S-1-5-21-1" };
            for (int i = 0; i < 500; i++) j.Episodes.Add(new HabitEpisode { EntryUtcTicks = T0 + i * TimeSpan.TicksPerHour, Lower = 100, Upper = 101 });
            var r = new HousekeepingReport();
            Housekeeping.PruneJournal(j, T0 + 100 * TimeSpan.TicksPerDay, new HabitPolicy(), r);
            Assert.Empty(j.Episodes);
            Assert.Equal(500, r.JournalEpisodesRetired);
        }

        [Fact]
        public void ClockJumpedBack_FutureEpisodesAreRetiredToo()
        {
            var j = new HabitJournal();
            j.Episodes.Add(new HabitEpisode { EntryUtcTicks = T0 + 400 * TimeSpan.TicksPerDay, Lower = 100, Upper = 101 });
            Housekeeping.PruneJournal(j, T0, new HabitPolicy(), new HousekeepingReport());
            Assert.Empty(j.Episodes);
        }

        private string SaveProfile(UserProfile p, string name = "profile.json")
        {
            string path = Path.Combine(_dir, name);
            ProfileStore.Save(path, p);
            return path;
        }

        [Fact]
        public void CorruptProfile_IsRestoredFromTheBackup_NotStartedOver()
        {
            var good = new UserProfile(); good.Modes.Mode = OperatingMode.Enforcing; good.Model.W0 = -1.2345;
            string path = SaveProfile(good);
            var rep = new HousekeepingReport();
            Housekeeping.WriteBackup(path, rep);
            Assert.True(rep.BackupWritten);

            File.WriteAllText(path, "{ this is not json");
            var p = ProfileStore.LoadWithRecovery(path, "S-1-5-21-1", "PC", out string recovery);
            _out.WriteLine(recovery);
            Assert.Equal(-1.2345, p.Model.W0);
            Assert.Equal(OperatingMode.Enforcing, p.Modes.Mode);
            Assert.Contains("restored from the last-known-good backup", recovery);
        }

        [Fact]
        public void OversizedProfile_IsRestoredFromTheBackup()
        {
            var good = new UserProfile(); good.Model.W0 = -2.5;
            string path = SaveProfile(good);
            Housekeeping.WriteBackup(path, new HousekeepingReport());
            using (var fs = new FileStream(path, FileMode.Create)) fs.SetLength(BoundedFile.MaxProfileBytes + 1);
            var p = ProfileStore.LoadWithRecovery(path, "S-1-5-21-1", "PC", out string recovery);
            Assert.Equal(-2.5, p.Model.W0);
            Assert.Contains("oversized", recovery);
        }

        [Fact]
        public void NoUsableBackup_StartsFresh_AndSaysSo()
        {
            string path = Path.Combine(_dir, "profile.json");
            File.WriteAllText(path, "garbage");
            File.WriteAllText(path + Housekeeping.BackupSuffix, "garbage too");
            var p = ProfileStore.LoadWithRecovery(path, "S-1-5-21-1", "PC", out string recovery);
            Assert.Equal(OperatingMode.Learning, p.Modes.Mode);
            Assert.Contains("no usable backup", recovery);
            ProfileStore.LoadWithRecovery(Path.Combine(_dir, "none.json"), "S", "PC", out string none);
            Assert.Null(none);                                                   // a first start is not a recovery
        }

        [Fact]
        public void Backup_IsNeverOverwrittenByACorruptProfile()
        {
            var good = new UserProfile(); good.Model.W0 = -0.75;
            string path = SaveProfile(good);
            Housekeeping.WriteBackup(path, new HousekeepingReport());
            File.WriteAllText(path, "{ broken");
            var rep = new HousekeepingReport();
            Housekeeping.WriteBackup(path, rep);
            Assert.False(rep.BackupWritten);
            Assert.Equal(-0.75, ProfileStore.Deserialize(File.ReadAllText(path + Housekeeping.BackupSuffix)).Model.W0);
        }

        [Fact]
        public void UnusableJournal_StartsANewOne_AndSaysSo()
        {
            string path = Path.Combine(_dir, "habits.json");
            File.WriteAllText(path, "nope");
            var j = HabitStore.LoadWithRecovery(path, "S-1-5-21-1", out string recovery);
            Assert.Empty(j.Episodes);
            Assert.Contains("unreadable", recovery);
        }

        [Fact]
        public void CrashLeftovers_AreRemoved_LiveFilesNeverTouched()
        {
            var now = DateTime.UtcNow;
            foreach (var n in new[] { "profile.json", "habits.json", "profile.json.bak", "agent.log", "old.json.tmp", "new.json.tmp" })
                File.WriteAllText(Path.Combine(_dir, n), "x");
            foreach (var n in new[] { "profile.json", "habits.json", "profile.json.bak", "agent.log", "old.json.tmp" })
                File.SetLastWriteTimeUtc(Path.Combine(_dir, n), now.AddDays(-400));
            var rep = new HousekeepingReport();
            Housekeeping.CleanAgentDirectory(_dir, now, new RetentionPolicy(), rep);
            Assert.Equal(new[] { "old.json.tmp" }, rep.FilesDeleted.Select(Path.GetFileName).ToArray());
            Assert.True(File.Exists(Path.Combine(_dir, "new.json.tmp")));        // may be a save in progress
            Assert.True(File.Exists(Path.Combine(_dir, "profile.json")) && File.Exists(Path.Combine(_dir, "profile.json.bak")));
        }

        [Fact]
        public void LogLines_OlderThanTheRetention_AreRetired()
        {
            var log = new RotatingLog(Path.Combine(_dir, "agent.log"), 4 * 1024);
            var start = new DateTime(2026, 1, 1, 9, 0, 0);
            for (int d = 0; d < 90; d++) log.Write("day " + d + " start", start.AddDays(d), T0 + d * TimeSpan.TicksPerDay);
            int retired = log.Retire(start.AddDays(89).AddDays(-30));
            var remaining = Directory.GetFiles(_dir, "agent.log*").SelectMany(f => File.ReadAllLines(f)).ToList();
            _out.WriteLine($"retired {retired}, remaining {remaining.Count}: {remaining.First()} .. {remaining.Last()}");
            Assert.Equal(31, remaining.Count);                                    // days 59..89
            Assert.StartsWith("2026-03-01", remaining.OrderBy(x => x).First());
            Assert.Equal(59, retired);
        }

        [Fact]
        public void ForeignHugeLogFile_IsDeletedWithoutParsing()
        {
            var log = new RotatingLog(Path.Combine(_dir, "agent.log"), 1024);
            using (var fs = new FileStream(log.PathName, FileMode.Create)) fs.SetLength(1L << 30);   // 1 GB sparse
            log.Retire(DateTime.Now.AddDays(-30));
            Assert.False(File.Exists(log.PathName));
        }

        [Fact]
        public void Expired_SelectsByPatternAndAge()
        {
            var now = DateTime.UtcNow;
            foreach (var n in new[] { "S-1-5-21-1.json", "S-1-5-21-2.json", "notes.txt" }) File.WriteAllText(Path.Combine(_dir, n), "x");
            File.SetLastWriteTimeUtc(Path.Combine(_dir, "S-1-5-21-1.json"), now.AddDays(-181));
            File.SetLastWriteTimeUtc(Path.Combine(_dir, "notes.txt"), now.AddDays(-999));
            var expired = Housekeeping.Expired(_dir, "S-*.json", now, 180).Select(Path.GetFileName).ToArray();
            Assert.Equal(new[] { "S-1-5-21-1.json" }, expired);
        }
    }
}
